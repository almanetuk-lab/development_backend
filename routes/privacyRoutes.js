import express from "express";
import { validateAccessToken } from "../middleware/verfiytoken.js";
import { deleteAccountPermanently, exportUserData, updateConsentStatus } from "../controller/privacyController.js";

const router = express.Router();

// GDPR Compliance endpoints
router.get("/api/privacy/export", validateAccessToken, exportUserData);
router.post("/api/privacy/delete-account", validateAccessToken, deleteAccountPermanently);
router.post("/api/privacy/consent", (req, res, next) => {
  // Optional token check: if Authorization header exists, validate it, otherwise proceed anonymous
  if (req.headers.authorization) {
    return validateAccessToken(req, res, next);
  }
  next();
}, updateConsentStatus);

export default router;
