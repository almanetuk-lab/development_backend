import { pool } from './config/db.js';
async function test() {
  try {
    const r1 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='notifications' ORDER BY ordinal_position");
    console.log('notifications columns:', r1.rows.length ? r1.rows.map(x=>x.column_name).join(', ') : 'TABLE NOT FOUND');
    process.exit(0);
  } catch(e) {
    console.error('Err:', e.message);
    process.exit(1);
  }
}
test();
