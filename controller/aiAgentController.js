import { getAgentConfig, upsertAgentConfig } from "../services/aiAgentService.js";
import { pool } from "../config/db.js";
import { logAuditEvent } from "../utils/auditLogger.js";

// Thresholds must match aiAgentService.js constants
const COMFORT_OVERALL_THRESHOLD       = 70;
const COMFORT_COMMUNICATION_THRESHOLD = 65;
const COMFORT_EMOTIONAL_THRESHOLD     = 65;

const MAX_INSTRUCTIONS_LENGTH = 2000;

// GET /api/ai-agent/config
export const getAiAgentConfig = async (req, res) => {
  try {
    const config = await getAgentConfig(req.user.id);
    return res.json({ data: config });
  } catch (err) {
    console.error("❌ [AIAgentController] getAiAgentConfig:", err.message);
    return res.status(500).json({ error: "Failed to fetch AI agent config" });
  }
};

// PUT /api/ai-agent/config
export const updateAiAgentConfig = async (req, res) => {
  try {
    const { enabled, instructions } = req.body;

    // Validate: enabled must be boolean
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "\"enabled\" must be a boolean" });
    }

    // Validate: instructions max length
    const trimmedInstructions = typeof instructions === "string"
      ? instructions.trim()
      : "";

    if (trimmedInstructions.length > MAX_INSTRUCTIONS_LENGTH) {
      return res.status(400).json({
        error: `Instructions must be ${MAX_INSTRUCTIONS_LENGTH} characters or fewer`,
      });
    }

    const saved = await upsertAgentConfig(req.user.id, {
      enabled,
      instructions: trimmedInstructions || null,
    });

    logAuditEvent(req.user.id, "AI_AGENT_TOGGLE", { enabled, instructions_length: (trimmedInstructions || "").length }, req);

    return res.json({
      message: "AI agent settings updated",
      data: {
        enabled: saved.enabled,
        instructions: saved.instructions ?? "",
      },
    });
  } catch (err) {
    console.error("❌ [AIAgentController] updateAiAgentConfig:", err.message);
    return res.status(500).json({ error: "Failed to update AI agent config" });
  }
};

// GET /api/ai-agent/compatibility/check/:partnerUserId
// Lightweight poll endpoint — reads the cached profile_compatibilities row
// and returns whether the pair passes the AI agent comfortability thresholds.
// Returns { compatible: true|false|null, scores: {...} }
//   null  → no compatibility data cached yet (treat as unknown, hide warning)
export const checkCompatibilityStatus = async (req, res) => {
  try {
    const myId        = Number(req.user.id);
    const partnerId   = Number(req.params.partnerUserId);

    if (isNaN(myId) || isNaN(partnerId)) {
      return res.status(400).json({ error: "Invalid user identifiers" });
    }
    if (myId === partnerId) {
      return res.status(400).json({ error: "Cannot check compatibility with yourself" });
    }

    const userA = Math.min(myId, partnerId);
    const userB = Math.max(myId, partnerId);

    const { rows } = await pool.query(
      `SELECT
         overall_score,
         (compatibility_data -> 'scores' ->> 'communication_compatibility')::int AS communication_score,
         (compatibility_data -> 'scores' ->> 'emotional_compatibility')::int     AS emotional_score
       FROM profile_compatibilities
       WHERE user_a_id = $1
         AND user_b_id = $2
         AND updated_at > NOW() - INTERVAL '7 days'
       LIMIT 1`,
      [userA, userB]
    );

    if (rows.length === 0) {
      // No cached data — incompatibility cannot be confirmed
      return res.json({ compatible: null, scores: null });
    }

    const { overall_score, communication_score, emotional_score } = rows[0];
    const compatible =
      (overall_score       ?? 0) >= COMFORT_OVERALL_THRESHOLD &&
      (communication_score ?? 0) >= COMFORT_COMMUNICATION_THRESHOLD &&
      (emotional_score     ?? 0) >= COMFORT_EMOTIONAL_THRESHOLD;

    return res.json({
      compatible,
      scores: {
        overall:       overall_score       ?? 0,
        communication: communication_score ?? 0,
        emotional:     emotional_score     ?? 0,
      },
      thresholds: {
        overall:       COMFORT_OVERALL_THRESHOLD,
        communication: COMFORT_COMMUNICATION_THRESHOLD,
        emotional:     COMFORT_EMOTIONAL_THRESHOLD,
      },
    });
  } catch (err) {
    console.error("❌ [AIAgentController] checkCompatibilityStatus:", err.message);
    return res.status(500).json({ error: "Failed to check compatibility status" });
  }
};
