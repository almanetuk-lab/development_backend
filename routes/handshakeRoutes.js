import express from "express";
import {
  initiateHandshake,
  getHandshakeHistory,
  getTrustStatus,
  ghostingRespond,
} from "../controller/handshakeController.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";

const router = express.Router();

// ─── Module 8: Trust & Anti-Ghosting ────────────────────────────────────────
// GET  /api/handshake/trust-status      — fetch trust score + ghosting alert
// POST /api/handshake/ghosting-respond  — submit ghosting reason + apply penalty
router.get("/trust-status", validateAccessToken, getTrustStatus);
router.post("/ghosting-respond", validateAccessToken, ghostingRespond);

// POST /api/handshake/:userId
router.post("/:userId", validateAccessToken, initiateHandshake);

// GET /api/handshake/history
router.get("/history", validateAccessToken, getHandshakeHistory);

export default router;
