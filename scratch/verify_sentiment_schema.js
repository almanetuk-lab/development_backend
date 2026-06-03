import { pool } from '../config/db.js';

const REQUIRED_COLUMNS = [
  'sentiment_audit',
];

try {
  const result = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'profiles'
      AND column_name = ANY($1)
    ORDER BY column_name
  `, [REQUIRED_COLUMNS]);

  const found = result.rows.map(r => r.column_name);
  const missing = REQUIRED_COLUMNS.filter(c => !found.includes(c));

  console.log('\n✅ COLUMNS FOUND (' + found.length + '/' + REQUIRED_COLUMNS.length + '):');
  result.rows.forEach(r => console.log(`   ✓ ${r.column_name} (${r.data_type})`));

  if (missing.length > 0) {
    console.log('\n❌ MISSING COLUMNS (' + missing.length + '):');
    missing.forEach(c => console.log(`   ✗ ${c}`));
    console.log('\n⚠️  Run the sentiment migration SQL before enabling ENABLE_SENTIMENT_AUDIT=true');
  } else {
    console.log('\n🟢 All required sentiment columns are present. Safe to enable ENABLE_SENTIMENT_AUDIT=true');
  }
} catch (err) {
  console.error('❌ Schema check failed:', err.message);
} finally {
  await pool.end();
}
