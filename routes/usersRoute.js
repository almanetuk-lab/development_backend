import express from 'express';
import { userProfile } from '../controller/usersController.js';
import { validateAccessToken } from "../middleware/verfiytoken.js";
const router = express.Router();

//router.get("/", allUsersProfiles);
router.get("/:userId", validateAccessToken, userProfile);


export default router;