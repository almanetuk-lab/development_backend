import express from "express";
import upload from "../middleware/upload.js";
import { removeProfilePicture, saveProfileImage, uploadImage } from "../controller/uploadController.js";

const router = express.Router();

router.post("/upload", upload.single("image"), uploadImage); // Upload Image
router.post("/saveProfileImage", saveProfileImage); // Save Profile Image
router.post("/remove/profile-picture", removeProfilePicture); // Remove Profile Picture

export default router;
