/**
 * content_moderation.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for checkContent() in services/contentModerationService.js.
 *
 * Run:  cd development_backend && node tests/content_moderation.test.js
 *
 * Hermetic: never touches the database (recordFlag is not exercised here).
 * ─────────────────────────────────────────────────────────────────────────────
 */

// The word lists are read at module load, so set them before importing.
process.env.MODERATION_EXTRA_WORDS = "almanetbadword";
process.env.MODERATION_ALLOWED_WORDS = "hell";
process.env.ENABLE_CONTENT_MODERATION = "true";

const { checkContent } = await import("../services/contentModerationService.js");

// ─── Minimal test harness ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ PASS  ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL  ${label}`);
    failed++;
  }
}

function assertEqual(a, b, label) {
  assert(a === b, `${label}  [expected: ${b}, got: ${a}]`);
}

function section(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`📦 ${title}`);
  console.log("─".repeat(60));
}

// ─── Clean content ────────────────────────────────────────────────────────────
section("Clean content is not flagged");
assertEqual(checkContent("Hi! Would you like to grab coffee this weekend?").isFlagged, false, "friendly message");
assertEqual(checkContent("I took a class on assassin bugs").isFlagged, false, "substring of a bad word (class, assassin)");

// ─── Profane content ──────────────────────────────────────────────────────────
section("Profane content is flagged");
let r = checkContent("you are a bitch");
assertEqual(r.isFlagged, true, "plain profanity");
assert(r.matchedWords.includes("bitch"), "matchedWords contains the word");

r = checkContent("What the FUCK!!!");
assertEqual(r.isFlagged, true, "uppercase with repeated punctuation");
assert(r.matchedWords.includes("fuck"), "matchedWords is lowercased and punctuation-stripped");

r = checkContent("bitch bitch bitch");
assertEqual(r.matchedWords.length, 1, "matchedWords is de-duplicated");

// ─── Empty / attachment-only ──────────────────────────────────────────────────
section("Empty content is never flagged");
for (const value of [null, undefined, "", "   ", 42, {}]) {
  assertEqual(checkContent(value).isFlagged, false, `input: ${JSON.stringify(value)}`);
}

// ─── Env overrides ────────────────────────────────────────────────────────────
section("Env word-list overrides");
assertEqual(checkContent("go to hell").isFlagged, false, "MODERATION_ALLOWED_WORDS removes a word");
assertEqual(checkContent("you almanetbadword").isFlagged, true, "MODERATION_EXTRA_WORDS adds a word");

process.env.ENABLE_CONTENT_MODERATION = "false";
assertEqual(checkContent("you are a bitch").isFlagged, false, "kill switch disables moderation");
process.env.ENABLE_CONTENT_MODERATION = "true";

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("═".repeat(60));
process.exit(failed > 0 ? 1 : 0);
