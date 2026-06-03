import express from 'express';
import { recentActivitiesAddNewViewer, recentViewers, getUnreadMessagesCount } from '../controller/recentActivitiesController.js';
import { validateAccessToken } from '../middleware/verfiytoken.js';



const router = express.Router();

router.post("/viewers/:viewedId", validateAccessToken, recentActivitiesAddNewViewer);
router.get("/:userId/recentViewers", recentViewers);
router.get("/:userId/unreadMessages",validateAccessToken, getUnreadMessagesCount);

export default router;