/**
 * test_trust_fixes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the two trust point vulnerability fixes:
 *   Fix 1: Mutual Engagement — no instant reward for one-way outreach
 *   Fix 2: Daily Cap — max +15 positive trust points per 24 hours
 *
 * Usage:  node test_trust_fixes.js
 *
 * This script creates temporary test users, runs 5 scenarios, and cleans up.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { pool } from './config/db.js';
import {
  adjustTrustScore,
  trackMessageActivity,
} from './services/trustService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_PREFIX = '__trust_test_';
let testUserIds = [];

const createTestUser = async (label) => {
  const email = `${TEST_PREFIX}${label}_${Date.now()}@test.local`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, password, trust_score) VALUES ($1, 'test', 70) RETURNING id`,
    [email]
  );
  testUserIds.push(rows[0].id);
  return rows[0].id;
};

const getScore = async (userId) => {
  const { rows } = await pool.query('SELECT trust_score FROM users WHERE id = $1', [userId]);
  return rows[0]?.trust_score;
};

const insertMessage = async (senderId, receiverId, content = 'test msg') => {
  await pool.query(
    `INSERT INTO messages (sender_id, receiver_id, content, is_read) VALUES ($1, $2, $3, FALSE)`,
    [senderId, receiverId, content]
  );
};

const getHistory = async (userId) => {
  const { rows } = await pool.query(
    `SELECT points_change, reason FROM trust_history WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId]
  );
  return rows;
};

const cleanup = async () => {
  if (testUserIds.length === 0) return;
  const ids = testUserIds;
  await pool.query(`DELETE FROM trust_history WHERE user_id = ANY($1)`, [ids]);
  await pool.query(`DELETE FROM messages WHERE sender_id = ANY($1) OR receiver_id = ANY($1)`, [ids]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
  console.log(`\n🧹 Cleaned up ${ids.length} test users\n`);
};

// ─── Test Runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

const assert = (condition, testName) => {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    failed++;
  }
};

// ─── Test Scenarios ──────────────────────────────────────────────────────────

async function testMutualEngagement_FirstMessageNoReward() {
  console.log('\n📧 Test 1: First message → no reward (Mutual Engagement fix)');
  const userA = await createTestUser('A1');
  const userB = await createTestUser('B1');

  const scoreBefore = await getScore(userA);

  // User A sends FIRST message to User B
  await insertMessage(userA, userB, 'Hey!');
  await trackMessageActivity(userA, userB);

  const scoreAfter = await getScore(userA);
  const history = await getHistory(userA);

  assert(scoreAfter === scoreBefore, `Score unchanged: ${scoreBefore} → ${scoreAfter} (expected no change)`);
  assert(history.length === 0, `No trust_history entries (got ${history.length})`);
}

async function testMutualEngagement_ReplyTriggersReward() {
  console.log('\n🤝 Test 2: Reply triggers mutual rewards (Mutual Engagement fix)');
  const userA = await createTestUser('A2');
  const userB = await createTestUser('B2');

  // User A sends first message to User B → no reward
  await insertMessage(userA, userB, 'Hello!');
  await trackMessageActivity(userA, userB);

  const scoreA_after_send = await getScore(userA);
  assert(scoreA_after_send === 70, `User A still at 70 after sending (got ${scoreA_after_send})`);

  // User B replies to User A → BOTH should be rewarded
  await insertMessage(userB, userA, 'Hi back!');
  await trackMessageActivity(userB, userA);

  const scoreB = await getScore(userB);
  const scoreA = await getScore(userA);
  const historyA = await getHistory(userA);
  const historyB = await getHistory(userB);

  assert(scoreB === 75, `User B (replier) gets +5 "Reply Received": 70 → ${scoreB}`);
  assert(scoreA === 75, `User A (initiator) gets +5 "Conversation Established": 70 → ${scoreA}`);
  assert(historyB.some(h => h.reason === 'Reply Received'), `User B history has "Reply Received"`);
  assert(historyA.some(h => h.reason === 'Conversation Established'), `User A history has "Conversation Established"`);
}

async function testMutualEngagement_SubsequentReplies() {
  console.log('\n💬 Test 3: Subsequent replies still earn +5 each');
  const userA = await createTestUser('A3');
  const userB = await createTestUser('B3');

  // Establish two-way conversation
  await insertMessage(userA, userB, 'Hello');
  await trackMessageActivity(userA, userB);
  await insertMessage(userB, userA, 'Hi');
  await trackMessageActivity(userB, userA);

  // Now A replies again
  await insertMessage(userA, userB, 'How are you?');
  await trackMessageActivity(userA, userB);

  const scoreA = await getScore(userA);
  const historyA = await getHistory(userA);

  // A should have: 70 + 5 (Conversation Established) + 5 (Reply Received) = 80
  assert(scoreA === 80, `User A at 80 after Established + Reply: got ${scoreA}`);
  assert(historyA.some(h => h.reason === 'Reply Received'), `User A earned "Reply Received" on 2nd message`);

  // "Conversation Established" should NOT trigger again for User B
  const historyB = await getHistory(userB);
  const establishedCount = historyB.filter(h => h.reason === 'Conversation Established').length;
  assert(establishedCount === 0, `User B did NOT get duplicate "Conversation Established" (got ${establishedCount})`);
}

async function testDailyCap() {
  console.log('\n🔒 Test 4: Daily cap blocks points after +15');
  const userA = await createTestUser('A4');

  // Manually award +15 (simulating a full day of activity)
  await adjustTrustScore(userA, 5, 'Test reward 1');
  await adjustTrustScore(userA, 5, 'Test reward 2');
  await adjustTrustScore(userA, 5, 'Test reward 3');

  const scoreAtCap = await getScore(userA);
  assert(scoreAtCap === 85, `Score at 85 after 3x +5: got ${scoreAtCap}`);

  // Try to award +5 more → should be blocked by daily cap
  const result = await adjustTrustScore(userA, 5, 'Test reward 4 (should be blocked)');
  const scoreAfterCap = await getScore(userA);

  assert(result === null, `adjustTrustScore returned null (cap hit): got ${JSON.stringify(result)}`);
  assert(scoreAfterCap === 85, `Score still 85 after cap block: got ${scoreAfterCap}`);
}

async function testDailyCap_PenaltyNotBlocked() {
  console.log('\n⚡ Test 5: Ghosting penalty (−20) is NEVER blocked by daily cap');
  const userA = await createTestUser('A5');

  // Fill up the daily cap
  await adjustTrustScore(userA, 5, 'Fill 1');
  await adjustTrustScore(userA, 5, 'Fill 2');
  await adjustTrustScore(userA, 5, 'Fill 3');

  // Apply ghosting penalty → should ALWAYS work regardless of cap
  const result = await adjustTrustScore(userA, -20, 'Ghosting: test');
  const score = await getScore(userA);

  assert(result !== null, `Penalty was applied (not blocked): got ${JSON.stringify(result)}`);
  assert(score === 65, `Score = 85 - 20 = 65: got ${score}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Trust Points Vulnerability Fixes — Test Suite');
  console.log('═══════════════════════════════════════════════════════');

  try {
    await testMutualEngagement_FirstMessageNoReward();
    await testMutualEngagement_ReplyTriggersReward();
    await testMutualEngagement_SubsequentReplies();
    await testDailyCap();
    await testDailyCap_PenaltyNotBlocked();

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════════');
  } catch (err) {
    console.error('\n💥 Test error:', err.message);
    console.error(err.stack);
  } finally {
    await cleanup();
    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
