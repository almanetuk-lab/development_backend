import express from "express";
import { forgotPassword, loginUser, registerUser, resetPassword, changePassword, sendContactMessage, subscribeNewsletter } from "../controller/authController.js";
import { validateRefreshToken, validateAccessToken } from "../middleware/verfiytoken.js";
import { clearAuthCookies } from "../utils/cookieHelper.js";
import { validate } from "../validations/validate.js";
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema, contactSchema, newsletterSchema } from "../validations/authSchemas.js";

const router = express.Router();
// Auth Routes
router.post("/api/register", validate(registerSchema), registerUser);  // User Registration
router.post("/api/login", validate(loginSchema), loginUser);  // User Login
router.post("/api/forgotpassword", validate(forgotPasswordSchema), forgotPassword); // Forgot Password
router.post("/api/reset-password/:token", validate(resetPasswordSchema), resetPassword);  // Reset Password
router.post("/api/refreshtoken", validateRefreshToken);  // Refresh Token (changed from GET to POST)
router.post("/api/auth/change-password", validateAccessToken, validate(changePasswordSchema), changePassword); // Change Password (Authenticated)
router.post("/api/contact", validate(contactSchema), sendContactMessage); // Contact Form
router.post("/api/newsletter/subscribe", validate(newsletterSchema), subscribeNewsletter); // Newsletter Subscription

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