/**
 * moderation_rules.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the auto-moderation escalation ladder in utils/moderationRules.js.
 *
 * Run:  cd development_backend && node tests/moderation_rules.test.js
 *
 * Hermetic: pure functions only, never touches the database.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  MUTED_CODE,
  computeMutedUntil,
  decideAutoAction,
  mutedPayload,
} from "../utils/moderationRules.js";

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

// ─── Ladder ───────────────────────────────────────────────────────────────────
section("decideAutoAction ladder");
for (const bad of [0, -1, 1.5, NaN, null, undefined, "abc"]) {
  assertEqual(decideAutoAction(bad).action, "none", `invalid count ${String(bad)} → none`);
}
assertEqual(decideAutoAction(1).action, "warn", "1 strike → warn");
assertEqual(decideAutoAction(2).action, "warn", "2 strikes → warn");
assertEqual(decideAutoAction(3).action, "mute", "3 strikes → mute");
assertEqual(decideAutoAction(3).hours, 24, "3 strikes → 24h");
assertEqual(decideAutoAction(4).hours, 24, "4 strikes → 24h");
assertEqual(!!decideAutoAction(4).escalate, false, "4 strikes → no ban review");
assertEqual(decideAutoAction(5).hours, 168, "5 strikes → 7 days");
assertEqual(decideAutoAction(5).escalate, true, "5 strikes → ban review");
assertEqual(decideAutoAction(6).hours, 168, "6 strikes → 7 days");
assertEqual(decideAutoAction("3").action, "mute", "numeric string from pg COUNT is accepted");

// ─── Helpers ──────────────────────────────────────────────────────────────────
section("computeMutedUntil / mutedPayload");
const now = new Date("2026-01-01T00:00:00Z");
assertEqual(computeMutedUntil(24, now).toISOString(), "2026-01-02T00:00:00.000Z", "24h after now");
const payload = mutedPayload({ muted_until: "2026-01-02T00:00:00Z" });
assertEqual(payload.code, MUTED_CODE, "payload code");
assertEqual(payload.muted_until, "2026-01-02T00:00:00.000Z", "payload muted_until is ISO");

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("═".repeat(60));
process.exit(failed > 0 ? 1 : 0);
