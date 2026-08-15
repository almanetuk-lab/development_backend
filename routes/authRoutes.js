import express from "express";
import { forgotPassword, loginUser, registerUser, resetPassword, changePassword } from "../controller/authController.js";
import { validateRefreshToken, validateAccessToken } from "../middleware/verfiytoken.js";

const router = express.Router();
// Auth Routes
router.post("/api/register", registerUser);  // User Registration
router.post("/api/login", loginUser);  // User Login
router.post("/api/forgotpassword", forgotPassword); // Forgot Password
router.post("/api/reset-password/:token", resetPassword);  // Reset Password
router.get("/api/refreshtoken", validateRefreshToken);  // Refresh Token
router.post("/api/auth/change-password", validateAccessToken, changePassword); // Change Password (Authenticated)

export default router;