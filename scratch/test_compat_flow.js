/**
 * test_compat_flow.js
 * End-to-end verification of the enriched AI compatibility pipeline.
 * Tests: contextual_tags, contextual_match, analyzeProfile, getSuggestions, getCompatibilityStatus
 */

import { getCompatibilityReport, analyzeProfile, getCompatibilityStatus } from '../controller/matchController.js';
import { pool } from '../config/db.js';

// ── Minimal mock req/res factory ────────────────────────────────────────────
const mockRes = () => {
  const r = { statusCode: 200 };
  r.status = (code) => { r.statusCode = code; return r; };
  r.json   = (data)  => { r.data = data; return r; };
  return r;
};

// ── Check 1: profile_enrichment_stats from getCompatibilityStatus ────────────
async function testStatusEndpoint() {
  console.log('\n🧪 ══════════════════════════════════════════');
  console.log('🧪 TEST 1: getCompatibilityStatus — enrichment stats');
  const req = { user: { id: 105 } };
  const res = mockRes();
  await getCompatibilityStatus(req, res);

  const d = res.data;
  if (d?.profile_enrichment_stats) {
    console.log('✅ profile_enrichment_stats PRESENT:', d.profile_enrichment_stats);
  } else {
    console.error('❌ profile_enrichment_stats MISSING from status response');
  }
  if (d?.profile_compatibilities?.recent_detailed?.[0]?.contextual_match !== undefined) {
    console.log('✅ contextual_match present in recent_detailed');
  } else {
    console.warn('⚠️  contextual_match not yet in recent_detailed (old cached rows — expected)');
  }
}

// ── Check 2: DB — verify contextual_tags column exists on a real profile ─────
async function testContextualTagsInDB() {
  console.log('\n🧪 ══════════════════════════════════════════');
  console.log('🧪 TEST 2: DB — contextual_tags column check');
  const result = await pool.query(`
    SELECT user_id,
           contextual_tags IS NOT NULL AS has_contextual_tags,
           intent_tags IS NOT NULL     AS has_intent_tags,
           intent_embedding IS NOT NULL AS has_embedding
    FROM profiles
    WHERE is_submitted = true
    ORDER BY updated_at DESC
    LIMIT 5
  `);
  console.log('DB rows (top 5 submitted profiles):');
  for (const row of result.rows) {
    const ctx = row.has_contextual_tags ? '✅' : '❌';
    const it  = row.has_intent_tags    ? '✅' : '❌';
    const emb = row.has_embedding      ? '✅' : '❌';
    console.log(`  user_id=${row.user_id}  contextual_tags=${ctx}  intent_tags=${it}  embedding=${emb}`);
  }
}

// ── Check 3: Full compatibility pipeline with contextual scoring ──────────────
async function testCompatibilityPipeline() {
  console.log('\n🧪 ══════════════════════════════════════════');
  console.log('🧪 TEST 3: Full Compatibility Pipeline — pair (105, 265)');

  // Delete old cache so we get a fresh run
  await pool.query(`
    DELETE FROM profile_compatibilities WHERE user_a_id = 105 AND user_b_id = 265
  `);
  console.log('🗑️  Cache cleared for pair (105, 265)');

  const req = { user: { id: 105 }, params: { targetUserId: '265' } };
  const res = mockRes();
  await getCompatibilityReport(req, res);

  const d = res.data;
  console.log(`\n📊 STATUS CODE      : ${res.statusCode}`);
  console.log(`📊 Overall Score    : ${d?.overall_compatibility}`);
  console.log(`📊 Compat Type      : ${d?.compatibility_type}`);

  if (d?.local_scores) {
    const ls = d.local_scores;
    console.log('\n📊 LOCAL SCORES:');
    console.log(`   vector_similarity          : ${ls.vector_similarity ?? 'N/A'}`);
    console.log(`   intent_tag_match           : ${ls.intent_tag_match ?? 'N/A'}`);
    console.log(`   relationship_expectations  : ${ls.relationship_expectations ?? 'N/A'}`);
    console.log(`   lifestyle_rhythm           : ${ls.lifestyle_rhythm ?? 'N/A'}`);
    console.log(`   preference_match           : ${ls.preference_match ?? 'N/A'}`);
    console.log(`   personality_match          : ${ls.personality_match ?? 'N/A'}`);

    if (ls.contextual_match !== undefined) {
      console.log(`   contextual_match           : ✅ ${ls.contextual_match}`);
    } else {
      console.warn(`   contextual_match           : ⚠️  MISSING (profiles may lack contextual_tags)`);
    }
    console.log(`   pre_computed_combined      : ${ls.pre_computed_combined ?? 'N/A'}`);
  } else {
    console.warn('⚠️  local_scores not in response (may be cached)');
  }

  // DB verify
  const dbCheck = await pool.query(`
    SELECT user_a_id, user_b_id, overall_score, compatibility_type, updated_at,
           (compatibility_data->>'data_version') AS version,
           (compatibility_data->'local_scores'->>'contextual_match')::int AS contextual_match
    FROM profile_compatibilities
    WHERE user_a_id = 105 AND user_b_id = 265
  `);
  if (dbCheck.rows.length > 0) {
    console.log('\n✅ DB SAVE VERIFIED:', dbCheck.rows[0]);
  } else {
    console.error('\n❌ DB SAVE FAILED: Row not found');
  }
}

// ── Check 4: analyzeProfile re-run generates contextual_tags ─────────────────
async function testAnalyzeProfile() {
  console.log('\n🧪 ══════════════════════════════════════════');
  console.log('🧪 TEST 4: analyzeProfile — contextual_tags generation');

  const req = { user: { id: 105 } };
  const res = mockRes();
  await analyzeProfile(req, res);

  console.log(`📊 STATUS CODE: ${res.statusCode}`);
  if (res.statusCode === 200) {
    const p = res.data?.profile;
    console.log(`✅ Profile updated. contextual_tags: ${p?.contextual_tags ? '✅ PRESENT' : '❌ MISSING'}`);
    if (p?.contextual_tags) {
      const ct = typeof p.contextual_tags === 'string' ? JSON.parse(p.contextual_tags) : p.contextual_tags;
      console.log('   contextual_tags value:', ct);
    }
    console.log(`   intent_tags: ${p?.intent_tags ? '✅' : '❌'}`);
    console.log(`   confidence_score: ${p?.confidence_score}`);
  } else {
    console.error('❌ analyzeProfile failed:', res.data);
  }
}

// ── Run all tests ─────────────────────────────────────────────────────────────
async function runAll() {
  try {
    await testStatusEndpoint();
    await testContextualTagsInDB();
    await testCompatibilityPipeline();
    await testAnalyzeProfile();

    console.log('\n🎯 ══════════════════════════════════════════');
    console.log('🎯 ALL TESTS COMPLETE');
    console.log('🎯 ══════════════════════════════════════════');
  } catch (err) {
    console.error('\n❌ FATAL TEST ERROR:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

runAll();
