import { pool } from "../config/db.js";

async function main() {
  try {
    const resComp = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'profile_compatibilities';
    `);
    console.log("profile_compatibilities columns:", resComp.rows);
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}
main();
