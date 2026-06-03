import express from "express";
import { validateAccessToken } from "../middleware/verfiytoken.js";
import { getPlanStatus } from "../controller/planController.js";

const router = express.Router();

// 🔐 PROTECTED ROUTE
router.get("/me/plan-status",validateAccessToken,getPlanStatus);

export default router;
