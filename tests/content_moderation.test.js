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
process.env.MODERATION_SEVERE_WORDS = "almanetsevereword";

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

// ─── Disguised spellings ──────────────────────────────────────────────────────
section("Disguised spellings are flagged");
for (const [text, word] of [
  ["f*ck you", "fuck"],
  ["sh1t happens", "shit"],
  ["f u c k this", "fuck"],
  ["f.u.c.k off", "fuck"],
  ["fuuuuuck", "fuck"],
  ["what a fück", "fuck"],
  ["you b!tch", "bitch"],
]) {
  r = checkContent(text);
  assertEqual(r.isFlagged, true, `"${text}" is flagged`);
  assert(r.matchedWords.includes(word), `"${text}" matches "${word}"  [got: ${r.matchedWords.join(", ")}]`);
}

// ─── Severity tiers ───────────────────────────────────────────────────────────
section("Severity tiers");
assertEqual(checkContent("Hi there").severity, "none", "clean → none");
assertEqual(checkContent("this is crap").severity, "mild", "crap → mild");
assertEqual(checkContent("what the fuck").severity, "mild", "fuck → mild");
assertEqual(checkContent("you stupid cunt").severity, "severe", "slur/sexual term → severe");
assertEqual(checkContent("you are a whore").severity, "severe", "whore → severe");
assertEqual(checkContent("bunch of sluts").severity, "severe", "plural of severe term → severe");
assertEqual(checkContent("he raped").severity, "severe", "inflection of severe term → severe");
assertEqual(checkContent("c*nt").severity, "severe", "masked severe word with one reading → severe");
assertEqual(checkContent("s**t").severity, "mild", "masked word that could be mild → mild");
assertEqual(checkContent("shit, you cunt").severity, "severe", "mixed tiers → severe wins");
assertEqual(checkContent("you almanetsevereword").severity, "severe", "MODERATION_SEVERE_WORDS adds a severe word");

// ─── Severe phrases ───────────────────────────────────────────────────────────
section("Severe phrases");
for (const text of ["just kill yourself", "Go  DIE!!", "I'll kill you", "i hope u die", "kys"]) {
  r = checkContent(text);
  assertEqual(r.severity, "severe", `"${text}" → severe`);
}
assertEqual(checkContent("this traffic will kill me").isFlagged, false, "everyday 'kill' is not flagged");
assertEqual(checkContent("I could die laughing").isFlagged, false, "everyday 'die' is not flagged");

// ─── No false positives ───────────────────────────────────────────────────────
section("Common words are not flagged");
for (const text of [
  "I live near Scunthorpe",
  "my class starts at 9",
  "the assassin's creed",
  "these spices are great",
  "I passed the grape test",
  "classic cocktail",
  "1 2 3 go",
  "email me at a@b.com",
  "that costs $50",
]) {
  assertEqual(checkContent(text).isFlagged, false, `"${text}"`);
}

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
