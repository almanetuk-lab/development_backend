import { pool } from "../config/db.js";

const CITY_COORDS = {
  indore: { lat: 22.7196, lon: 75.8577 },
  kanpur: { lat: 26.4499, lon: 80.3319 },
  mumbai: { lat: 19.0760, lon: 72.8777 },
  bombay: { lat: 19.0760, lon: 72.8777 },
  delhi: { lat: 28.6139, lon: 77.2090 },
  "new delhi": { lat: 28.6139, lon: 77.2090 },
  bengaluru: { lat: 12.9716, lon: 77.5946 },
  bangalore: { lat: 12.9716, lon: 77.5946 },
  chennai: { lat: 13.0827, lon: 80.2707 },
  ujjain: { lat: 23.1760, lon: 75.7885 },
  pune: { lat: 18.5204, lon: 73.8567 },
  jaipur: { lat: 26.9124, lon: 75.7873 },
  ahmedabad: { lat: 23.0225, lon: 72.5714 },
  noida: { lat: 28.5355, lon: 77.3910 },
  gurgaon: { lat: 28.4595, lon: 77.0266 },
  bhopal: { lat: 23.2599, lon: 77.4126 }
};

const PIN_PREFIX_COORDS = {
  "452": { lat: 22.7196, lon: 75.8577 }, // Indore
  "208": { lat: 26.4499, lon: 80.3319 }, // Kanpur
  "400": { lat: 19.0760, lon: 72.8777 }, // Mumbai
  "110": { lat: 28.6139, lon: 77.2090 }, // Delhi
  "560": { lat: 12.9716, lon: 77.5946 }, // Bengaluru
  "600": { lat: 13.0827, lon: 80.2707 }, // Chennai
  "456": { lat: 23.1760, lon: 75.7885 }, // Ujjain
  "411": { lat: 18.5204, lon: 73.8567 }, // Pune
  "302": { lat: 26.9124, lon: 75.7873 }, // Jaipur
  "380": { lat: 23.0225, lon: 72.5714 }, // Ahmedabad
  "201": { lat: 28.5355, lon: 77.3910 }, // Noida
  "122": { lat: 28.4595, lon: 77.0266 }, // Gurgaon
  "462": { lat: 23.2599, lon: 77.4126 }  // Bhopal
};

function estimateCoords(pincode, city) {
  if (pincode) {
    const pinStr = String(pincode).trim();
    if (pinStr.length >= 3) {
      const prefix = pinStr.substring(0, 3);
      if (PIN_PREFIX_COORDS[prefix]) {
        return PIN_PREFIX_COORDS[prefix];
      }
    }
  }
  if (city) {
    const cClean = String(city).trim().toLowerCase();
    if (CITY_COORDS[cClean]) {
      return CITY_COORDS[cClean];
    }
  }
  return null;
}

const computedLat = `COALESCE(
  pr.latitude,
  p.latitude, 
  CASE 
    WHEN pr.pincode LIKE '452%' THEN 22.7196
    WHEN pr.pincode LIKE '208%' THEN 26.4499
    WHEN pr.pincode LIKE '400%' THEN 19.0760
    WHEN pr.pincode LIKE '110%' THEN 28.6139
    WHEN pr.pincode LIKE '560%' THEN 12.9716
    WHEN pr.pincode LIKE '600%' THEN 13.0827
    WHEN pr.pincode LIKE '456%' THEN 23.1760
    WHEN pr.pincode LIKE '411%' THEN 18.5204
    WHEN pr.pincode LIKE '302%' THEN 26.9124
    WHEN pr.pincode LIKE '380%' THEN 23.0225
    WHEN pr.pincode LIKE '201%' THEN 28.5355
    WHEN pr.pincode LIKE '122%' THEN 28.4595
    WHEN pr.pincode LIKE '462%' THEN 23.2599
    WHEN LOWER(pr.city) = 'indore' THEN 22.7196
    WHEN LOWER(pr.city) = 'kanpur' THEN 26.4499
    WHEN LOWER(pr.city) IN ('mumbai', 'bombay') THEN 19.0760
    WHEN LOWER(pr.city) IN ('delhi', 'new delhi') THEN 28.6139
    WHEN LOWER(pr.city) IN ('bengaluru', 'bangalore') THEN 12.9716
    WHEN LOWER(pr.city) = 'chennai' THEN 13.0827
    WHEN LOWER(pr.city) = 'ujjain' THEN 23.1760
    WHEN LOWER(pr.city) = 'pune' THEN 18.5204
    WHEN LOWER(pr.city) = 'jaipur' THEN 26.9124
    WHEN LOWER(pr.city) = 'ahmedabad' THEN 23.0225
    WHEN LOWER(pr.city) = 'noida' THEN 28.5355
    WHEN LOWER(pr.city) = 'gurgaon' THEN 28.4595
    WHEN LOWER(pr.city) = 'bhopal' THEN 23.2599
    ELSE NULL
  END
)`;

const computedLon = `COALESCE(
  pr.longitude,
  p.longitude, 
  CASE 
    WHEN pr.pincode LIKE '452%' THEN 75.8577
    WHEN pr.pincode LIKE '208%' THEN 80.3319
    WHEN pr.pincode LIKE '400%' THEN 72.8777
    WHEN pr.pincode LIKE '110%' THEN 77.2090
    WHEN pr.pincode LIKE '560%' THEN 77.5946
    WHEN pr.pincode LIKE '600%' THEN 80.2707
    WHEN pr.pincode LIKE '456%' THEN 75.7885
    WHEN pr.pincode LIKE '411%' THEN 73.8567
    WHEN pr.pincode LIKE '302%' THEN 75.7873
    WHEN pr.pincode LIKE '380%' THEN 72.5714
    WHEN pr.pincode LIKE '201%' THEN 77.3910
    WHEN pr.pincode LIKE '122%' THEN 77.0266
    WHEN pr.pincode LIKE '462%' THEN 77.4126
    WHEN LOWER(pr.city) = 'indore' THEN 75.8577
    WHEN LOWER(pr.city) = 'kanpur' THEN 80.3319
    WHEN LOWER(pr.city) IN ('mumbai', 'bombay') THEN 72.8777
    WHEN LOWER(pr.city) IN ('delhi', 'new delhi') THEN 77.2090
    WHEN LOWER(pr.city) IN ('bengaluru', 'bangalore') THEN 77.5946
    WHEN LOWER(pr.city) = 'chennai' THEN 80.2707
    WHEN LOWER(pr.city) = 'ujjain' THEN 75.7885
    WHEN LOWER(pr.city) = 'pune' THEN 73.8567
    WHEN LOWER(pr.city) = 'jaipur' THEN 75.7873
    WHEN LOWER(pr.city) = 'ahmedabad' THEN 72.5714
    WHEN LOWER(pr.city) = 'noida' THEN 77.3910
    WHEN LOWER(pr.city) = 'gurgaon' THEN 77.0266
    WHEN LOWER(pr.city) = 'bhopal' THEN 77.4126
    ELSE NULL
  END
)`;

export const searchProfiles = async (req, res) => {
  try {

    /* ==========================================================
       ⭐ SHRADDHA NEW CODE START — USER FROM TOKEN (CHAT STYLE)
    ========================================================== */
    const userId = req.user?.id;
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

      // 🚫 Block ONLY if NOT unlimited AND limit reached
if (
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
      lon,
      search_mode
    } = req.query;

    let queryStr = `
      SELECT pr.*, 
             ${computedLat} as latitude, 
             ${computedLon} as longitude,
             NULL as distance_meters
      FROM profiles pr
      LEFT JOIN pincodes p ON pr.pincode = p.pincode
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

      // Fallback: If lat/lon not provided in query, attempt to fetch current user's profile location
      if ((searchLat === null || searchLon === null) && userId) {
        try {
          const userLocRes = await pool.query(
            `SELECT pr.latitude AS prof_lat, pr.longitude AS prof_lon,
                    pr.city, pr.pincode,
                    p.latitude AS pin_lat, p.longitude AS pin_lon
             FROM profiles pr
             LEFT JOIN pincodes p ON pr.pincode = p.pincode
             WHERE pr.user_id = $1`,
            [userId]
          );
          if (userLocRes.rows.length > 0) {
            const uLoc = userLocRes.rows[0];
            // Priority 1: direct GPS stored on profile
            let fetchedLat = uLoc.prof_lat || null;
            let fetchedLon = uLoc.prof_lon || null;
            // Priority 2: pincode table
            if (!fetchedLat || !fetchedLon) {
              fetchedLat = uLoc.pin_lat || null;
              fetchedLon = uLoc.pin_lon || null;
            }
            // Priority 3: pincode prefix / city name estimation
            if (!fetchedLat || !fetchedLon) {
              const est = estimateCoords(uLoc.pincode, uLoc.city);
              if (est) {
                fetchedLat = est.lat;
                fetchedLon = est.lon;
              }
            }
            if (fetchedLat && fetchedLon) {
              searchLat = Number(fetchedLat);
              searchLon = Number(fetchedLon);
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
          LEFT JOIN pincodes p ON pr.pincode = p.pincode
          WHERE 1=1
        `;

        if (city && city.trim()) {
          params.push(`%${city.trim()}%`);
          const cityIdx = idx;
          idx++;
          // Include if within radius OR city name matches
          queryStr += `
            AND (
              (
                ${computedLat} IS NOT NULL AND ${computedLon} IS NOT NULL
                AND ${distKmExpr} <= $${radIdx}
              )
              OR LOWER(pr.city) LIKE LOWER($${cityIdx})
            )
          `;
        } else {
          // Strict radius: only profiles with known coords within radius
          queryStr += `
            AND ${computedLat} IS NOT NULL
            AND ${computedLon} IS NOT NULL
            AND ${distKmExpr} <= $${radIdx}
          `;
        }
      } else if (city && city.trim()) {
        // No coordinates available — fall back to city-name only filter
        queryStr = `
          SELECT pr.*,
                 ${computedLat}       AS latitude,
                 ${computedLon}       AS longitude,
                 NULL::float          AS distance_meters
          FROM profiles pr
          LEFT JOIN pincodes p ON pr.pincode = p.pincode
          WHERE 1=1
        `;
        params.push(`%${city.trim()}%`);
        queryStr += ` AND LOWER(pr.city) LIKE LOWER($${idx})`;
        idx++;
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



    /* ==========================================================
       ⭐ SHRADDHA NEW CODE START — INCREMENT SEARCH COUNT
    ========================================================== */
    if (userId) {
      await pool.query(
        `
        UPDATE user_plans
        SET people_search_used = people_search_used + 1,
            updated_at = NOW()
        WHERE user_id = $1
        `,
        [userId]
      );
    }
    /* ==========================================================
       ⭐ SHRADDHA NEW CODE END
    ========================================================== */

    return res.json(finalRows);

  } catch (err) {
    console.error("Search API Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
