import { pool } from "../config/db.js";
import { logAuditEvent } from "../utils/auditLogger.js";

const computedLat = `pr.latitude`;

const computedLon = `pr.longitude`;

export const searchProfiles = async (req, res) => {
  try {

    /* ==========================================================
       ⭐ SHRADDHA NEW CODE START — USER FROM TOKEN (CHAT STYLE)
    ========================================================== */
    const userId = req.user?.id;
    const { search_mode } = req.query;

    if (userId) {
      let requiredFeature = "basic_search";
      if (search_mode === "advanced") {
        requiredFeature = "advance_search";
      } else if (search_mode === "nearme") {
        requiredFeature = "near_me";
      }

      const planRes = await pool.query(
        `
        SELECT p.allowed_features, up.expires_at
        FROM user_plans up
        LEFT JOIN plans p ON up.plan_id = p.id
        WHERE up.user_id = $1 AND up.status = 'active'
        ORDER BY up.expires_at DESC
        LIMIT 1
        `,
        [userId]
      );

      let hasActivePlan = false;
      let allowedFeatures = null;

      if (planRes.rows.length > 0) {
        const expiresAt = new Date(planRes.rows[0].expires_at);
        if (expiresAt >= new Date()) {
          hasActivePlan = true;
          allowedFeatures = planRes.rows[0].allowed_features;
        }
      }

      let isAllowed = false;
      if (!hasActivePlan) {
        // Free tier (no active plan) default allowed features
        const defaultFreeFeatures = {
          edit_profile: true,
          basic_search: true,
          dashboard: true,
        };
        isAllowed = !!defaultFreeFeatures[requiredFeature];
      } else {
        if (allowedFeatures === null || allowedFeatures === undefined) {
          isAllowed = true; // Legacy plan, allow by default
        } else if (Array.isArray(allowedFeatures)) {
          isAllowed = allowedFeatures.includes(requiredFeature);
        } else if (typeof allowedFeatures === 'object') {
          isAllowed = !!allowedFeatures[requiredFeature];
        }
      }

      if (!isAllowed) {
        return res.status(403).json({
          code: "PLAN_RESTRICTED",
          message: `Access denied. Your plan does not support the '${requiredFeature}' feature.`,
        });
      }
    }
    /* ==========================================================
       ⭐ SHRADDHA NEW CODE END
    ========================================================== */

    /* ==========================================================
       ⭐ SHRADDHA NEW CODE START — PEOPLE SEARCH LIMIT CHECK
    ========================================================== */
    if (userId) {
      const { rows: planRows } = await pool.query(
        `
        SELECT 
          up.people_search_used,
          p.people_search_limit
        FROM user_plans up
        JOIN plans p ON p.id = up.plan_id
        WHERE up.user_id = $1
          AND up.status = 'active'
          AND p.is_active = 1
          AND up.expires_at > NOW()
        `,
        [userId]
      );

      if (planRows.length === 0) {
        return res.status(403).json({
          code: "NO_ACTIVE_PLAN",
          message: "No active plan found",
        });
      }

      // 🚫 Block ONLY if NOT unlimited AND limit reached AND global limit check is enabled
      const configRes = await pool.query("SELECT check_search_limit FROM configurations LIMIT 1");
      const checkSearchLimit = configRes.rows[0]?.check_search_limit ?? 1;

      if (
        checkSearchLimit === 1 &&
        planRows[0].people_search_limit !== -1 &&
        planRows[0].people_search_used >= planRows[0].people_search_limit
      ) {
        return res.status(403).json({
          code: "SEARCH_LIMIT_EXCEEDED",
          message: "Your people search limit is over",
        });
      }

    }
    /* ==========================================================
       ⭐ SHRADDHA NEW CODE END
    ========================================================== */

    /* ==========================================================
       🔍 OLD SEARCH PARAMS (UNCHANGED)
    ========================================================== */
    const {
      first_name,
      last_name,
      gender,
      city,
      state,
      skills,
      interests,
      profession,
      min_age,
      max_age,
      radius,
      marital_status,
      lat,
      lon
    } = req.query;

    let queryStr = `
      SELECT pr.*, 
             ${computedLat} as latitude, 
             ${computedLon} as longitude,
             NULL as distance_meters
      FROM profiles pr
      WHERE 1=1
    `;

    const params = [];
    let idx = 1;

    /* ==========================================================
       ⭐ BASIC SEARCH MODE  (OLD — UNTOUCHED)
    ========================================================== */
    if (search_mode === "basic") {
      if (first_name) {
        params.push(`%${first_name}%`);
        params.push(`%${first_name}%`);
        params.push(`%${first_name}%`);
        params.push(`%${first_name}%`);
        params.push(`%${first_name}%`);

        queryStr += `
          AND (
            LOWER(pr.first_name) LIKE LOWER($${idx})
            OR LOWER(pr.profession) LIKE LOWER($${idx + 1})
            OR (
              jsonb_typeof(pr.skills::jsonb) = 'array'
              AND EXISTS (
                SELECT 1 FROM json_array_elements_text(pr.skills) s
                WHERE LOWER(s) LIKE LOWER($${idx + 2})
              )
            )
            OR (
              jsonb_typeof(pr.skills::jsonb) = 'string'
              AND LOWER(pr.skills::text) LIKE LOWER($${idx + 2})
            )
            OR (
              jsonb_typeof(pr.interests::jsonb) = 'array'
              AND EXISTS (
                SELECT 1 FROM json_array_elements_text(pr.interests) i
                WHERE LOWER(i) LIKE LOWER($${idx + 3})
              )
            )
            OR (
              jsonb_typeof(pr.interests::jsonb) = 'string'
              AND LOWER(pr.interests::text) LIKE LOWER($${idx + 3})
            )
            OR LOWER(pr.city) LIKE LOWER($${idx + 4})
          )
        `;
        idx += 5;
      }

      if (profession) {
        params.push(`%${profession}%`);
        queryStr += ` AND LOWER(pr.profession) LIKE LOWER($${idx})`;
        idx++;
      }

      if (city) {
        params.push(`%${city}%`);
        queryStr += ` AND LOWER(pr.city) LIKE LOWER($${idx})`;
        idx++;
      }
    }

    /* ==========================================================
       ⭐ ADVANCED SEARCH MODE (OLD — UNTOUCHED)
    ========================================================== */
    if (search_mode === "advanced") {

      const textFilters = {
        first_name: "pr.first_name",
        last_name: "pr.last_name",
        profession: "pr.profession",
        city: "pr.city",
        state: "pr.state"
      };

      for (const [key, col] of Object.entries(textFilters)) {
        if (req.query[key]) {
          params.push(`%${req.query[key]}%`);
          queryStr += ` AND LOWER(${col}) LIKE LOWER($${idx})`;
          idx++;
        }
      }

      if (gender) {
        params.push(gender);
        queryStr += ` AND LOWER(pr.gender::text) = LOWER($${idx})`;
        idx++;
      }

      if (marital_status) {
        params.push(marital_status);
        queryStr += ` AND LOWER(pr.marital_status::text) = LOWER($${idx})`;
        idx++;
      }

      if (skills) {
        params.push(`%${skills}%`);
        params.push(`%${skills}%`);
        queryStr += `
          AND (
            jsonb_typeof(pr.skills::jsonb) = 'array'
            AND EXISTS (
              SELECT 1 FROM json_array_elements_text(pr.skills) s
              WHERE LOWER(s) LIKE LOWER($${idx})
            )
            OR jsonb_typeof(pr.skills::jsonb) = 'string'
            AND LOWER(pr.skills::text) LIKE LOWER($${idx + 1})
          )
        `;
        idx += 2;
      }

      if (interests) {
        params.push(`%${interests}%`);
        params.push(`%${interests}%`);
        queryStr += `
          AND (
            jsonb_typeof(pr.interests::jsonb) = 'array'
            AND EXISTS (
              SELECT 1 FROM json_array_elements_text(pr.interests) i
              WHERE LOWER(i) LIKE LOWER($${idx})
            )
            OR jsonb_typeof(pr.interests::jsonb) = 'string'
            AND LOWER(pr.interests::text) LIKE LOWER($${idx + 1})
          )
        `;
        idx += 2;
      }

      if (min_age && max_age) {
        params.push(min_age, max_age);
        queryStr += ` AND pr.age BETWEEN $${idx} AND $${idx + 1}`;
        idx += 2;
      } else if (min_age) {
        params.push(min_age);
        queryStr += ` AND pr.age >= $${idx}`;
        idx++;
      } else if (max_age) {
        params.push(max_age);
        queryStr += ` AND pr.age <= $${idx}`;
        idx++;
      }
    }

    /* ==========================================================
       ⭐ NEAR ME MODE (FIXED — direct column build, no string-replace)
    ========================================================== */
    if (search_mode === "nearme") {
      let searchLat = lat !== undefined && lat !== null && lat !== "" ? Number(lat) : null;
      let searchLon = lon !== undefined && lon !== null && lon !== "" ? Number(lon) : null;
      const searchRadiusKm = radius !== undefined && radius !== null && radius !== "" ? Number(radius) : 50;

      // Fallback: If lat/lon not provided in query, attempt to fetch current user's profile location (direct GPS coordinates only, no fallbacks)
      if ((searchLat === null || searchLon === null) && userId) {
        try {
          const userLocRes = await pool.query(
            `SELECT latitude, longitude
             FROM profiles
             WHERE user_id = $1`,
            [userId]
          );
          if (userLocRes.rows.length > 0) {
            const uLoc = userLocRes.rows[0];
            if (uLoc.latitude !== null && uLoc.longitude !== null) {
              searchLat = Number(uLoc.latitude);
              searchLon = Number(uLoc.longitude);
              console.log(`[NearMe] Resolved searcher location from profile: lat=${searchLat} lon=${searchLon}`);
            }
          }
        } catch (locErr) {
          console.warn("⚠️ Could not fetch user location for nearme fallback:", locErr.message);
        }
      }

      if (searchLat !== null && searchLon !== null && !isNaN(searchLat) && !isNaN(searchLon)) {
        console.log(`[NearMe] lat=${searchLat} lon=${searchLon} radius=${searchRadiusKm}km`);

        const latIdx = idx;
        const lonIdx = idx + 1;
        const radIdx = idx + 2;
        idx += 3;
        params.push(searchLat, searchLon, searchRadiusKm);

        // Build distance expression in km (uses the same COALESCE logic as computedLat/computedLon)
        const distKmExpr = `6371.0 * acos(LEAST(1.0, GREATEST(-1.0,
          cos(radians($${latIdx})) * cos(radians(${computedLat})) *
          cos(radians(${computedLon}) - radians($${lonIdx})) +
          sin(radians($${latIdx})) * sin(radians(${computedLat}))
        )))`;

        // Rebuild the entire SELECT so distance_meters column is real, not NULL
        queryStr = `
          SELECT pr.*,
                 ${computedLat}             AS latitude,
                 ${computedLon}             AS longitude,
                 (${distKmExpr} * 1000.0)   AS distance_meters
          FROM profiles pr
          WHERE 1=1
        `;

        if (city && city.trim()) {
          params.push(`%${city.trim()}%`);
          const cityIdx = idx;
          idx++;
          // Strict radius constraint + matching city filter
          queryStr += `
            AND ${computedLat} IS NOT NULL 
            AND ${computedLon} IS NOT NULL
            AND ${distKmExpr} <= $${radIdx}
            AND LOWER(pr.city) LIKE LOWER($${cityIdx})
          `;
        } else {
          // Strict radius: only profiles with known coords within radius
          queryStr += `
            AND ${computedLat} IS NOT NULL
            AND ${computedLon} IS NOT NULL
            AND ${distKmExpr} <= $${radIdx}
          `;
        }
      } else {
        // Near Me mode requires coordinates. If not available, return empty array.
        return res.json([]);
      }
    }

    if (userId) {
      queryStr += ` AND pr.user_id <> $${idx}`;
      params.push(userId);
      idx++;
    }

    queryStr += ` ORDER BY pr.user_id`;

    const { rows } = await pool.query(queryStr, params);
    let finalRows = rows;

    if (userId) {
      logAuditEvent(userId, `SEARCH_${(search_mode || "basic").toUpperCase()}`, { filters: req.query, results_count: finalRows.length }, req);
    }



    /* ==========================================================
       ⭐ SHRADDHA NEW CODE START — INCREMENT SEARCH COUNT
    ========================================================== */
    if (userId) {
      const configRes = await pool.query("SELECT check_search_limit FROM configurations LIMIT 1");
      const checkSearchLimit = configRes.rows[0]?.check_search_limit ?? 1;

      if (checkSearchLimit === 1) {
        await pool.query(
          `
          UPDATE user_plans
          SET people_search_used = people_search_used + 1,
              updated_at = NOW()
          WHERE user_id = $1 AND status = 'active'
          `,
          [userId]
        );
      }
    }
    /* ==========================================================
       ⭐ SHRADDHA NEW CODE END
    ========================================================== */

    const page = parseInt(req.query.page, 10) || 1;
    const limit = req.query.limit 
      ? parseInt(req.query.limit, 10) 
      : (req.query.page ? 6 : 100); // Default to 6 if page requested, 100 otherwise
    const totalCount = finalRows.length;
    const totalPages = Math.ceil(totalCount / limit);
    const offset = (page - 1) * limit;
    const paginatedRows = finalRows.slice(offset, offset + limit);

    return res.json({
      results: paginatedRows,
      total: totalCount,
      page,
      limit,
      totalPages
    });

  } catch (err) {
    console.error("Search API Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
