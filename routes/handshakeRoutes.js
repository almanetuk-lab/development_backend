import express from "express";
import {
  initiateHandshake,
  getHandshakeHistory,
  getTrustStatus,
  ghostingRespond,
  ghostingDismiss,
} from "../controller/handshakeController.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";

const router = express.Router();

// ─── Module 8: Trust & Anti-Ghosting ────────────────────────────────────────
// GET  /api/handshake/trust-status      — fetch trust score + ghosting alert
// POST /api/handshake/ghosting-respond  — submit ghosting reason, resolves the alert
// POST /api/handshake/ghosting-dismiss  — close the alert without a reason, resolves it
router.get("/trust-status", validateAccessToken, getTrustStatus);
router.post("/ghosting-respond", validateAccessToken, ghostingRespond);
router.post("/ghosting-dismiss", validateAccessToken, ghostingDismiss);

// POST /api/handshake/:userId
router.post("/:userId", validateAccessToken, initiateHandshake);

// GET /api/handshake/history
router.get("/history", validateAccessToken, getHandshakeHistory);

export default router;
