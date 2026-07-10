import { pool } from './config/db.js';
async function test() {
  try {
    const r1 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='trust_history' ORDER BY ordinal_position");
    const r2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='trust_score'");
    console.log('trust_history columns:', r1.rows.length ? r1.rows.map(x=>x.column_name).join(', ') : 'TABLE NOT FOUND');
    console.log('users.trust_score exists:', r2.rows.length > 0);
    process.exit(0);
  } catch(e) {
    console.error('Err:', e.message);
    process.exit(1);
  }
}
test();
