/**
 * account_ban.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the ban rules (utils/banRules.js) and the admin ban/reactivate
 * request schemas (validations/adminSchemas.js).
 *
 * Run:  cd development_backend && node tests/account_ban.test.js
 *
 * Hermetic: never touches the database.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  bannedSql,
  notBannedSql,
  isBanActive,
  computeBannedUntil,
  suspensionPayload,
  MAX_BAN_DAYS,
  SUSPENDED_CODE,
} from "../utils/banRules.js";
import { banUserSchema, reactivateUserSchema } from "../validations/adminSchemas.js";

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

function assertThrows(fn, label) {
  try {
    fn();
    assert(false, label);
  } catch {
    assert(true, label);
  }
}

function section(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`📦 ${title}`);
  console.log("─".repeat(60));
}

const NOW = new Date("2026-10-08T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

// ─── isBanActive ──────────────────────────────────────────────────────────────
section("isBanActive — the single 'banned' rule");
assertEqual(isBanActive({ status: "Deactivate", banned_until: null }, NOW), true, "Deactivate + no end date = permanent ban");
assertEqual(isBanActive({ status: "Deactivate", banned_until: new Date(NOW.getTime() + DAY) }, NOW), true, "end date in the future = banned");
assertEqual(isBanActive({ status: "Deactivate", banned_until: new Date(NOW.getTime() - 1000) }, NOW), false, "end date passed = not banned (before sweep)");
assertEqual(isBanActive({ status: "Approve", banned_until: null }, NOW), false, "Approve = not banned");
assertEqual(isBanActive({ status: "On Hold", banned_until: null }, NOW), false, "On Hold is not a ban");
assertEqual(isBanActive(null, NOW), false, "missing user = not banned");

// ─── computeBannedUntil ───────────────────────────────────────────────────────
section("computeBannedUntil");
assertEqual(computeBannedUntil({ permanent: true }, NOW), null, "permanent → null");
assertEqual(computeBannedUntil({ durationDays: 7 }, NOW).toISOString(), "2026-10-15T12:00:00.000Z", "7 days from now");
assertEqual(computeBannedUntil({ durationDays: MAX_BAN_DAYS }, NOW).getTime(), NOW.getTime() + MAX_BAN_DAYS * DAY, "max days accepted");
assertThrows(() => computeBannedUntil({ durationDays: 0 }, NOW), "0 days rejected");
assertThrows(() => computeBannedUntil({ durationDays: 1.5 }, NOW), "fractional days rejected");
assertThrows(() => computeBannedUntil({ durationDays: MAX_BAN_DAYS + 1 }, NOW), "over max rejected");
assertThrows(() => computeBannedUntil({}, NOW), "no duration and not permanent rejected");

// ─── SQL fragments ────────────────────────────────────────────────────────────
section("SQL fragments");
assertEqual(
  bannedSql("u"),
  "(u.status = 'Deactivate' AND (u.banned_until IS NULL OR u.banned_until > NOW()))",
  "bannedSql matches the documented rule",
);
assert(notBannedSql("pr.user_id").startsWith("NOT EXISTS") && notBannedSql("pr.user_id").includes("bu.id = pr.user_id"), "notBannedSql correlates on the given column");

// ─── suspensionPayload ────────────────────────────────────────────────────────
section("suspensionPayload");
let p = suspensionPayload({ reason: "Abusive messages", banned_until: "2026-10-15T12:00:00Z" });
assertEqual(p.code, SUSPENDED_CODE, "code is ACCOUNT_SUSPENDED");
assertEqual(p.is_permanent, false, "timed ban is not permanent");
assertEqual(p.banned_until, "2026-10-15T12:00:00.000Z", "end date serialised as ISO");
assert(typeof p.error === "string" && p.error.length > 0, "human-readable error for fallback UIs");
p = suspensionPayload({ reason: null, banned_until: null });
assertEqual(p.is_permanent, true, "no end date = permanent");
assertEqual(p.banned_until, null, "permanent has null end date");

// ─── banUserSchema ────────────────────────────────────────────────────────────
section("banUserSchema");
const ok = (data) => banUserSchema.safeParse(data).success;
assertEqual(ok({ user_id: "5", reason: "Abuse", duration_days: 7 }), true, "timed ban accepted (id coerced)");
assertEqual(ok({ user_id: 5, reason: "Abuse", permanent: true }), true, "permanent ban accepted");
assertEqual(ok({ user_id: 5, reason: "Abuse", permanent: true, flag_id: 3 }), true, "flag_id accepted");
assertEqual(ok({ user_id: 5, reason: "Abuse", permanent: true, duration_days: 7 }), false, "both duration and permanent rejected");
assertEqual(ok({ user_id: 5, reason: "Abuse" }), false, "neither duration nor permanent rejected");
assertEqual(ok({ user_id: 5, reason: "   ", duration_days: 7 }), false, "blank reason rejected");
assertEqual(ok({ user_id: 5, reason: "Abuse", duration_days: 0 }), false, "0 days rejected");
assertEqual(ok({ user_id: 5, reason: "Abuse", duration_days: MAX_BAN_DAYS + 1 }), false, "over max days rejected");
assertEqual(banUserSchema.parse({ user_id: 5, reason: "  Abuse  ", duration_days: 7 }).reason, "Abuse", "reason is trimmed");

// ─── reactivateUserSchema ─────────────────────────────────────────────────────
section("reactivateUserSchema");
assertEqual(reactivateUserSchema.safeParse({ user_id: "9" }).success, true, "note is optional");
assertEqual(reactivateUserSchema.safeParse({}).success, false, "user_id required");

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("═".repeat(60));
process.exit(failed > 0 ? 1 : 0);
