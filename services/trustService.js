/**
 * trustService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Module 8 — Anti-Ghosting Staking Integration
 *
 * Provides the Trust Point System for the Intentional Connection platform:
 *  - adjustTrustScore()        → Generic score mutation with history logging.
 *  - awardHandshakePoints()    → +HANDSHAKE_REWARD_POINTS for both partners.
 *  - trackMessageActivity()    → +MESSAGE_REWARD_POINTS / +REPLY_REWARD_POINTS.
 *  - detectActiveGhostingAlert() → Returns pending ghosting alert for a user.
 *  - computeTrustStatus()      → Derives Trust Level, Engagement Status & Ghosting Risk.
 *  - applyGhostingPenalty()    → Auto-applies penalty + Gemini twin insight on ghosting detection.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { pool } from "../config/db.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();


// ─── Config from environment (all values are configurable via .env) ──────────
const GHOSTING_TIMEOUT_MS =
  (parseFloat(process.env.GHOSTING_TIMEOUT_HOURS) || 48) * 60 * 60 * 1000;

const POINTS = {
  HANDSHAKE:    parseInt(process.env.HANDSHAKE_REWARD_POINTS)  || 10,
  MESSAGE:      parseInt(process.env.MESSAGE_REWARD_POINTS)    || 5,
  REPLY:        parseInt(process.env.REPLY_REWARD_POINTS)      || 5,
  GHOSTING:     -(parseInt(process.env.GHOSTING_PENALTY_POINTS) || 20),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns trust level label based on numeric score.
 */
const trustLevelFromScore = (score) => {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Average";
  return "Low";
};

// ─── Core Mutation ───────────────────────────────────────────────────────────

/**
 * Adjusts a user's trust_score by `pointsChange` (clamped 0–100) and
 * records the event in trust_history.
 *
 * @param {number} userId
 * @param {number} pointsChange - Positive (reward) or negative (penalty).
 * @param {string} reason       - Human-readable reason for the change.
 * @param {number|null} handshakeId - Optional handshake session ID.
 * @returns {object} { newScore, pointsChange, reason }
 */
export const adjustTrustScore = async (userId, pointsChange, reason, handshakeId = null) => {
  try {
    // Fetch current score (fallback 100 if column not set yet)
    const { rows } = await pool.query(
      "SELECT trust_score FROM users WHERE id = $1",
      [userId]
    );
    if (rows.length === 0) return null;

    const currentScore = rows[0].trust_score ?? 100;
    const newScore = Math.min(100, Math.max(0, currentScore + pointsChange));

    // Persist updated score
    await pool.query(
      "UPDATE users SET trust_score = $1 WHERE id = $2",
      [newScore, userId]
    );

    // Log to trust_history
    await pool.query(
      `INSERT INTO trust_history (user_id, handshake_id, points_change, new_trust_score, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, handshakeId, pointsChange, newScore, reason]
    );

    console.log(`[Trust] User ${userId}: ${pointsChange >= 0 ? "+" : ""}${pointsChange} → ${newScore} (${reason})`);
    return { newScore, pointsChange, reason };
  } catch (err) {
    // Non-blocking: never crash callers due to trust system errors
    console.warn(`[Trust] adjustTrustScore failed for user ${userId}:`, err.message);
    return null;
  }
};

// ─── Handshake Reward ────────────────────────────────────────────────────────

/**
 * Awards trust points to both users upon successful handshake.
 * Called from handshakeService.js after session is persisted.
 */
export const awardHandshakePoints = async (userAId, userBId, handshakeId = null) => {
  await Promise.all([
    adjustTrustScore(userAId, POINTS.HANDSHAKE, "Successful Handshake", handshakeId),
    adjustTrustScore(userBId, POINTS.HANDSHAKE, "Successful Handshake", handshakeId),
  ]);
};

// ─── Message Activity Rewards ────────────────────────────────────────────────

/**
 * Analyses the message history between sender and receiver to determine
 * whether this message is the very first in the conversation or a reply,
 * and awards the appropriate trust points.
 *
 * "Conversation Started" (+MESSAGE_REWARD_POINTS): the sender has never sent
 *   a message to this receiver before.
 * "Reply Received"       (+REPLY_REWARD_POINTS):  the receiver previously sent
 *   the last message in this thread and the sender is now replying.
 */
export const trackMessageActivity = async (senderId, receiverId) => {
  try {
    // Count all messages from sender → receiver
    const { rows: totalRows } = await pool.query(
      `SELECT COUNT(*) AS count FROM messages
       WHERE sender_id = $1 AND receiver_id = $2`,
      [senderId, receiverId]
    );
    const totalFromSender = parseInt(totalRows[0].count, 10);

    if (totalFromSender === 1) {
      // Very first message from this sender to this receiver
      await adjustTrustScore(senderId, POINTS.MESSAGE, "Conversation Started");
      return;
    }

    // Check if the most recent message in the thread was from the receiver
    const { rows: lastMsgRows } = await pool.query(
      `SELECT sender_id FROM messages
       WHERE (sender_id = $1 AND receiver_id = $2)
          OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY created_at DESC
       LIMIT 2`,
      [senderId, receiverId]
    );

    // The second row in this set is the message *before* the one just inserted
    if (lastMsgRows.length >= 2) {
      const prevSenderId = lastMsgRows[1].sender_id;
      if (String(prevSenderId) === String(receiverId)) {
        // Sender is replying to the receiver's previous message
        await adjustTrustScore(senderId, POINTS.REPLY, "Reply Received");
      }
    }
  } catch (err) {
    console.warn("[Trust] trackMessageActivity failed:", err.message);
  }
};

// ─── Ghosting Detection ──────────────────────────────────────────────────────

/**
 * Checks whether the logged-in user has an active ghosting situation:
 * their conversation partner's last message is older than the inactivity
 * threshold and the user has not yet replied.
 *
 * Returns the first flagged alert or null if the user is clear.
 *
 * @param {number} userId
 * @returns {{ sessionId, partnerId, partnerName, lastMessageAt }|null}
 */
export const detectActiveGhostingAlert = async (userId) => {
  try {
    const cutoff = new Date(Date.now() - GHOSTING_TIMEOUT_MS).toISOString();

    // Find conversations where someone sent the user a message
    // but the user hasn't replied and the message is older than the timeout.
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (m.sender_id)
         m.sender_id      AS partner_id,
         m.created_at     AS last_message_at,
         p.first_name,
         p.last_name,
         hs.id            AS session_id
       FROM messages m
       LEFT JOIN profiles p ON p.user_id = m.sender_id
       LEFT JOIN handshake_sessions hs
              ON (hs.user_a_id = m.sender_id AND hs.user_b_id = $1)
              OR (hs.user_b_id = m.sender_id AND hs.user_a_id = $1)
       WHERE m.receiver_id = $1
         AND m.created_at < $2
         AND NOT EXISTS (
           -- User has replied after this message
           SELECT 1 FROM messages reply
           WHERE reply.sender_id = $1
             AND reply.receiver_id = m.sender_id
             AND reply.created_at > m.created_at
         )
       ORDER BY m.sender_id, m.created_at DESC
       LIMIT 1`,
      [userId, cutoff]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      sessionId: row.session_id || null,
      partnerId: row.partner_id,
      partnerName: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Your Match",
      lastMessageAt: row.last_message_at,
    };
  } catch (err) {
    console.warn("[Trust] detectActiveGhostingAlert failed:", err.message);
    return null;
  }
};

// ─── Trust Status Computation ────────────────────────────────────────────────

/**
 * Returns a fully-computed TrustStatus object for a given user ID,
 * enriched with history statistics and activity signals.
 *
 * @param {number} userId
 * @returns {object} TrustStatus
 */
export const computeTrustStatus = async (userId) => {
  try {
    // Fetch base score
    const { rows: userRows } = await pool.query(
      "SELECT trust_score FROM users WHERE id = $1",
      [userId]
    );
    const trustScore = userRows[0]?.trust_score ?? 100;

    // Compute history stats
    const { rows: histRows } = await pool.query(
      `SELECT
         SUM(CASE WHEN points_change > 0 THEN 1 ELSE 0 END) AS positive_events,
         SUM(CASE WHEN points_change < 0 THEN 1 ELSE 0 END) AS ghosting_events,
         MAX(created_at) AS last_activity
       FROM trust_history
       WHERE user_id = $1`,
      [userId]
    );

    const stats = histRows[0] || {};
    const positiveEvents = parseInt(stats.positive_events, 10) || 0;
    const ghostingEvents = parseInt(stats.ghosting_events, 10) || 0;
    const lastActivity = stats.last_activity || null;

    // Derive computed attributes
    const trustLevel = trustLevelFromScore(trustScore);

    const engagementStatus = (() => {
      if (ghostingEvents > 3 || trustScore < 50) return "Inactive";
      if (positiveEvents >= 5 && ghostingEvents === 0) return "Highly Engaged";
      if (positiveEvents >= 2) return "Engaged";
      return "Needs Response";
    })();

    const ghostingRisk = (() => {
      if (ghostingEvents === 0 && trustScore >= 80) return "Low";
      if (ghostingEvents <= 2 && trustScore >= 60) return "Moderate";
      return "High";
    })();

    return {
      trustScore,
      trustLevel,
      engagementStatus,
      ghostingRisk,
      successfulConversations: positiveEvents,
      ghostedConversations: ghostingEvents,
      lastActivity,
    };
  } catch (err) {
    console.warn("[Trust] computeTrustStatus failed:", err.message);
    return {
      trustScore: 100,
      trustLevel: "Good",
      engagementStatus: "Engaged",
      ghostingRisk: "Low",
      successfulConversations: 0,
      ghostedConversations: 0,
      lastActivity: null,
    };
  }
};

// ─── Auto-Ghosting Penalty (Module 8 Fix) ────────────────────────────────────

/**
 * Automatically applies the ghosting penalty to a user and appends a
 * behavioural insight event into their Digital Twin's memory.
 *
 * Idempotent: if a ghosting penalty has already been recorded for the same
 * handshake session in trust_history, it will not double-penalise.
 *
 * Called non-blocking from getTrustStatus when detectActiveGhostingAlert fires.
 *
 * @param {number} userId        - The user who ghosted.
 * @param {number} partnerId     - The partner they ghosted.
 * @param {number|null} sessionId - The handshake session ID (if available).
 */
export const applyGhostingPenalty = async (userId, partnerId, sessionId = null) => {
  try {
    // ── Idempotency guard: skip if penalty already applied for this session ──
    if (sessionId) {
      const { rows: existing } = await pool.query(
        `SELECT id FROM trust_history
         WHERE user_id = $1
           AND handshake_id = $2
           AND points_change < 0
           AND reason ILIKE 'Ghosting%'
         LIMIT 1`,
        [userId, sessionId]
      );
      if (existing.length > 0) {
        console.log(`[Trust] Auto-ghosting penalty already applied for user ${userId}, session ${sessionId}. Skipping.`);
        return;
      }
    }

    // ── 1. Apply trust penalty ───────────────────────────────────────────────
    await adjustTrustScore(
      userId,
      POINTS.GHOSTING,
      "Ghosting: Auto-detected inactivity after handshake",
      sessionId
    );
    console.log(`[Module 8] Auto-ghosting penalty applied to user ${userId}`);

    // ── 2. Fetch the user's Digital Twin ─────────────────────────────────────
    const { rows: twinRows } = await pool.query(
      "SELECT id, twin_data FROM digital_twins WHERE user_id = $1 LIMIT 1",
      [userId]
    );
    if (twinRows.length === 0) return;

    const twin = twinRows[0];
    const twinData = twin.twin_data || {};

    // Ensure memory structure exists
    if (!twinData.memory) twinData.memory = { events: [], handshakes: [], relationship_learning: [] };
    if (!Array.isArray(twinData.memory.events)) twinData.memory.events = [];

    const timestamp = new Date().toISOString();
    const currentStateSummary =
      twinData.current_state_summary ||
      twinData.emotional_architecture ||
      "No summary available.";

    // ── 3. Call Gemini for a 1-sentence behavioural insight ──────────────────
    let insight = "User shows a pattern of disengaging after initial contact without follow-through.";

    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

      const prompt = `You are an AI relationship behavioural analyst.

A user on a dating/networking platform has not responded to a match for over 48 hours after a successful compatibility handshake.

Current Digital Twin state summary:
"${currentStateSummary.slice(0, 400)}"

In exactly 1 concise sentence (max 30 words), describe what this pattern of non-engagement reveals about their current communication readiness or availability. Do NOT be judgmental.`;

      const result = await model.generateContent(prompt);
      insight = result.response.text().trim();
      console.log(`[Module 8] Gemini auto-ghosting insight generated for user ${userId}`);
    } catch (geminiErr) {
      console.warn("[Module 8] Gemini auto-insight failed, using fallback:", geminiErr.message);
    }

    // ── 4. Append ghosting event to twin memory ───────────────────────────────
    twinData.memory.events.push({
      type: "ghosting_auto",
      timestamp,
      partnerId,
      sessionId,
      insight
    });

    await pool.query(
      "UPDATE digital_twins SET twin_data = $1, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(twinData), twin.id]
    );

    console.log(`[Module 8] Twin memory updated with auto-ghosting event for user ${userId}`);
  } catch (err) {
    // Non-blocking — never crash the caller
    console.warn(`[Module 8] applyGhostingPenalty failed for user ${userId}:`, err.message);
  }
};
