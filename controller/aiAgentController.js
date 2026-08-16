import { getAgentConfig, upsertAgentConfig } from "../services/aiAgentService.js";

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
