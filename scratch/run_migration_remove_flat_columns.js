import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
  console.log("🚀 STARTING MIGRATION: REMOVE DUPLICATE FLAT COLUMNS");
  
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("📦 Dropping indexes if they exist...");
    await client.query("DROP INDEX IF EXISTS idx_profiles_ambition_level;");
    await client.query("DROP INDEX IF EXISTS idx_profiles_relationship_intent;");

    console.log("📦 Dropping duplicate columns from profiles table...");
    await client.query(`
      ALTER TABLE profiles 
      DROP COLUMN IF EXISTS communication_style,
      DROP COLUMN IF EXISTS social_preference,
      DROP COLUMN IF EXISTS ambition_level,
      DROP COLUMN IF EXISTS stress_cycle,
      DROP COLUMN IF EXISTS relationship_intent;
    `);

    await client.query("COMMIT");
    console.log("🎉 MIGRATION SUCCESSFUL: Flat psychological columns dropped successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed:", error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
