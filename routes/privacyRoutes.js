import express from "express";
import { validateAccessToken } from "../middleware/verfiytoken.js";
import { authRateLimiter } from "../middleware/rateLimiter.js";
import { validate } from "../validations/validate.js";
import { deleteAccountSchema } from "../validations/accountDeletionSchemas.js";
import { deleteAccount, exportUserData, getDeletionMethod, requestDeletionCode, updateConsentStatus } from "../controller/privacyController.js";

const router = express.Router();

// GDPR Compliance endpoints
router.get("/api/privacy/export", validateAccessToken, exportUserData);
router.get("/api/privacy/delete-account/method", validateAccessToken, getDeletionMethod); // "password" or "code"
router.post("/api/privacy/delete-account/code", validateAccessToken, authRateLimiter, requestDeletionCode); // Google/LinkedIn users only
router.post("/api/privacy/delete-account", validateAccessToken, authRateLimiter, validate(deleteAccountSchema), deleteAccount); // Soft delete
router.post("/api/privacy/consent", (req, res, next) => {
  // Optional token check: if Authorization header exists, validate it, otherwise proceed anonymous
  if (req.headers.authorization) {
    return validateAccessToken(req, res, next);
  }
  next();
}, updateConsentStatus);

export default router;
