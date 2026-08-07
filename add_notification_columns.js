import { pool } from './config/db.js';
async function run() {
  try {
    console.log("Adding columns to notifications table...");
    await pool.query(`
      ALTER TABLE notifications 
      ADD COLUMN IF NOT EXISTS sender_id INTEGER,
      ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS source VARCHAR(50),
      ADD COLUMN IF NOT EXISTS reaction_emoji VARCHAR(50);
    `);
    console.log("Success! Columns added successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  }
}
run();
