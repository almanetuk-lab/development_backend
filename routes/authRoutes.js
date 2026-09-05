import express from "express";
import { forgotPassword, loginUser, registerUser, resetPassword, changePassword, sendContactMessage, subscribeNewsletter } from "../controller/authController.js";
import { validateRefreshToken, validateAccessToken } from "../middleware/verfiytoken.js";
import { clearAuthCookies } from "../utils/cookieHelper.js";

const router = express.Router();
// Auth Routes
router.post("/api/register", registerUser);  // User Registration
router.post("/api/login", loginUser);  // User Login
router.post("/api/forgotpassword", forgotPassword); // Forgot Password
router.post("/api/reset-password/:token", resetPassword);  // Reset Password
router.post("/api/refreshtoken", validateRefreshToken);  // Refresh Token (changed from GET to POST)
router.post("/api/auth/change-password", validateAccessToken, changePassword); // Change Password (Authenticated)
router.post("/api/contact", sendContactMessage); // Contact Form
router.post("/api/newsletter/subscribe", subscribeNewsletter); // Newsletter Subscription

// Logout — clears httpOnly auth cookies
router.post("/api/logout", (req, res) => {
  clearAuthCookies(res);
  res.json({ message: "Logged out successfully" });
});

// Auth Check — lightweight endpoint for frontend to verify if user is authenticated
router.get("/api/auth/check", validateAccessToken, (req, res) => {
  res.json({
    authenticated: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      status: req.user.status,
    },
  });
});

export default router;