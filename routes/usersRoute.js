import express from 'express';
import { userProfile, getUserTrustStatus } from '../controller/usersController.js';
import { validateAccessToken } from "../middleware/verfiytoken.js";
import { checkFeatureGuard } from "../middleware/checkActivePlan.js";
const router = express.Router();

//router.get("/", allUsersProfiles);
router.get("/:userId", validateAccessToken, checkFeatureGuard("profile"), userProfile);
router.get("/:userId/trust", validateAccessToken, getUserTrustStatus);

export default router;