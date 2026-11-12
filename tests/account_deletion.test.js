/**
 * account_deletion.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for soft account deletion: the "unavailable" SQL rules
 * (utils/banRules.js), the request schemas (validations/accountDeletionSchemas.js)
 * and the pure helpers/responses in services/accountDeletionService.js.
 *
 * Run:  cd development_backend && node tests/account_deletion.test.js
 *
 * Hermetic: never touches the database (the pool is created but never queried).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  deletedSql,
  unavailableSql,
  notUnavailableSql,
  bannedSql,
  ACCOUNT_DELETED_CODE,
  ACCOUNT_DELETED_RESTORABLE_CODE,
} from "../utils/banRules.js";
import {
  deleteAccountSchema,
  recoveryCodeSchema,
  recoveryActionSchema,
  eraseAccountSchema,
  adminUserIdParamsSchema,
} from "../validations/accountDeletionSchemas.js";
import {
  maskEmail,
  hashEmail,
  restorableResponse,
  deletedResponse,
} from "../services/accountDeletionService.js";

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

/** Captures what a handler writes to an Express response. */
function mockRes() {
  const res = { statusCode: null, body: null, cookies: [] };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.cookie = (name, value, opts) => { res.cookies.push({ name, value, opts }); return res; };
  return res;
}

// ─── SQL fragments ────────────────────────────────────────────────────────────
section("SQL fragments — deleted and unavailable");
assertEqual(deletedSql("u"), "(u.deleted_at IS NOT NULL)", "deletedSql checks deleted_at");
assert(unavailableSql("u").includes(bannedSql("u")), "unavailableSql includes the ban rule");
assert(unavailableSql("u").includes(deletedSql("u")), "unavailableSql includes the deleted rule");
assert(notUnavailableSql("p.user_id").startsWith("NOT EXISTS"), "notUnavailableSql is a NOT EXISTS filter");
assert(notUnavailableSql("p.user_id").includes("bu.id = p.user_id"), "notUnavailableSql binds the id expression");
assert(notUnavailableSql("p.user_id").includes("bu.deleted_at IS NOT NULL"), "notUnavailableSql excludes deleted users");

// ─── deleteAccountSchema ──────────────────────────────────────────────────────
section("deleteAccountSchema — password XOR code");
const del = (d) => deleteAccountSchema.safeParse(d).success;
assertEqual(del({ password: "Secret1!" }), true, "password alone accepted");
assertEqual(del({ code: "123456" }), true, "6-digit code alone accepted");
assertEqual(del({}), false, "neither rejected");
assertEqual(del({ password: "x", code: "123456" }), false, "both rejected");
assertEqual(del({ code: "12345" }), false, "5-digit code rejected");
assertEqual(del({ code: "abcdef" }), false, "non-numeric code rejected");

// ─── recovery schemas ─────────────────────────────────────────────────────────
section("recovery schemas");
const rc = recoveryCodeSchema.safeParse({ email: "  Someone@Example.COM ", purpose: "restore" });
assertEqual(rc.success, true, "restore code request accepted");
assertEqual(rc.data?.email, "someone@example.com", "email trimmed and lowercased");
assertEqual(recoveryCodeSchema.safeParse({ email: "a@b.com", purpose: "start_fresh" }).success, true, "start_fresh accepted");
assertEqual(recoveryCodeSchema.safeParse({ email: "a@b.com", purpose: "delete" }).success, false, "delete purpose not allowed publicly");
assertEqual(recoveryCodeSchema.safeParse({ email: "not-an-email", purpose: "restore" }).success, false, "bad email rejected");
assertEqual(recoveryActionSchema.safeParse({ email: "a@b.com", code: " 012345 " }).success, true, "code with spaces trimmed");
assertEqual(recoveryActionSchema.safeParse({ email: "a@b.com" }).success, false, "missing code rejected");

// ─── admin schemas ────────────────────────────────────────────────────────────
section("admin schemas");
assertEqual(adminUserIdParamsSchema.safeParse({ id: "42" }).data?.id, 42, "id param coerced to number");
assertEqual(adminUserIdParamsSchema.safeParse({ id: "-1" }).success, false, "negative id rejected");
assertEqual(eraseAccountSchema.safeParse({ confirm_user_id: "42" }).data?.confirm_user_id, 42, "confirm id coerced");
assertEqual(eraseAccountSchema.safeParse({}).success, false, "confirm id required");
assertEqual(eraseAccountSchema.safeParse({ confirm_user_id: 1, reason: "x".repeat(501) }).success, false, "reason over 500 chars rejected");

// ─── helpers ──────────────────────────────────────────────────────────────────
section("maskEmail / hashEmail");
assertEqual(maskEmail("ravinder@gmail.com"), "ra******@gmail.com", "keeps first 2 chars and domain");
assertEqual(maskEmail("ab@x.io"), "ab***@x.io", "short names still masked");
assertEqual(maskEmail("broken"), "***", "malformed email fully masked");

const savedSecret = process.env.EMAIL_HASH_SECRET;
process.env.EMAIL_HASH_SECRET = "test-secret";
assertEqual(hashEmail("A@B.com"), hashEmail(" a@b.com "), "hash ignores case and spaces");
assert(hashEmail("a@b.com") !== hashEmail("c@b.com"), "different emails → different hashes");
assert(!hashEmail("a@b.com").includes("a@b.com"), "hash doesn't contain the email");
delete process.env.EMAIL_HASH_SECRET;
assertEqual(hashEmail("a@b.com"), null, "no secret → null (never an unkeyed hash)");
if (savedSecret !== undefined) process.env.EMAIL_HASH_SECRET = savedSecret;

// ─── responses ────────────────────────────────────────────────────────────────
section("restorableResponse / deletedResponse");
const r1 = restorableResponse(mockRes(), { email: "someone@example.com", deleted_was_banned: false });
assertEqual(r1.statusCode, 409, "restorable → 409");
assertEqual(r1.body.code, ACCOUNT_DELETED_RESTORABLE_CODE, "restorable code");
assertEqual(r1.body.can_start_fresh, true, "not banned → can start fresh");
assertEqual(r1.body.email_masked, "so*****@example.com", "email masked in response");
assert(!JSON.stringify(r1.body).includes("someone@"), "full email never sent");
assertEqual(r1.cookies.length, 2, "both auth cookies cleared");

const r1b = restorableResponse(mockRes(), { email: "someone@example.com", deleted_was_banned: false }, { revealEmail: true });
assertEqual(r1b.body.email, "someone@example.com", "revealEmail includes the full email (caller already authenticated)");

const r2 = restorableResponse(mockRes(), { email: "x@y.com", deleted_was_banned: true });
assertEqual(r2.body.can_start_fresh, false, "banned at deletion → restore only");

const r3 = deletedResponse(mockRes());
assertEqual(r3.statusCode, 403, "deleted session → 403");
assertEqual(r3.body.code, ACCOUNT_DELETED_CODE, "deleted code");
assert(r3.cookies.every((c) => c.opts.maxAge === 0), "cookies expired");

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log("═".repeat(60));
process.exit(failed > 0 ? 1 : 0);
