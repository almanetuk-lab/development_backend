import express from 'express';
import { getUserMatches } from '../controller/userMatchesController.js';

const router = express.Router();

router.get("/:userId", getUserMatches);

export default router;