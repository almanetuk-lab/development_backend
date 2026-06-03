import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
  console.log("=== RUNNING SENTIMENT AUDIT MIGRATION ===");
  try {
    const sqlPath = path.resolve(process.cwd(), 'migrations', 'add_sentiment_audit_columns.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log("✅ Successfully ran migration to add sentiment audit columns.");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  } finally {
    await pool.end();
  }
}

runMigration();
