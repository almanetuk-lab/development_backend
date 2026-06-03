// routes/adminRoutes.js
import express from "express";
import { adminLogin, approveUser, deactivateUser, getAllUserDetails, getAllUsers, onHoldUser } from "../controller/adminController.js";
import { verifyAdminToken } from "../middleware/verifyAdminToken.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";

const router = express.Router();

// Admin Routes
router.post("/api/admin/login", adminLogin); // Admin login
router.post("/api/admin/approveUser", verifyAdminToken, approveUser); // Approve User
router.post("/api/admin/on-hold", verifyAdminToken, onHoldUser); // On Hold User
router.post("/api/admin/deactivate", verifyAdminToken, deactivateUser); // Deactivate User
router.get("/api/admin/users", validateAccessToken, getAllUsers); // Get All Users
router.get("/api/admin/getdetails/:id", validateAccessToken, getAllUserDetails);  // Get User Details by ID

export default router;
