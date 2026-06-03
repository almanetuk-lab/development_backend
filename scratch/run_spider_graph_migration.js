import { pool } from "../config/db.js";

async function runMigration() {
  try {
    console.log("Running migration to add spider_graph_data column...");
    await pool.query(`
      ALTER TABLE profiles 
      ADD COLUMN IF NOT EXISTS spider_graph_data JSONB;
    `);
    console.log("Migration successful!");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    process.exit(0);
  }
}

runMigration();
