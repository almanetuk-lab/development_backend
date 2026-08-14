import { pool } from "../config/db.js";
import { supabase, uploadToSupabase } from "../utils/supabaseUpload.js";

// ✅ Controller: Upload Image to Supabase
export const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Upload to Supabase Storage and get the public URL
    const imageUrl = await uploadToSupabase(req.file);

    return res.status(200).json({
      message: "Image uploaded successfully",
      imageUrl: imageUrl,
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

    // Step 2️⃣ - Delete image from Supabase storage if it is a Supabase URL
    if (imageUrl.includes("supabase.co")) {
      const parts = imageUrl.split("/user_uploads/");
      if (parts.length > 1) {
        const filePath = parts[1];
        const { error: storageError } = await supabase.storage
          .from("user_uploads")
          .remove([filePath]);
        if (storageError) {
          console.error("❌ Error deleting file from Supabase storage:", storageError.message);
        }
      }
    }

    // Step 3️⃣ - Update DB and remove image URL
    await pool.query(
      "UPDATE profiles SET image_url = NULL WHERE user_id = $1 RETURNING *",
      [user_id]
    );

    // Step 4️⃣ - Return success response
    res.status(200).json({
      message: "Profile picture removed successfully",
      image_url: null,
    });
  } catch (error) {
    console.error("❌ Error removing profile picture:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
