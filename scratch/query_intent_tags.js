import { pool } from "../config/db.js";

async function main() {
  try {
    const res = await pool.query(
      "SELECT id, user_id, first_name, about_me, intent_tags, confidence_score FROM profiles WHERE intent_tags IS NOT NULL LIMIT 5;"
    );
    console.log("Profiles with intent_tags:", JSON.stringify(res.rows, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("Error querying profiles:", error);
    process.exit(1);
  }
}

main();
