import express from "express";
import { forgotPassword, loginUser,registerUser,resetPassword } from "../controller/authController.js";
import { validateRefreshToken } from "../middleware/verfiytoken.js";

const router = express.Router();
// Auth Routes
router.post("/api/register",registerUser);  // User Registration
router.post("/api/login",loginUser);  // User Login
router.post("/api/forgotpassword",forgotPassword); // Forgot Password
router.post("/api/reset-password/:token",resetPassword);  // Reset Password
router.get("/api/refreshtoken",validateRefreshToken);  // Refresh Token

export default router;