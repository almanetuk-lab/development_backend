import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
});

async function runMigration() {
  console.log("=== RUNNING REFACTORED SENTIMENT JSONB MIGRATION ===");
  try {
    const sqlPath = path.resolve(process.cwd(), 'migrations', 'migrate_sentiment_audit_to_jsonb.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log("✅ Successfully consolidated flat columns into single JSONB 'sentiment_audit' column and dropped flat columns.");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  } finally {
    await pool.end();
  }
}

runMigration();
