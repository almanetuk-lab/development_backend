import express from "express";
import { getMemberApproval, updateMemberApproval } from "../controller/adminConfigController.js";
import { verifyAdminToken } from "../middleware/verifyAdminToken.js";

const router = express.Router();

router.get("/get-member-approval",verifyAdminToken,getMemberApproval);  // New route to get member approval setting
router.put("/update-member-approval",verifyAdminToken,updateMemberApproval); // New route to update member approval setting

export default router;