import { pool } from '../config/db.js';

async function diagnose() {
  try {
    // 1. Users with embeddings
    const r1 = await pool.query(
      'SELECT user_id, first_name, confidence_score FROM profiles WHERE intent_embedding IS NOT NULL ORDER BY user_id'
    );
    console.log('\n✅ Users WITH embeddings:', JSON.stringify(r1.rows));

    // 2. Table schema
    const r2 = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'profile_compatibilities'
      ORDER BY ordinal_position
    `);
    console.log('\n📋 profile_compatibilities schema:');
    r2.rows.forEach(c => console.log(`   ${c.column_name} | ${c.data_type} | nullable=${c.is_nullable}`));

    // 3. Profile prompts count
    const r3 = await pool.query('SELECT COUNT(*) as total FROM profile_prompts');
    console.log('\n📋 Total profile_prompts rows:', r3.rows[0].total);

    // 4. Profiles with about_me but missing intent_tags
    const r4 = await pool.query(`
      SELECT COUNT(*) as count FROM profiles 
      WHERE about_me IS NOT NULL AND about_me != '' AND intent_tags IS NULL
    `);
    console.log('\n⚠️  Profiles with about_me but NO intent_tags:', r4.rows[0].count);

    // 5. All profiles summary
    const r5 = await pool.query(`
      SELECT user_id, first_name, 
        (about_me IS NOT NULL AND about_me != '') as has_about,
        intent_tags IS NOT NULL as has_tags,
        intent_embedding IS NOT NULL as has_embedding,
        confidence_score,
        is_submitted
      FROM profiles 
      WHERE is_submitted = true OR (about_me IS NOT NULL AND about_me != '')
      ORDER BY user_id
      LIMIT 20
    `);
    console.log('\n📊 Submitted/active profiles:');
    r5.rows.forEach(p => {
      console.log(`   user_id=${p.user_id} | ${p.first_name || 'unnamed'} | about=${p.has_about} | tags=${p.has_tags} | embed=${p.has_embedding} | conf=${p.confidence_score} | submitted=${p.is_submitted}`);
    });

    // 6. Test direct INSERT to profile_compatibilities
    console.log('\n🧪 Testing direct INSERT into profile_compatibilities...');
    const testInsert = await pool.query(`
      INSERT INTO profile_compatibilities 
        (user_a_id, user_b_id, compatibility_data, overall_score, ai_summary, compatibility_type, updated_at)
      VALUES 
        (1, 2, '{"test": true}'::jsonb, 75, 'Test summary', 'Test Type', NOW())
      ON CONFLICT (user_a_id, user_b_id)
      DO UPDATE SET overall_score = EXCLUDED.overall_score, updated_at = NOW()
      RETURNING id, overall_score, updated_at
    `);
    console.log('✅ INSERT test result:', JSON.stringify(testInsert.rows[0]));

    // Clean up test row
    await pool.query('DELETE FROM profile_compatibilities WHERE user_a_id = 1 AND user_b_id = 2');
    console.log('🧹 Test row cleaned up.');

    // 7. Check pgvector extension
    const r7 = await pool.query(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
    console.log('\n🔌 pgvector extension installed:', r7.rows.length > 0 ? 'YES' : 'NO');

    // 8. Check unique constraint
    const r8 = await pool.query(`
      SELECT constraint_name, constraint_type 
      FROM information_schema.table_constraints 
      WHERE table_name = 'profile_compatibilities'
    `);
    console.log('\n🔒 Constraints on profile_compatibilities:', JSON.stringify(r8.rows));

  } catch (err) {
    console.error('❌ Diagnostic Error:', err.message);
    console.error(err.stack);
  } finally {
    process.exit(0);
  }
}

diagnose();
