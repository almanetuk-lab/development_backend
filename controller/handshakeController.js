import { pool } from "../config/db.js";
import { generateHandshake } from "../services/handshakeService.js";
import { generateOrUpdateTwin } from "../services/digitalTwinService.js";
import {
  computeTrustStatus,
  adjustTrustScore,
  detectActiveGhostingAlert,
  applyGhostingPenalty,
} from "../services/trustService.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ─── Formatting ────────────────────────────────────────────────────────────────

/**
 * Formats a raw handshake_sessions DB row into the API response shape.
 * Maps snake_case DB field stress_synchronization → camelCase stressSynchronization.
 * Future modules (4–10) should extend this mapper, not replace it.
 */
const formatSession = (row) => ({
  id: row.id,
  user_a_id: row.user_a_id,
  user_b_id: row.user_b_id,
  status: row.status,
  compatibility_markers: row.compatibility_markers,
  risk_flags: row.risk_flags,
  handshake_summary: row.handshake_summary,
  // Module 3 — Stress-Cycle Delta Synchronization (camelCase for frontend)
  stressSynchronization: row.stress_synchronization || null,
  // Module 6 — Privacy-Preserving Data Exchange (camelCase for frontend)
  privacyVerification: row.privacy_verification || null,
  // Module 7 — Structural Audit Report (camelCase for frontend)
  auditReport: row.audit_report || null,
  // Module 4 — Agent-to-Agent Friction Interview (camelCase for frontend)
  frictionInterview: row.friction_interview || null,
  // Module 5 — Conflict Simulation Logic (camelCase for frontend)
  conflictSimulation: row.conflict_simulation || null,
  created_at: row.created_at,
  updated_at: row.updated_at
});

// ─── Twin Resolution Helper ─────────────────────────────────────────────────────

/**
 * Fetches the profile data needed to generate a Digital Twin.
 * Returns null if no profile exists for userId.
 */
const fetchProfileData = async (userId) => {
  const result = await pool.query(`
    SELECT
      first_name, last_name, profession, about, about_me,
      life_rhythms, ways_i_spend_time, work_rhythm, work_environment,
      relationship_goal, interaction_style, career_decision_style,
      work_demand_response, life_rhythms,
      intent_tags, contextual_tags, normalized_entities,
      sentiment_audit, spider_graph_data,
      confidence_score, city, state, country
    FROM profiles
    WHERE user_id = $1
    LIMIT 1
  `, [userId]);
  return result.rows[0] || null;
};

/**
 * Returns the existing Digital Twin row for a user.
 * If no twin exists yet, auto-generates one from the user's profile data
 * using the same Module 1 service (generateOrUpdateTwin), then returns it.
 *
 * This ensures the handshake always has twin data to work with, even for
 * users who have not triggered a profile update since Module 1 was deployed.
 *
 * @param {number} userId
 * @param {string} context - "Your" | "Target user's" — for error messages
 * @returns {object} digital_twins DB row
 * @throws {Error} if the profile is missing or twin generation fails
 */
const resolveDigitalTwin = async (userId, context = "Your") => {
  // ── Fast path: twin already exists ──────────────────────────────────────────
  const existing = await pool.query(
    "SELECT * FROM digital_twins WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  if (existing.rows.length > 0) {
    console.log(`✅ [HandshakeController] Existing twin found for user ${userId}`);
    return existing.rows[0];
  }

  // ── Twin missing: auto-generate from profile data ────────────────────────────
  console.log(`🔮 [HandshakeController] No twin found for user ${userId} — auto-generating from profile...`);

  const profile = await fetchProfileData(userId);
  if (!profile) {
    throw new Error(
      `${context} Digital Twin could not be generated because no profile was found. Please complete your profile first.`
    );
  }

  // Reuse the Module 1 service — identical to what the profile update triggers
  const aiOutputs = {
    intent_tags: profile.intent_tags || null,
    contextual_tags: profile.contextual_tags || null,
    normalized_entities: profile.normalized_entities || null,
    sentiment_audit: profile.sentiment_audit || null,
    spider_graph_data: profile.spider_graph_data || null,
  };

  await generateOrUpdateTwin(userId, profile, aiOutputs);

  // Fetch the freshly persisted twin
  const fresh = await pool.query(
    "SELECT * FROM digital_twins WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  if (fresh.rows.length === 0) {
    throw new Error(
      `${context} Digital Twin generation failed unexpectedly. Please try again.`
    );
  }

  console.log(`✅ [HandshakeController] Twin auto-generated and persisted for user ${userId}`);
  return fresh.rows[0];
};

// ─── Controller: Initiate Handshake ─────────────────────────────────────────────

/**
 * POST /api/handshake/:userId
 * Initiates the Structural Handshake Protocol (Module 2) and
 * Stress-Cycle Delta Synchronization (Module 3) between
 * the authenticated user and a target user.
 *
 * If either party does not yet have a Digital Twin, one is auto-generated
 * from their existing profile data using the Module 1 pipeline.
 */
export const initiateHandshake = async (req, res) => {
  try {
    const initiatorId = req.user.id;
    const targetId = parseInt(req.params.userId, 10);

    // ── Guard: valid target ID ───────────────────────────────────────────────
    if (isNaN(targetId)) {
      return res.status(400).json({ message: "Invalid target user ID" });
    }

    // ── Guard: cannot handshake with self ────────────────────────────────────
    if (initiatorId === targetId) {
      return res.status(400).json({ message: "You cannot run a compatibility report with yourself." });
    }

    // ── Guard: target user must exist ────────────────────────────────────────
    const userCheck = await pool.query("SELECT id FROM users WHERE id = $1 LIMIT 1", [targetId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: "Target user not found" });
    }

    // ── Resolve both Digital Twins (auto-generate if missing) ────────────────
    console.log(`[HandshakeController] Resolving twins for users ${initiatorId} and ${targetId}...`);

    let twinA, twinB;
    try {
      twinA = await resolveDigitalTwin(initiatorId, "Your");
    } catch (err) {
      console.error(`❌ [HandshakeController] Could not resolve twin for initiator (${initiatorId}):`, err.message);
      return res.status(422).json({ message: err.message });
    }

    try {
      twinB = await resolveDigitalTwin(targetId, "Target user's");
    } catch (err) {
      console.error(`❌ [HandshakeController] Could not resolve twin for target (${targetId}):`, err.message);
      return res.status(422).json({ message: err.message });
    }

    // ── Run Handshake (compatibility + stress synchronization) ────────────────
    const session = await generateHandshake(initiatorId, targetId, twinA, twinB);

    return res.status(201).json({
      message: "Handshake session completed successfully",
      data: formatSession(session)
    });

  } catch (error) {
    console.error("❌ Error initiating handshake controller:", error);
    return res.status(500).json({
      message: "Server error during handshake initiation",
      error: error.message
    });
  }
};

// ─── Controller: Get Handshake History ───────────────────────────────────────────

/**
 * GET /api/handshake/history
 * Returns all handshake sessions involving the currently logged in user.
 * Includes stress_synchronization (Module 3) in each row.
 */
export const getHandshakeHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const query = `
      SELECT
        id, user_a_id, user_b_id, status,
        compatibility_markers, risk_flags, handshake_summary,
        stress_synchronization, privacy_verification, audit_report,
        friction_interview, conflict_simulation,
        created_at, updated_at
      FROM handshake_sessions
      WHERE user_a_id = $1 OR user_b_id = $1
      ORDER BY created_at DESC;
    `;

    const result = await pool.query(query, [userId]);

    return res.status(200).json({
      message: "Handshake history retrieved successfully",
      data: result.rows.map(formatSession)
    });

  } catch (error) {
    console.error("❌ Error getting handshake history:", error);
    return res.status(500).json({
      message: "Server error fetching handshake history",
      error: error.message
    });
  }
};

// ─── Module 8: Trust Status ───────────────────────────────────────────────────

/**
 * GET /api/handshake/trust-status
 * Returns the caller's Trust Score, Trust Level, Engagement Status,
 * Ghosting Risk, and any active ghosting alert for the UI badge/popup.
 *
 * Module 8 fix: if an active ghosting alert is detected and the penalty has
 * not yet been applied for this session, auto-apply the penalty and update
 * the Digital Twin — no manual user action required.
 */
export const getTrustStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const [trustStatus, ghostingAlert] = await Promise.all([
      computeTrustStatus(userId),
      detectActiveGhostingAlert(userId),
    ]);

    // ── Auto-trigger: apply ghosting penalty + twin update if alert is active ──
    if (ghostingAlert) {
      // Non-blocking — fire and forget so the response is not delayed
      applyGhostingPenalty(
        userId,
        ghostingAlert.partnerId,
        ghostingAlert.sessionId
      ).catch((err) =>
        console.warn("[Module 8] Auto-ghosting penalty failed (non-blocking):", err.message)
      );
    }

    return res.status(200).json({
      message: "Trust status retrieved successfully",
      data: { ...trustStatus, ghostingAlert },
    });
  } catch (error) {
    console.error("❌ Error in getTrustStatus:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Module 8: Ghosting Respond ───────────────────────────────────────────────

const PREDEFINED_REASONS = ["Busy with Work", "Wrong Timing", "Not Interested", "Already Talking to Someone"];
const GHOSTING_PENALTY = parseInt(process.env.GHOSTING_PENALTY_POINTS) || 20;

/**
 * POST /api/handshake/ghosting-respond
 * Body: { sessionId, reason, customReason? }
 *
 * - Applies ghosting penalty to the user.
 * - For predefined reasons: appends a structured event to twin_data.memory.events[] (no Gemini).
 * - For "Other" or custom reasons: calls Gemini to generate a 1-sentence behavioural
 *   insight and appends it to the Digital Twin's memory events array.
 *
 * Fix (Module 8): previously wrote to a non-existent `behavioral_summary` column.
 * Now correctly writes into the twin_data JSONB memory structure.
 */
export const ghostingRespond = async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId, reason, customReason } = req.body;

    if (!reason) {
      return res.status(400).json({ message: "Reason is required" });
    }

    // 1. Apply ghosting penalty
    await adjustTrustScore(userId, -GHOSTING_PENALTY, `Ghosting: ${reason}`, sessionId || null);

    // 2. Fetch Digital Twin (twin_data JSONB — the correct column)
    const twinResult = await pool.query(
      "SELECT id, twin_data FROM digital_twins WHERE user_id = $1 LIMIT 1",
      [userId]
    );

    if (twinResult.rows.length === 0) {
      return res.status(200).json({ message: "Ghosting response recorded", data: { reason } });
    }

    const twin = twinResult.rows[0];
    const twinData = twin.twin_data || {};

    // Ensure memory structure exists
    if (!twinData.memory) twinData.memory = { events: [], handshakes: [], relationship_learning: [] };
    if (!Array.isArray(twinData.memory.events)) twinData.memory.events = [];

    const isPredefined = PREDEFINED_REASONS.includes(reason);
    const timestamp = new Date().toISOString();

    if (isPredefined) {
      // Token-efficient direct update — no Gemini call needed
      twinData.memory.events.push({
        type: "ghosting_note",
        timestamp,
        reason,
        insight: `User opted not to engage. Stated reason: "${reason}".`
      });

      await pool.query(
        "UPDATE digital_twins SET twin_data = $1, updated_at = NOW() WHERE id = $2",
        [JSON.stringify(twinData), twin.id]
      );
    } else {
      // Custom / "Other" reason — call Gemini for a behavioural insight
      const effectiveReason = customReason?.trim() || reason;
      const currentStateSummary = twinData.current_state_summary ||
        twinData.emotional_architecture || "No summary available.";

      let insight = `User opted not to engage. Custom reason: "${effectiveReason}".`;

      try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `You are an AI relationship behavioural analyst.

A user on a dating/networking platform chose NOT to reply to a match.
Their stated reason: "${effectiveReason}"

Current Digital Twin state summary:
"${currentStateSummary.slice(0, 400)}"

In exactly 1 concise sentence (max 30 words), describe what this ghosting pattern reveals about their communication behaviour or readiness for connection. Do NOT be judgmental.`;

        const result = await model.generateContent(prompt);
        insight = result.response.text().trim();
        console.log(`[Module 8] Gemini ghosting insight generated for user ${userId}`);
      } catch (geminiErr) {
        console.warn("[Module 8] Gemini insight failed, using fallback reason:", geminiErr.message);
      }

      twinData.memory.events.push({
        type: "ghosting_insight",
        timestamp,
        reason: effectiveReason,
        insight
      });

      await pool.query(
        "UPDATE digital_twins SET twin_data = $1, updated_at = NOW() WHERE id = $2",
        [JSON.stringify(twinData), twin.id]
      );
    }

    return res.status(200).json({
      message: "Ghosting response recorded successfully",
      data: { reason, twinUpdated: true },
    });

  } catch (error) {
    console.error("❌ Error in ghostingRespond:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
