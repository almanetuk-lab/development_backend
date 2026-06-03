import { pool } from "../config/db.js";

async function main() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'profiles';
    `);
    console.log("profiles columns:", res.rows.map(r => `${r.column_name} (${r.data_type})`).sort());
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}
main();
