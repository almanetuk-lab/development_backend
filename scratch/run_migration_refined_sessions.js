/**
 * run_migration_refined_query_sessions.js
 * Executes the migration to create the refined_query_sessions table.
 */
import { pool } from "../config/db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== MIGRATION: CREATE refined_query_sessions TABLE ===");
  try {
    const sqlPath = path.join(__dirname, "..", "migrations", "add_refined_query_sessions.sql");
    const sql = fs.readFileSync(sqlPath, "utf-8");
    await pool.query(sql);
    console.log("✅ Successfully created refined_query_sessions table and indexes.");

    // Verify
    const verify = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'refined_query_sessions'
      ORDER BY ordinal_position;
    `);
    console.log("📋 Table columns:", verify.rows.map(r => `${r.column_name} (${r.data_type})`));
  } catch (error) {
    console.error("❌ Migration error:", error.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

main();
