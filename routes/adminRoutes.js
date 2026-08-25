// routes/adminRoutes.js
import express from "express";
import { adminLogin, approveUser, deactivateUser, getAllUserDetails, getAllUsers, onHoldUser, getContactMessages, getNewsletterSubscriptions, deleteContactMessage, deleteNewsletterSubscription } from "../controller/adminController.js";
import { verifyAdminToken } from "../middleware/verifyAdminToken.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";
import { getAuditLogs } from "../controller/adminAuditController.js";

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

export default router;
