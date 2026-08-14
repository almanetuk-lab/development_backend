import { pool } from "./config/db.js";

async function testAdvancedSearch() {
  try {
    console.log("🧪 Testing Advanced Search Query Logic...");
    
    // Simulate req.query parameters for Advanced Search
    const search_mode = "advanced";
    const reqQuery = {
      first_name: "John",
      gender: "Male",
      marital_status: "Single",
      skills: "React",
      min_age: 18,
      max_age: 60
    };

    let queryStr = `
      SELECT pr.*, 
             pr.latitude as latitude, 
             pr.longitude as longitude,
             NULL as distance_meters
      FROM profiles pr
      WHERE 1=1
    `;

    const params = [];
    let idx = 1;

    const textFilters = {
      first_name: "pr.first_name",
      last_name: "pr.last_name",
      profession: "pr.profession",
      city: "pr.city",
      state: "pr.state"
    };

    for (const [key, col] of Object.entries(textFilters)) {
      if (reqQuery[key]) {
        params.push(`%${reqQuery[key]}%`);
        queryStr += ` AND LOWER(${col}) LIKE LOWER($${idx})`;
        idx++;
      }
    }

    if (reqQuery.gender) {
      params.push(reqQuery.gender);
      queryStr += ` AND LOWER(pr.gender::text) = LOWER($${idx})`;
      idx++;
    }

    if (reqQuery.marital_status) {
      params.push(reqQuery.marital_status);
      queryStr += ` AND LOWER(pr.marital_status::text) = LOWER($${idx})`;
      idx++;
    }

    if (reqQuery.skills) {
      params.push(`%${reqQuery.skills}%`);
      params.push(`%${reqQuery.skills}%`);
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

    if (reqQuery.min_age && reqQuery.max_age) {
      params.push(reqQuery.min_age, reqQuery.max_age);
      queryStr += ` AND pr.age BETWEEN $${idx} AND $${idx + 1}`;
      idx += 2;
    }

    queryStr += ` ORDER BY pr.user_id`;

    console.log("Generated SQL:", queryStr);
    console.log("Parameters:", params);

    const { rows } = await pool.query(queryStr, params);
    console.log(`✅ Success! Found ${rows.length} matching rows.`);
    if (rows.length > 0) {
      console.log("Sample Match:", {
        id: rows[0].id,
        user_id: rows[0].user_id,
        first_name: rows[0].first_name,
        gender: rows[0].gender,
        age: rows[0].age,
        skills: rows[0].skills
      });
    }
    
    process.exit(0);
  } catch (err) {
    console.error("❌ Test failed with error:", err.message);
    process.exit(1);
  }
}

testAdvancedSearch();
