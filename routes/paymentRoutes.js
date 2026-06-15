import express from "express";
import { createCheckoutSession, getUserPayments, stripeWebhook } from "../controller/paymentController.js";
const router = express.Router();

// ⚠️ ONLY webhook uses express.raw
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);  // Stripe Webhook

// Normal JSON for the rest
router.post("/create-checkout-session", createCheckoutSession); // Create Checkout Session

router.get("/:user_id", getUserPayments); // Get Payments by User ID

export default router;
