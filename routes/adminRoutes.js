// routes/adminRoutes.js
import express from "express";
import { adminLogin, approveUser, deactivateUser, getAllUserDetails, getAllUsers, onHoldUser, getContactMessages, getNewsletterSubscriptions, deleteContactMessage, deleteNewsletterSubscription } from "../controller/adminController.js";
import { verifyAdminToken } from "../middleware/verifyAdminToken.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";
import { getAuditLogs } from "../controller/adminAuditController.js";
import { clearAdminCookie } from "../utils/cookieHelper.js";
import { getFlaggedMessages, getFlaggedCount, dismissFlag, warnFlag, deleteFlaggedMessage } from "../controller/adminModerationController.js";
import { validate, validateQuery } from "../validations/validate.js";
import { flagIdParamsSchema, listFlagsQuerySchema, reviewActionSchema } from "../validations/moderationSchemas.js";

const router = express.Router();

// Admin Routes
router.post("/api/admin/login", adminLogin); // Admin login
router.post("/api/admin/approveUser", verifyAdminToken, approveUser); // Approve User
router.post("/api/admin/on-hold", verifyAdminToken, onHoldUser); // On Hold User
router.post("/api/admin/deactivate", verifyAdminToken, deactivateUser); // Deactivate User
router.get("/api/admin/users", validateAccessToken, getAllUsers); // Get All Users
router.get("/api/admin/getdetails/:id", validateAccessToken, getAllUserDetails);  // Get User Details by ID
router.get("/api/admin/audit-logs", verifyAdminToken, getAuditLogs); // Get Admin Audit Logs
router.get("/api/admin/contact-messages", verifyAdminToken, getContactMessages); // Get Contact Messages
router.get("/api/admin/newsletter-subscriptions", verifyAdminToken, getNewsletterSubscriptions); // Get Newsletter Subscriptions
router.delete("/api/admin/contact-messages/:id", verifyAdminToken, deleteContactMessage); // Delete Contact Message
router.delete("/api/admin/newsletter-subscriptions/:id", verifyAdminToken, deleteNewsletterSubscription); // Delete Newsletter Subscription

// Chat moderation — abuse alerts
router.get("/api/admin/flagged-messages", verifyAdminToken, validateQuery(listFlagsQuerySchema), getFlaggedMessages); // List Flagged Messages
router.get("/api/admin/flagged-messages/count", verifyAdminToken, getFlaggedCount); // Pending Flag Count
router.post("/api/admin/flagged-messages/:id/dismiss", verifyAdminToken, validate(flagIdParamsSchema, "params"), validate(reviewActionSchema), dismissFlag); // Dismiss Flag
router.post("/api/admin/flagged-messages/:id/warn", verifyAdminToken, validate(flagIdParamsSchema, "params"), validate(reviewActionSchema), warnFlag); // Warn Sender
router.delete("/api/admin/flagged-messages/:id", verifyAdminToken, validate(flagIdParamsSchema, "params"), validate(reviewActionSchema), deleteFlaggedMessage); // Remove Flagged Message

// Admin logout — clears adminAccessToken cookie
router.post("/api/admin/logout", (req, res) => {
  clearAdminCookie(res);
  res.json({ message: "Admin logged out successfully" });
});

export default router;

