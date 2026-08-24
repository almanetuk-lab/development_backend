import express from 'express';
import { getUserMatches } from '../controller/userMatchesController.js';
import { validateAccessToken } from '../middleware/verfiytoken.js';
import { checkFeatureGuard } from "../middleware/checkActivePlan.js";

const router = express.Router();

router.get("/:userId", validateAccessToken, checkFeatureGuard("my_matches"), getUserMatches);

export default router;