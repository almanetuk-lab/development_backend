import express from "express";
import { getAiAgentConfig, updateAiAgentConfig } from "../controller/aiAgentController.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";

const router = express.Router();

router.get("/config", validateAccessToken, getAiAgentConfig);
router.put("/config", validateAccessToken, updateAiAgentConfig);

export default router;
