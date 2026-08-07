// migrate_lat_lon.js — adds latitude/longitude columns to profiles if missing
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await pool.query(`
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS latitude  FLOAT8;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS longitude FLOAT8;
  `);
  console.log("✅  latitude & longitude columns ensured on profiles table.");
} catch (err) {
  console.error("❌  Migration failed:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
