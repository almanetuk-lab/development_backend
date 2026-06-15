import express from "express";
import {
  getSuggestions,
  getCompatibilityReport,
  analyzeProfile,
  regenerateCompatibility,
  getCompatibilityStatus,
  setRefinedQuerySession,
  getActiveRefinedQuerySession,
  clearRefinedQuerySession,
  getSentimentAudit,
  runSentimentAudit,
} from "../controller/matchController.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";

const router = express.Router();

// ──────────────────────────────────────────────────────────────
// AI Semantic Suggestions (vector cosine similarity search)
// GET /api/matches/suggestions
// ──────────────────────────────────────────────────────────────
router.get("/api/matches/suggestions", validateAccessToken, getSuggestions);

// ──────────────────────────────────────────────────────────────
// Adaptive Query Refinement — Clarification Loop (Point #7)
// POST   /api/matches/refine-query          → create session
// GET    /api/matches/refine-query/active    → get active session
// DELETE /api/matches/refine-query/active    → clear session
// ──────────────────────────────────────────────────────────────
router.post("/api/matches/refine-query", validateAccessToken, setRefinedQuerySession);
router.get("/api/matches/refine-query/active", validateAccessToken, getActiveRefinedQuerySession);
router.delete("/api/matches/refine-query/active", validateAccessToken, clearRefinedQuerySession);

// ──────────────────────────────────────────────────────────────
// Diagnostic: compatibility table health check
// GET /api/matches/compatibility/status
// (Must be declared BEFORE /:targetUserId to avoid route conflict)
// ──────────────────────────────────────────────────────────────
router.get("/api/matches/compatibility/status", validateAccessToken, getCompatibilityStatus);

// ──────────────────────────────────────────────────────────────
// Full Multi-Dimensional AI Compatibility Report
// GET /api/matches/compatibility/:targetUserId
// ──────────────────────────────────────────────────────────────
router.get("/api/matches/compatibility/:targetUserId", validateAccessToken, getCompatibilityReport);

// ──────────────────────────────────────────────────────────────
// Manual AI Profile Analysis (generate + save intent tags, embedding)
// POST /api/ai/analyze-profile
// ──────────────────────────────────────────────────────────────
router.post("/api/ai/analyze-profile", validateAccessToken, analyzeProfile);

// ──────────────────────────────────────────────────────────────
// Force Regenerate Compatibility (bypass cache)
// POST /api/ai/regenerate-compatibility/:targetUserId
// ──────────────────────────────────────────────────────────────
router.post("/api/ai/regenerate-compatibility/:targetUserId", validateAccessToken, regenerateCompatibility);

// ──────────────────────────────────────────────────────────────
// Sentiment & Tone Audit (Emotional Insights)
// ──────────────────────────────────────────────────────────────
router.get("/api/match/emotional-insights/:userId", validateAccessToken, getSentimentAudit);
router.post("/api/match/analyze-sentiment", validateAccessToken, runSentimentAudit);

export default router;
