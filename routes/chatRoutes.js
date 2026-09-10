import express from "express";
import { uploadFile, getAllUsers, getMessagesForUser, getAllMessages, addReaction, getAllReactions,deleteMessage} from "../controller/chatController.js";
import { getRecentChats } from "../controller/chatController.js";
import upload from "../middleware/upload.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";
import { checkFeatureGuard } from "../middleware/checkActivePlan.js";
import { validate } from "../validations/validate.js";
import { sendMessageSchema, addReactionSchema, getMessagesParamsSchema, getMessagesQuerySchema, deleteMessageParamsSchema, deleteMessageQuerySchema } from "../validations/chatSchemas.js";

const router = express.Router();


router.get("/api/chats/recent/:myUserId", getRecentChats);         
router.post("/api/chat/upload", validateAccessToken, checkFeatureGuard("message"), upload.single("file"), uploadFile);   //
router.get("/api/users", getAllUsers); 
router.get("/api/messages/:userId", validate(getMessagesParamsSchema, "params"), getMessagesForUser); 
router.post("/api/messages",validateAccessToken, checkFeatureGuard("message"), validate(sendMessageSchema), getAllMessages); // 
router.post("/api/reactions",validateAccessToken, checkFeatureGuard("message"), validate(addReactionSchema), addReaction);    //
router.get("/api/reactions", getAllReactions);        
router.delete("/api/messages/:id", validate(deleteMessageParamsSchema, "params"), deleteMessage); 

// ---------------- Get Chat Messages ----------------


 
export default router;

