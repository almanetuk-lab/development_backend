import express from "express";
//import { cloudinary } from "../config/cloudinaryConfig.js";
import {pool} from "../config/db.js";  
import { v2 as cloudinary } from "cloudinary";

// ✅ Controller: Upload Image to Cloudinary
export  const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Cloudinary URL is automatically available in req.file.path
    return res.status(200).json({
      message: "Image uploaded successfully",
      imageUrl: req.file.path,
    });
  } catch (error) {
    console.error("Image upload error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ✅ Update profile image and return full profile data
export const saveProfileImage = async (req, res) => {
  try {
    const { user_id, imageUrl } = req.body;

    if (!user_id || !imageUrl) {
      return res.status(400).json({ message: "user_id and imageUrl are required" });
    }

    // Step 1: Update image_url
    const updateQuery = `
      UPDATE profiles
      SET image_url = $1, updated_at = NOW()
      WHERE user_id = $2
      RETURNING id;
    `;
    const updateResult = await pool.query(updateQuery, [imageUrl, user_id]);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // Step 2: Fetch full profile after update
    const fetchQuery = `
      SELECT *
      FROM profiles
      WHERE user_id = $1;
    `;
    const fetchResult = await pool.query(fetchQuery, [user_id]);

    res.status(200).json({
      message: "Profile image updated successfully!",
      profiles: fetchResult.rows[0], // ✅ full profile data
    });
  } catch (error) {
    console.error("Error saving image URL:", error);
    res.status(500).json({ message: "Internal Server Error", error });
  }
};




// ✅ Cloudinary config (agar pehle se nahi kiya)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ✅ Controller: Remove Profile Picture
export const removeProfilePicture = async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Step 1️⃣ - Get current image URL from DB
    const { rows } = await pool.query(
      "SELECT image_url FROM profiles WHERE user_id = $1",
      [user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const imageUrl = rows[0].image_url;

    if (!imageUrl) {
      return res.status(400).json({ message: "No profile picture to remove" });
    }

    // Step 2️⃣ - Extract Cloudinary public_id from image URL
    // Example: https://res.cloudinary.com/demo/image/upload/v1234567/abcxyz.jpg
    const parts = imageUrl.split("/");
    const publicIdWithExt = parts[parts.length - 1]; // abcxyz.jpg
    const publicId = publicIdWithExt.split(".")[0]; // abcxyz

    // Step 3️⃣ - Delete image from Cloudinary
    await cloudinary.uploader.destroy(publicId);

    // Step 4️⃣ - Update DB and remove image URL
    await pool.query(
      "UPDATE profiles SET image_url = NULL WHERE user_id = $1 RETURNING *",
      [user_id]
    );

    // Step 5️⃣ - Return success response
    res.status(200).json({
      
      message: "Profile picture removed successfully",
      image_url: null,
    });
  } catch (error) {
    console.error("❌ Error removing profile picture:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
