import express from "express";
// import { getNotifications, markAsRead, markNotificationsAsRead } from "../controller/notificationController.js";
import { markAsRead, getNotifications, markNotificationsAsRead } from "../controller/notificationController.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";

const router = express.Router();

router.get("/:user_id", validateAccessToken, getNotifications); // Get Notifications by User ID
router.put("/read/:id", validateAccessToken, markAsRead); // Mark Notification as Read
router.put("/read/messages/:userId", validateAccessToken, markNotificationsAsRead);  // Mark All Notifications as Read for User  

export default router;
