import { pool } from "../config/db.js";

async function main() {
  try {
    const res = await pool.query(
      "SELECT id, user_id, first_name, intent_tags FROM profiles WHERE user_id IN (105, 265);"
    );
    console.log("Profiles details:", JSON.stringify(res.rows, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("Error querying profiles:", error);
    process.exit(1);
  }
}

main();
