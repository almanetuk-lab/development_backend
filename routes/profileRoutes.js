import express from "express";
import { getProfile,updateProfile } from "../controller/profileController.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";
import upload from "../middleware/upload.js";

const router = express.Router();


router.put("/api/editProfile",validateAccessToken,upload.single("photo"),updateProfile); // Update User Profile
router.get("/api/me",validateAccessToken,getProfile); // Get Logged-in User Profile

export default router;


