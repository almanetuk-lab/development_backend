// routes/adminRoutes.js
import express from "express";
import { adminLogin, approveUser, deactivateUser, reactivateUser, getAllUserDetails, getAllUsers, onHoldUser, getContactMessages, getNewsletterSubscriptions, deleteContactMessage, deleteNewsletterSubscription } from "../controller/adminController.js";
import { verifyAdminToken } from "../middleware/verifyAdminToken.js";
import { getAuditLogs } from "../controller/adminAuditController.js";
import { clearAdminCookie } from "../utils/cookieHelper.js";
import { getFlaggedMessages, getFlaggedCount, dismissFlag, warnFlag, deleteFlaggedMessage, unmuteUser } from "../controller/adminModerationController.js";
import { validate, validateQuery } from "../validations/validate.js";
import { flagIdParamsSchema, listFlagsQuerySchema, reviewActionSchema, userIdParamsSchema, unmuteUserSchema } from "../validations/moderationSchemas.js";
import { banUserSchema, reactivateUserSchema } from "../validations/adminSchemas.js";

const router = express.Router();

// Admin Routes
router.post("/api/admin/login", adminLogin); // Admin login
router.post("/api/admin/approveUser", verifyAdminToken, approveUser); // Approve User
router.post("/api/admin/on-hold", verifyAdminToken, onHoldUser); // On Hold User
router.post("/api/admin/deactivate", verifyAdminToken, validate(banUserSchema), deactivateUser); // Deactivate (ban) User
router.post("/api/admin/reactivate", verifyAdminToken, validate(reactivateUserSchema), reactivateUser); // Reactivate (unban) User
router.get("/api/admin/users", verifyAdminToken, getAllUsers); // Get All Users
router.get("/api/admin/getdetails/:id", verifyAdminToken, getAllUserDetails);  // Get User Details by ID
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
router.post("/api/admin/users/:id/unmute", verifyAdminToken, validate(userIdParamsSchema, "params"), validate(unmuteUserSchema), unmuteUser); // Lift Auto-Moderation Chat Mute

// Admin logout — clears adminAccessToken cookie
router.post("/api/admin/logout", (req, res) => {
  clearAdminCookie(res);
  res.json({ message: "Admin logged out successfully" });
});

export default router;

