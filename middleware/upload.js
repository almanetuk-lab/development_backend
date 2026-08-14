import multer from "multer";
import dotenv from "dotenv";

dotenv.config();

// ✅ Allowed file types
const allowedFormats = ["image/jpeg", "image/png", "image/jpg", "image/webp"];

// ✅ Custom multer filter for image validation
const fileFilter = (req, file, cb) => {
  if (allowedFormats.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Unsupported file format. Please upload an image file."), false);
  }
};

// ✅ Configure memory Storage
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
});

export default upload;
