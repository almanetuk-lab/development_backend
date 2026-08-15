import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Uploads a Multer memory buffer to Supabase storage.
 * @param {Express.Multer.File} file - Multer file object.
 * @param {string} bucketName - Name of the bucket.
 * @returns {Promise<string>} - Public URL of the uploaded file.
 */
export const uploadToSupabase = async (file, bucketName = "user_uploads") => {
  if (!file) return null;
  
  // Create a unique file path
  const fileExt = file.originalname.split('.').pop() || 'png';
  const fileName = `public/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: true
    });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  // Retrieve public URL
  const { data: { publicUrl } } = supabase.storage
    .from(bucketName)
    .getPublicUrl(data.path);

  return publicUrl;
};

/**
 * Deletes a file from Supabase storage using its public URL.
 * @param {string} fileUrl - Public URL of the file to delete.
 * @param {string} bucketName - Name of the bucket.
 */
export const deleteFromSupabase = async (fileUrl, bucketName = "user_uploads") => {
  if (!fileUrl) return;

  try {
    if (fileUrl.includes("supabase.co")) {
      const parts = fileUrl.split(`/${bucketName}/`);
      if (parts.length > 1) {
        const filePath = parts[1];
        console.log(`🗑️ [Supabase Storage] Deleting file: ${filePath} from bucket: ${bucketName}`);
        const { error } = await supabase.storage
          .from(bucketName)
          .remove([filePath]);
        if (error) {
          console.error("❌ [Supabase Storage] Delete error:", error.message);
        } else {
          console.log(`✅ [Supabase Storage] Deleted file successfully: ${filePath}`);
        }
      }
    }
  } catch (err) {
    console.error("❌ [Supabase Storage] Exception during deletion:", err.message);
  }
};
