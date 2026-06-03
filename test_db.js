import { pool } from './config/db.js';
async function test() {
  try {
    const arr = Array(768).fill(0.1);
    const vectorStr = JSON.stringify(arr);
    const res = await pool.query('SELECT COALESCE($1::vector, intent_embedding) as v FROM profiles WHERE username = $2', [vectorStr, 'devimran78']);
    console.log('Success!', res.rows[0].v ? 'got vector' : 'null');
    process.exit(0);
  } catch(e) {
    console.error('Err:', e.message);
    process.exit(1);
  }
}
test();
