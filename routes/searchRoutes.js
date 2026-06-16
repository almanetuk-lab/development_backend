import express from "express";
import { searchProfiles } from "../controller/searchController.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";
const router = express.Router();

// ✅ EXACTLY LIKE CHAT ROUTES
router.get("/search", validateAccessToken,searchProfiles);

export default router;
