import express from "express";
import { getAiAgentConfig, updateAiAgentConfig, checkCompatibilityStatus } from "../controller/aiAgentController.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";

const router = express.Router();

router.get("/config", validateAccessToken, getAiAgentConfig);
router.put("/config", validateAccessToken, updateAiAgentConfig);

// GET /api/ai-agent/compatibility/check/:partnerUserId
// Lightweight poll — returns compatible: true|false|null for current user + partner pair
router.get("/compatibility/check/:partnerUserId", validateAccessToken, checkCompatibilityStatus);

export default router;
