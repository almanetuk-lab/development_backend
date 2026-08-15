import express from "express";
import { createCheckoutSession, getUserPayments, stripeWebhook, verifyCheckoutSession } from "../controller/paymentController.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";
import { authRateLimiter } from "../middleware/rateLimiter.js";
const router = express.Router();

// ⚠️ ONLY webhook uses express.raw
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);  // Stripe Webhook

// Normal JSON for the rest — protected by auth & rate-limiting
router.post("/create-checkout-session", authRateLimiter, validateAccessToken, createCheckoutSession);
router.post("/verify-session", validateAccessToken, verifyCheckoutSession);

// Payment history — JWT identity is verified and compared to url parameter to prevent IDOR
router.get("/:user_id", validateAccessToken, getUserPayments);

export default router;
