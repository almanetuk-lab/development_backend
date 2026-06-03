import { pool } from '../config/db.js';

async function fixSchema() {
  try {
    console.log('Adding missing columns to profile_compatibilities...');
    
    await pool.query(`
      ALTER TABLE profile_compatibilities 
      ADD COLUMN IF NOT EXISTS overall_score INT,
      ADD COLUMN IF NOT EXISTS ai_summary TEXT,
      ADD COLUMN IF NOT EXISTS compatibility_type VARCHAR(255);
    `);
    
    console.log('✅ Columns added successfully.');
    
    const r2 = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'profile_compatibilities'
      ORDER BY ordinal_position
    `);
    console.log('\n📋 NEW profile_compatibilities schema:');
    r2.rows.forEach(c => console.log(`   ${c.column_name} | ${c.data_type} | nullable=${c.is_nullable}`));

  } catch (err) {
    console.error('❌ Error updating schema:', err);
  } finally {
    process.exit(0);
  }
}

fixSchema();
