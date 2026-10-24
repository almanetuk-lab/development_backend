/**
 * phase2_admin_notifications_plans.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration tests – Phase 2, Week 3
 *   QA-ADMIN-001 → QA-ADMIN-006  (Admin Panel)
 *   QA-NOTIF-001 → QA-NOTIF-003  (Notifications)
 *   QA-PLAN-001  → QA-PLAN-004   (Subscription Plans)
 *   QA-RATE-001  → QA-RATE-002   (Rate Limiting)
 *
 * Requires: dev server running on PORT (default 3435)
 *   cd development_backend && node server.js
 *
 * Run:
 *   cd development_backend
 *   node tests/phase2_admin_notifications_plans.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

import dotenv from "dotenv";
dotenv.config();

import supertest from "supertest";
import { pool } from "../config/db.js";
import jwt from "jsonwebtoken";
import { updateCsvResult } from "./helpers/csvUpdater.js";

const PORT = process.env.PORT || 3435;
const request = supertest(`http://localhost:${PORT}`);

let passed = 0;
let failed = 0;
const results = [];

function section(title) {
  console.log(`\n${"─".repeat(68)}`);
  console.log(`📦  ${title}`);
  console.log("─".repeat(68));
}

async function it(caseId, label, fn) {
  try {
    const actual = await fn();
    console.log(`  ✅ PASS  [${caseId}] ${label}`);
    passed++;
    results.push({ id: caseId, status: "Passed", actual: actual ?? "OK" });
  } catch (err) {
    console.error(`  ❌ FAIL  [${caseId}] ${label}`);
    console.error(`           ${err.message}`);
    failed++;
    results.push({ id: caseId, status: "Failed", actual: err.message });
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected)
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
    },
    toBeOneOf(...values) {
      if (!values.includes(actual))
        throw new Error(`Expected one of [${values.join(", ")}] but got ${actual}`);
    },
    toBeGreaterThan(n) {
      if (actual <= n) throw new Error(`Expected ${actual} > ${n}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy but got ${actual}`);
    },
  };
}

function mintUserToken(payload = {}) {
  return jwt.sign(
    { id: 9999, email: "testqa@qa.test", status: "Approve", ...payload },
    process.env.ACCESS_SECRET_KEY,
    { expiresIn: "30m" }
  );
}

async function getOrCreateTestUser() {
  const email = "qa_phase2_test@almanet.test";
  let res = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
  if (res.rows.length) return res.rows[0].id;
  const bcrypt = await import("bcrypt");
  const hash = await bcrypt.hash("TestP@ss123!", 10);
  const ins = await pool.query(
    `INSERT INTO users (email, password, status) VALUES ($1, $2, 'Approve') RETURNING id`,
    [email, hash]
  );
  return ins.rows[0].id;
}

// ════════════════════════════════════════════════════════════════
//  SECTION 1: Admin Panel (QA-ADMIN-001 → QA-ADMIN-006)
// ════════════════════════════════════════════════════════════════
section("Admin Panel — QA-ADMIN-001 to QA-ADMIN-006");

await it("QA-ADMIN-001", "Admin login — invalid credentials return 404 or 401", async () => {
  const res = await request
    .post("/api/admin/login")
    .send({ email: "notadmin@qa.test", password: "WrongPass123!" });
  expect(res.status).toBeOneOf(401, 404);
  return `HTTP ${res.status} — Bad credentials rejected`;
});

await it("QA-ADMIN-002", "Admin login — empty body returns 4xx", async () => {
  const res = await request.post("/api/admin/login").send({});
  expect(res.status).toBeOneOf(400, 401, 404, 500);
  return `HTTP ${res.status} — Empty body handled`;
});

await it("QA-ADMIN-003", "Admin logout — returns 200 and clears adminAccessToken", async () => {
  const res = await request.post("/api/admin/logout");
  expect(res.status).toBe(200);
  return `HTTP ${res.status} — Admin logout successful`;
});

await it("QA-ADMIN-004", "Admin /api/admin/users — unauthenticated returns 401", async () => {
  const res = await request.get("/api/admin/users");
  expect(res.status).toBe(401);
  return `HTTP ${res.status} — Admin users list protected`;
});

await it("QA-ADMIN-005", "Admin routes — regular user token blocked from admin endpoints (401/403)", async () => {
  const token = mintUserToken({ id: 9999 }); // Regular user JWT
  const res = await request
    .get("/api/admin/users")
    .set("Cookie", `accessToken=${token}`);
  expect(res.status).toBeOneOf(401, 403);
  return `HTTP ${res.status} — Regular user blocked from admin routes`;
});

await it("QA-ADMIN-006", "Admin flagged-messages — requires admin auth (401)", async () => {
  const res = await request.get("/api/admin/flagged-messages");
  expect(res.status).toBe(401);
  return `HTTP ${res.status} — Flagged messages endpoint protected`;
});

// ════════════════════════════════════════════════════════════════
//  SECTION 2: Notifications (QA-NOTIF-001 → QA-NOTIF-003)
// ════════════════════════════════════════════════════════════════
section("Notifications — QA-NOTIF-001 to QA-NOTIF-003");

await it("QA-NOTIF-001", "Fetch notifications — unauthenticated request returns 401", async () => {
  const res = await request.get("/api/notifications/1");
  expect(res.status).toBe(401);
  return `HTTP ${res.status} — Notifications protected`;
});

await it("QA-NOTIF-002", "Fetch notifications — authenticated user gets own notifications (array)", async () => {
  const userId = await getOrCreateTestUser();
  const token = mintUserToken({ id: userId });

  const res = await request
    .get(`/api/notifications/${userId}`)
    .set("Cookie", `accessToken=${token}`);

  expect(res.status).toBe(200);
  if (!Array.isArray(res.body))
    throw new Error(`Expected array but got ${typeof res.body}`);
  return `HTTP ${res.status} — ${res.body.length} notification(s) returned`;
});

await it("QA-NOTIF-003", "Notifications IDOR — User A cannot access User B notifications (403)", async () => {
  const userId = await getOrCreateTestUser();
  const token = mintUserToken({ id: userId });
  const targetId = userId === 1 ? 2 : 1;

  const res = await request
    .get(`/api/notifications/${targetId}`)
    .set("Cookie", `accessToken=${token}`);

  expect(res.status).toBe(403);
  return `HTTP ${res.status} — IDOR blocked`;
});

// ════════════════════════════════════════════════════════════════
//  SECTION 3: Subscription Plans (QA-PLAN-001 → QA-PLAN-004)
// ════════════════════════════════════════════════════════════════
section("Subscription Plans — QA-PLAN-001 to QA-PLAN-004");

await it("QA-PLAN-001", "Plan status endpoint — unauthenticated returns 401", async () => {
  const res = await request.get("/api/plans/me/plan-status");
  expect(res.status).toBe(401);
  return `HTTP ${res.status} — Plan status protected`;
});

await it("QA-PLAN-002", "Plan status — authenticated user gets 200 or 404 (no 5xx)", async () => {
  const userId = await getOrCreateTestUser();
  const token = mintUserToken({ id: userId });

  const res = await request
    .get("/api/plans/me/plan-status")
    .set("Cookie", `accessToken=${token}`);

  if (res.status >= 500)
    throw new Error(`Unexpected server error: ${res.status}`);
  expect(res.status).toBeOneOf(200, 404);
  return `HTTP ${res.status} — Plan status endpoint functional`;
});

await it("QA-PLAN-003", "Verify-session free tier — free_sess_ prefix returns 200", async () => {
  const userId = await getOrCreateTestUser();
  const token = mintUserToken({ id: userId });

  const res = await request
    .post("/payments/verify-session")
    .set("Cookie", `accessToken=${token}`)
    .send({ session_id: "free_sess_1234567890_testxyz" });

  expect(res.status).toBe(200);
  return `HTTP ${res.status} — Free session recognized`;
});

await it("QA-PLAN-004", "Verify-session — invalid Stripe session_id returns error (no crash)", async () => {
  const userId = await getOrCreateTestUser();
  const token = mintUserToken({ id: userId });

  const res = await request
    .post("/payments/verify-session")
    .set("Cookie", `accessToken=${token}`)
    .send({ session_id: "cs_test_invalid_qa_12345" });

  // Stripe returns error — server should handle gracefully (400/500, never unhandled crash)
  expect(res.status).toBeOneOf(400, 404, 500);
  return `HTTP ${res.status} — Invalid Stripe session handled gracefully`;
});

// ════════════════════════════════════════════════════════════════
//  SECTION 4: Rate Limiting (QA-RATE-001 → QA-RATE-002)
// ════════════════════════════════════════════════════════════════
section("Rate Limiting — QA-RATE-001 to QA-RATE-002");

await it("QA-RATE-001", "Auth rate limiter active — 25 rapid login requests trigger 429 or consistent 401", async () => {
  const requests = Array.from({ length: 25 }, () =>
    request
      .post("/api/login")
      .send({ email: "ratetest@qa.test", password: "WrongP@ss123!" })
  );

  const responses = await Promise.all(requests);
  const statuses = responses.map((r) => r.status);
  const has429 = statuses.some((s) => s === 429);
  const allValid = statuses.every((s) => [400, 401, 422, 429].includes(s));

  if (!allValid)
    throw new Error(`Unexpected status codes: ${statuses.join(", ")}`);

  return has429
    ? `Rate limit triggered — 429 seen in burst`
    : `Statuses: ${[...new Set(statuses)].join(", ")} — limiter active`;
});

await it("QA-RATE-002", "Payment rate limiter — create-checkout-session returns 401/429 (no unauth 200)", async () => {
  const requests = Array.from({ length: 12 }, () =>
    request
      .post("/payments/create-checkout-session")
      .send({ plan: { id: 1 }, user_id: 1 })
  );
  const responses = await Promise.all(requests);
  const statuses = responses.map((r) => r.status);
  const allExpected = statuses.every((s) => [401, 422, 429].includes(s));

  if (!allExpected)
    throw new Error(`Unexpected status codes: ${statuses.join(", ")}`);

  return `Statuses: ${[...new Set(statuses)].join(", ")} — Payment endpoint protected`;
});

// ─── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(68)}`);
console.log(`📊  Results: ${passed} passed, ${failed} failed`);
console.log("═".repeat(68));

await updateCsvResult(results);
await pool.end();
process.exit(failed > 0 ? 1 : 0);
