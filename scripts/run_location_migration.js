import { pool } from "../config/db.js";
import dotenv from "dotenv";

dotenv.config();

const runMigration = async () => {
  console.log("🚀 Starting database location migration...");
  try {
    // 1. Enable PostGIS extension
    console.log("⚡ Enabling PostGIS extension...");
    await pool.query("CREATE EXTENSION IF NOT EXISTS postgis;");
    console.log("✅ PostGIS extension enabled.");

    // 2. Add location column
    console.log("⚡ Adding 'location' geography column to 'profiles' table...");
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS location geography(POINT, 4326);");
    console.log("✅ 'location' column added.");

    // 3. Create spatial index
    console.log("⚡ Creating GiST spatial index on 'location' column...");
    await pool.query("CREATE INDEX IF NOT EXISTS profiles_location_gist_idx ON profiles USING gist(location);");
    console.log("✅ GiST spatial index created.");

    // 4. Create function
    console.log("⚡ Creating Postgres function 'get_nearby_profiles'...");
    const createFunctionQuery = `
      CREATE OR REPLACE FUNCTION get_nearby_profiles(
        user_lat DOUBLE PRECISION,
        user_lon DOUBLE PRECISION,
        radius_in_meters DOUBLE PRECISION
      )
      RETURNS TABLE (
        id INT,
        user_id INT,
        first_name VARCHAR,
        last_name VARCHAR,
        city VARCHAR,
        state VARCHAR,
        pincode VARCHAR,
        profession VARCHAR,
        about TEXT,
        image_url VARCHAR,
        dob DATE,
        age INT,
        distance_meters DOUBLE PRECISION
      ) 
      SECURITY DEFINER
      AS $$
      DECLARE
        user_location geography(POINT, 4326);
      BEGIN
        user_location := ST_SetSRID(ST_MakePoint(user_lon, user_lat), 4326)::geography;

        RETURN QUERY
        SELECT 
          p.id,
          p.user_id,
          p.first_name,
          p.last_name,
          p.city,
          p.state,
          p.pincode,
          p.profession,
          p.about,
          p.image_url,
          p.dob,
          p.age,
          (p.location <-> user_location) AS distance_meters
        FROM profiles p
        WHERE 
          p.location IS NOT NULL
          AND ST_DWithin(p.location, user_location, radius_in_meters)
        ORDER BY p.location <-> user_location ASC;
      END;
      $$ LANGUAGE plpgsql;
    `;
    await pool.query(createFunctionQuery);
    console.log("✅ Postgres function 'get_nearby_profiles' created.");

    console.log("🎉 Migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    console.error(error.stack);
  } finally {
    try {
      await pool.end();
      console.log("🔌 Database pool closed.");
    } catch (err) {
      console.error("Error closing database pool:", err.message);
    }
  }
};

runMigration();
