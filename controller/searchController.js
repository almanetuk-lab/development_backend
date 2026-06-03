import { pool } from "../config/db.js";

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
      SELECT pr.*, p.latitude, p.longitude
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
       ⭐ NEAR ME MODE (OLD — UNTOUCHED)
    ========================================================== */
    if (search_mode === "nearme") {
      if (city) {
        params.push(city);
        queryStr += ` AND LOWER(pr.city) = LOWER($${idx})`;
        idx++;
      } else if (lat && lon && radius) {
        params.push(Number(lat), Number(lon), Number(radius));
        queryStr += `
          AND p.latitude IS NOT NULL
          AND p.longitude IS NOT NULL
          AND 6371 * acos(LEAST(1,
            cos(radians($${idx})) *
            cos(radians(p.latitude)) *
            cos(radians(p.longitude) - radians($${idx + 1})) +
            sin(radians($${idx})) *
            sin(radians(p.latitude))
          )) <= $${idx + 2}
        `;
        idx += 3;
      }
    }

    //queryStr += ` ORDER BY pr.user_id LIMIT 200`;
    queryStr += ` ORDER BY pr.user_id`;

    const { rows } = await pool.query(queryStr, params);

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

    return res.json(rows);

  } catch (err) {
    console.error("Search API Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
