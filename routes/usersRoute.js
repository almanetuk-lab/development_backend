import express from 'express';
import { userProfile } from '../controller/usersController.js';
import { validateAccessToken } from "../middleware/verfiytoken.js";
import { checkFeatureGuard } from "../middleware/checkActivePlan.js";
const router = express.Router();

//router.get("/", allUsersProfiles);
router.get("/:userId", validateAccessToken, checkFeatureGuard("profile"), userProfile);


export default router;