import { pool } from "../config/db.js";

async function main() {
  try {
    const res = await pool.query("SELECT id, user_id, first_name, last_name, username, about_me, confidence_score, intent_tags FROM profiles LIMIT 5;");
    console.log("Existing Profiles in database:", res.rows);
    process.exit(0);
  } catch (error) {
    console.error("Error querying profiles:", error);
    process.exit(1);
  }
}

main();
