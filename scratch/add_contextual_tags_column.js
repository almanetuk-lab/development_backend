import { pool } from '../config/db.js';

async function main() {
  try {
    console.log('Running database schema migration...');
    
    // Add contextual_tags column to profiles table if it does not exist
    await pool.query(`
      ALTER TABLE profiles 
      ADD COLUMN IF NOT EXISTS contextual_tags JSONB;
    `);
    
    console.log('✅ Column profiles.contextual_tags JSONB added successfully.');
    
    // Query profiles table structure to verify
    const schemaCheck = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'profiles' AND column_name = 'contextual_tags'
    `);
    
    if (schemaCheck.rows.length > 0) {
      console.log('📋 Verification schema check:', schemaCheck.rows[0]);
    } else {
      console.error('❌ Migration verification failed: contextual_tags column not found!');
    }

  } catch (err) {
    console.error('❌ Error during schema migration:', err);
  } finally {
    process.exit(0);
  }
}

main();
