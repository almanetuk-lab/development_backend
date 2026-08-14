import { pool } from "./config/db.js";

async function testSearch() {
  try {
    console.log("Searching for basic search query...");
    const searchMode = "basic";
    const firstName = "dev"; // looking for name/skill/interest/profession containing 'dev'

    // mimic controller logic:
    let queryStr = `
      SELECT pr.id, pr.first_name, pr.last_name, pr.profession, pr.skills, pr.interests, pr.city
      FROM profiles pr
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (firstName) {
      params.push(`%${firstName}%`);
      params.push(`%${firstName}%`);
      params.push(`%${firstName}%`);
      params.push(`%${firstName}%`);
      params.push(`%${firstName}%`);

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

    console.log("Executing Query:", queryStr);
    console.log("Parameters:", params);

    const { rows } = await pool.query(queryStr, params);
    console.log(`Found ${rows.length} rows:`, rows);
    process.exit(0);
  } catch (err) {
    console.error("Search failed:", err);
    process.exit(1);
  }
}

testSearch();
