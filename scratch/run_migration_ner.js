import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
  console.log("=== MIGRATION: ADD NORMALIZED_ENTITIES ===");
  try {
    await pool.query(`
      ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS normalized_entities JSONB;
    `);
    console.log("✅ Successfully added normalized_entities JSONB column to profiles table.");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  } finally {
    await pool.end();
  }
}

runMigration();
