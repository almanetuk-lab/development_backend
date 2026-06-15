import express from "express";
// import { getNotifications, markAsRead, markNotificationsAsRead } from "../controller/notificationController.js";
import { markAsRead, getNotifications, markNotificationsAsRead } from "../controller/notificationController.js";
//import { validateAccessToken } from "../middleware/verfiytoken.js";

const router = express.Router();

//Code Addes 
// router.get("/users", validateAccessToken, getUnreadNotifications);
// router.get("/users/:senderId", validateAccessToken, getChatMessages);

 router.get("/:user_id", getNotifications); // Get Notifications by User ID
 router.put("/read/:id", markAsRead); // Mark Notification as Read               /(4)
 router.put("/read/messages/:userId", markNotificationsAsRead);  // Mark All Notifications as Read for User  

export default router;
