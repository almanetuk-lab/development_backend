import rateLimit from "express-rate-limit";

// Strict rate limiter for authentication/sensitive routes (login, register, forgot/reset password)
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per 15 minutes
  standardHeaders: true, // Return rate limit info in standard headers
  legacyHeaders: false, // Disable legacy headers
  message: {
    error: "Too many authentication attempts from this IP. Please try again after 15 minutes."
  }
});

// Strict rate limiter for payment/checkout endpoints (prevents Stripe probing & abuse)
export const paymentRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Only 5 checkout session creations per IP per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many payment attempts from this IP. Please try again after 15 minutes."
  }
});

// General rate limiter for all routes to protect the server from DDoS attacks
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests from this IP. Please try again after 15 minutes."
  }
});
