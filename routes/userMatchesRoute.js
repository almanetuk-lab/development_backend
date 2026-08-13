import express from 'express';
import { getUserMatches } from '../controller/userMatchesController.js';
import { validateAccessToken } from '../middleware/verfiytoken.js';

const router = express.Router();

router.get("/:userId", validateAccessToken, getUserMatches);

export default router;