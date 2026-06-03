import { pool } from "../config/db.js";

async function testSuggestionsQuery() {
  const userId = 9;
  try {
    const userResult = await pool.query("SELECT intent_embedding FROM profiles WHERE user_id = $1", [userId]);
    const { intent_embedding } = userResult.rows[0];

    let searchVector = intent_embedding;
    if (typeof intent_embedding === "string") {
      searchVector = intent_embedding; // already a string
    }

    const matchQuery = `
      SELECT
          id,
          user_id,
          first_name,
          spider_graph_data
      FROM profiles
      WHERE
          user_id != $2
          AND intent_embedding IS NOT NULL
          AND (intent_embedding <=> $1) < 0.30
      ORDER BY (intent_embedding <=> $1) ASC
      LIMIT 5;
    `;

    const matchResult = await pool.query(matchQuery, [searchVector, userId]);
    console.log("Suggestions returned from DB:");
    console.dir(matchResult.rows, { depth: null });
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

testSuggestionsQuery();
