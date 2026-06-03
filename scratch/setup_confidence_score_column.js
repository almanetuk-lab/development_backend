import { pool } from "../config/db.js";

async function main() {
  try {
    console.log("Checking profiles table for confidence_score column...");
    
    // Add column if it doesn't exist
    const alterQuery = `
      ALTER TABLE profiles 
      ADD COLUMN IF NOT EXISTS confidence_score FLOAT8 DEFAULT 0.50;
    `;
    await pool.query(alterQuery);
    console.log("✅ Column confidence_score (FLOAT8) verified/added successfully.");

    // Retrieve column information to verify
    const verifyQuery = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'profiles' AND column_name = 'confidence_score';
    `;
    const res = await pool.query(verifyQuery);
    console.log("Database verify result:", res.rows);
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Error setting up confidence_score column:", error);
    process.exit(1);
  }
}

main();
