import express from "express";
import { getProfile, updateProfile, updateLocation, getNearbyProfiles } from "../controller/profileController.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";
import upload from "../middleware/upload.js";
import { checkFeatureGuard } from "../middleware/checkActivePlan.js";

const router = express.Router();

router.put("/api/editProfile", validateAccessToken, checkFeatureGuard("edit_profile"), upload.single("photo"), updateProfile); // Update User Profile
router.get("/api/me", validateAccessToken, getProfile); // Get Logged-in User Profile

// 📍 PostGIS Proximity Search Routes
router.put("/api/profiles/location", validateAccessToken, updateLocation);
router.get("/api/profiles/nearby", validateAccessToken, getNearbyProfiles);

export default router;


