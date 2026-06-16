import express from "express";
import { uploadFile, getAllUsers, getMessagesForUser, getAllMessages, addReaction, getAllReactions,deleteMessage} from "../controller/chatController.js";
import { getRecentChats } from "../controller/chatController.js";
import multer from "multer";
import { validateAccessToken } from "../middleware/verfiytoken.js";
import { checkActivePlan } from "../middleware/checkActivePlan.js";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();


router.get("/api/chats/recent/:myUserId", getRecentChats);         
router.post("/api/chat/upload" ,validateAccessToken, checkActivePlan,upload.single("file"), uploadFile);   //
router.get("/api/users", getAllUsers); 
router.get("/api/messages/:userId", getMessagesForUser); 
router.post("/api/messages",validateAccessToken, checkActivePlan, getAllMessages); // 
router.post("/api/reactions",validateAccessToken, checkActivePlan,addReaction);    //
router.get("/api/reactions", getAllReactions);        
router.delete("/api/messages/:id", deleteMessage); 

// ---------------- Get Chat Messages ----------------


 
export default router;

