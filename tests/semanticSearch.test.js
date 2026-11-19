/**
 * semanticSearch.test.js
 * Unit tests for the AI Suggestions refinement ("semantic search") helpers in
 * services/queryRefinementService.js. Pure functions — no database, no Gemini.
 *
 * Run:  node tests/semanticSearch.test.js
 */

import {
  buildTemporarySemanticText,
  blendEmbeddings,
  getAdaptiveWeights,
  getBlendRatio,
  rescoreSuggestions,
  validateRefinementInput,
  BLEND_RATIOS,
  MAX_QUERY_LENGTH,
  MAX_DISTANCE_DEFAULT,
  MAX_DISTANCE_REFINED,
} from "../services/queryRefinementService.js";

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✅ PASS  ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL  ${label}  [expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}]`);
    failed++;
  }
}

function assertTrue(cond, label) {
  assertEqual(Boolean(cond), true, label);
}

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ── validateRefinementInput ──────────────────────────────────────────────── */
console.log("\n📦 validateRefinementInput");

assertEqual(validateRefinementInput([], "").ok, false, "no pillars + no text → rejected");
assertEqual(validateRefinementInput([], "  ").ok, false, "whitespace-only text → rejected");
assertEqual(validateRefinementInput([], "ab").ok, false, "text under 3 chars → rejected");
assertEqual(validateRefinementInput(undefined, undefined).ok, false, "missing fields → rejected");
assertEqual(validateRefinementInput(["bogus"], "").ok, false, "only invalid pillars → rejected");

assertEqual(
  validateRefinementInput([], "  doctor who loves hiking  "),
  { ok: true, priorities: [], rawQuery: "doctor who loves hiking" },
  "text only → accepted and trimmed"
);
assertEqual(
  validateRefinementInput(["lifestyle_sync"], ""),
  { ok: true, priorities: ["lifestyle_sync"], rawQuery: "" },
  "pillars only → accepted (existing behaviour)"
);
assertEqual(
  validateRefinementInput(["lifestyle_sync", "bogus", "lifestyle_sync", "shared_ambition", "calm_communication", "long_term_stability"], "x y z").priorities,
  ["lifestyle_sync", "shared_ambition", "calm_communication"],
  "invalid and duplicate pillars dropped, capped at 3"
);
assertEqual(
  validateRefinementInput([], "a".repeat(500)).rawQuery.length,
  MAX_QUERY_LENGTH,
  "text truncated to MAX_QUERY_LENGTH"
);
assertEqual(validateRefinementInput("lifestyle_sync", "").ok, false, "non-array pillars ignored");
assertEqual(validateRefinementInput([], 12345).ok, false, "non-string query ignored");

/* ── buildTemporarySemanticText ───────────────────────────────────────────── */
console.log("\n📦 buildTemporarySemanticText");

assertEqual(buildTemporarySemanticText([], "doctor who loves hiking"), "doctor who loves hiking", "text only → exactly the query");
assertEqual(buildTemporarySemanticText([], ""), "", "nothing → empty string");

const both = buildTemporarySemanticText(["lifestyle_sync"], "doctor who loves hiking");
assertTrue(both.startsWith("doctor who loves hiking. "), "query comes before pillar sentences");
assertTrue(both.includes("lifestyle synchronization"), "pillar sentence still included");
assertTrue(!both.includes("Personal note"), "no 'Personal note' prefix");

const pillarsOnly = buildTemporarySemanticText(["lifestyle_sync"], "");
assertTrue(pillarsOnly.startsWith("I want lifestyle synchronization"), "pillars only → pillar sentence");

assertTrue(
  buildTemporarySemanticText([], "x", "anxious").endsWith("Current emotional state: anxious"),
  "emotional state appended last"
);
assertTrue(
  buildTemporarySemanticText([], "doctor") !== buildTemporarySemanticText([], "artist"),
  "different queries → different text"
);

/* ── getBlendRatio ────────────────────────────────────────────────────────── */
console.log("\n📦 getBlendRatio");

assertEqual(getBlendRatio({ hasQuery: true, hasPriorities: false }), BLEND_RATIOS.TEXT_ONLY, "text only");
assertEqual(getBlendRatio({ hasQuery: true, hasPriorities: true }), BLEND_RATIOS.TEXT_AND_PILLARS, "text + pillars");
assertEqual(getBlendRatio({ hasQuery: false, hasPriorities: true }), BLEND_RATIOS.PILLARS_ONLY, "pillars only");
assertEqual(BLEND_RATIOS.PILLARS_ONLY, 0.6, "pillars-only keeps the previous 0.60 ratio");
assertTrue(
  BLEND_RATIOS.TEXT_ONLY < BLEND_RATIOS.TEXT_AND_PILLARS && BLEND_RATIOS.TEXT_AND_PILLARS < BLEND_RATIOS.PILLARS_ONLY,
  "user text gets more weight the less the pillars say"
);

/* ── blendEmbeddings ──────────────────────────────────────────────────────── */
console.log("\n📦 blendEmbeddings");

const blended = blendEmbeddings([1, 0], [0, 1], 0.3);
const norm = Math.hypot(0.3, 0.7);
assertTrue(close(blended[0], 0.3 / norm) && close(blended[1], 0.7 / norm), "weighted 30/70 and L2-normalised");
assertTrue(close(Math.hypot(...blended), 1), "result has unit length");
assertEqual(blendEmbeddings([1, 0], [0, 1, 0], 0.3), [1, 0], "dimension mismatch → profile vector");
assertEqual(blendEmbeddings([1, 0], null, 0.3), [1, 0], "no session vector → profile vector");
assertEqual(blendEmbeddings(null, [0, 1], 0.3), [0, 1], "no profile vector → session vector");

/* ── distance thresholds ──────────────────────────────────────────────────── */
console.log("\n📦 distance thresholds");

assertEqual(MAX_DISTANCE_DEFAULT, 0.3, "default cutoff unchanged");
assertTrue(MAX_DISTANCE_REFINED > MAX_DISTANCE_DEFAULT, "refined cutoff is looser");

/* ── weights with no pillars ──────────────────────────────────────────────── */
console.log("\n📦 getAdaptiveWeights / rescoreSuggestions with no pillars");

const base = getAdaptiveWeights([]);
assertTrue(close(Object.values(base).reduce((s, v) => s + v, 0), 1, 1e-6), "base weights sum to 1");

const rescored = rescoreSuggestions(
  [
    { user_id: 1, compatibility_score: 50, local_scores: { vector_similarity: 40, intent_tag_match: 40 } },
    { user_id: 2, compatibility_score: 60, local_scores: { vector_similarity: 90, intent_tag_match: 90 } },
  ],
  base
);
assertEqual(rescored.map((s) => s.user_id), [2, 1], "re-ranked by adjusted score");
assertTrue(rescored.every((s) => s.is_refined === true), "marked as refined");

/* ── summary ──────────────────────────────────────────────────────────────── */
console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
