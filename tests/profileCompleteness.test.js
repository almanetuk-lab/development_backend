/**
 * profileCompleteness.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the profile readiness rules (utils/profileCompleteness.js).
 * Pure — no database, no network.
 *
 * Run:  node tests/profileCompleteness.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  evaluateProfileCompleteness,
  countInterests,
  isFilled,
  matchEligibleSql,
  MUST_HAVES,
  EXTRAS_REQUIRED,
} from "../utils/profileCompleteness.js";

let passed = 0;
let failed = 0;
const assert = (cond, label) => {
  if (cond) { console.log(`  ✅ PASS  ${label}`); passed++; }
  else { console.error(`  ❌ FAIL  ${label}`); failed++; }
};
const assertEqual = (a, b, label) => assert(a === b, `${label}  [expected: ${b}, got: ${a}]`);
const section = (t) => console.log(`\n📦 ${t}`);

const NOW = new Date("2026-11-13T12:00:00Z");
const ABOUT = "I love long walks, cooking for friends and learning new languages.";

const mustHaves = () => ({
  first_name: "Asha",
  dob: "1995-04-10",
  gender: "Female",
  interested_in: "Man",
  city: "London",
  relationship_goal: "Long-term",
  about_me: ABOUT,
});
const threeExtras = () => ({
  relationship_values: "Growth",
  relationship_pace: "Slowly",
  religious_belief: "Spiritual",
});
const evalP = (p, prompts = {}) => evaluateProfileCompleteness(p, prompts, NOW);

section("Empty profile");
{
  const c = evalP({});
  assertEqual(c.isReady, false, "empty profile is not ready");
  assertEqual(c.percent, 0, "empty profile is 0%");
  assertEqual(c.mustHaves.missing.length, MUST_HAVES.length, "all must-haves missing");
  assertEqual(evalP(null).isReady, false, "null profile handled");
}

section("Must-haves");
{
  const c = evalP(mustHaves());
  assertEqual(c.mustHaves.missing.length, 0, "all must-haves filled");
  assertEqual(c.isReady, false, "must-haves alone are not ready");
  assertEqual(c.percent, 70, "7 of 10 slots = 70%");

  for (const key of ["first_name", "gender", "interested_in", "city", "relationship_goal"]) {
    const p = { ...mustHaves(), ...threeExtras(), [key]: "   " };
    assertEqual(evalP(p).isReady, false, `whitespace-only ${key} blocks readiness`);
  }
  assertEqual(evalP({ ...mustHaves(), ...threeExtras(), about_me: "x".repeat(49) }).isReady, false, "about_me 49 chars → not ready");
  assertEqual(evalP({ ...mustHaves(), ...threeExtras(), about_me: "x".repeat(50) }).isReady, true, "about_me 50 chars → ready");
  assertEqual(evalP({ ...mustHaves(), ...threeExtras(), about_me: `   ${"x".repeat(48)}   ` }).isReady, false, "about_me padding doesn't count");
}

section("Age");
{
  const base = { ...mustHaves(), ...threeExtras() };
  assertEqual(evalP({ ...base, dob: "2010-01-01" }).isReady, false, "under-18 DOB → not ready");
  assertEqual(evalP({ ...base, dob: "2008-11-13" }).isReady, true, "exactly 18 today → ready");
  assertEqual(evalP({ ...base, dob: "2008-11-14" }).isReady, false, "18 tomorrow → not ready");
  assertEqual(evalP({ ...base, dob: null, age: 30 }).isReady, true, "age column used when no DOB");
  assertEqual(evalP({ ...base, dob: null, age: null }).isReady, false, "no DOB and no age → not ready");
  assertEqual(evalP({ ...base, dob: new Date("1990-01-01") }).isReady, true, "DOB as Date object (pg row) works");
}

section("Extras");
{
  const two = { ...mustHaves(), relationship_values: "Growth", relationship_pace: "Slowly" };
  assertEqual(evalP(two).isReady, false, "7 + 2 extras → not ready");
  assertEqual(evalP(two).percent, 90, "7 + 2 extras = 90%");
  assertEqual(evalP({ ...mustHaves(), ...threeExtras() }).isReady, true, "7 + 3 extras → ready");
  assertEqual(evalP({ ...mustHaves(), ...threeExtras() }).percent, 100, "ready = 100%");
  assertEqual(
    evalP({ ...mustHaves(), ...threeExtras(), children_preference: "Want" }).percent,
    100,
    "more than 3 extras still caps at 100%"
  );

  assertEqual(evalP({ ...two, smoking: "No" }).isReady, false, "smoking alone doesn't count");
  assertEqual(evalP({ ...two, smoking: "No", drinking: "Socially" }).isReady, true, "smoking + drinking counts as one");

  assertEqual(evalP({ ...two, life_rhythms: {} }).isReady, false, "empty life_rhythms doesn't count");
  assertEqual(evalP({ ...two, life_rhythms: { morning: "" } }).isReady, false, "life_rhythms with blank values doesn't count");
  assertEqual(evalP({ ...two, life_rhythms: { morning: "Early riser" } }).isReady, true, "life_rhythms with a value counts");
  assertEqual(evalP({ ...two, life_rhythms: '{"morning":"Early"}' }).isReady, true, "life_rhythms as JSON string counts");

  assertEqual(evalP(two, { q1: "  " }).isReady, false, "blank prompt answer doesn't count");
  assertEqual(evalP(two, { q1: "Sunday mornings with family" }).isReady, true, "one prompt answer counts");
  assertEqual(evaluateProfileCompleteness({ ...two, prompts: { q1: "Yes" } }, undefined, NOW).isReady, true, "prompts read from profile.prompts when not passed");
}

section("Interests");
{
  assertEqual(countInterests({ interests: ["Hiking", "Chess"] }), 2, "array of 2");
  assertEqual(countInterests({ interests: "Hiking, Chess, Yoga" }), 3, "comma string of 3");
  assertEqual(countInterests({ ways_i_spend_time: { Sports: ["Tennis"], Arts: ["Music", "Film"] } }), 3, "categories object of 3");
  assertEqual(countInterests({ interests: ["Hiking"], ways_i_spend_time: { Outdoors: ["Hiking", "Camping"] } }), 2, "duplicates across both fields count once");
  assertEqual(countInterests({ interests: "{}", ways_i_spend_time: "{}" }), 0, "empty JSON strings → 0");
  const two = { ...mustHaves(), relationship_values: "Growth", relationship_pace: "Slowly" };
  assertEqual(evalP({ ...two, interests: ["a", "b"] }).isReady, false, "2 interests don't count");
  assertEqual(evalP({ ...two, interests: ["a", "b", "c"] }).isReady, true, "3 interests count");
}

section("Photo (not required for now)");
{
  assertEqual(evalP({ ...mustHaves(), ...threeExtras(), image_url: null }).isReady, true, "ready without a photo");
}

section("Helpers");
{
  assertEqual(isFilled(0), true, "number 0 is filled (e.g. an answer index)");
  assertEqual(isFilled([]), false, "empty array not filled");
  assertEqual(isFilled({ a: { b: "x" } }), true, "nested object with value is filled");
  assert(matchEligibleSql("pr.user_id").includes("mep.user_id = pr.user_id"), "matchEligibleSql uses the given id expression");
  assertEqual(EXTRAS_REQUIRED, 3, "3 extras required");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
