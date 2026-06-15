import express from "express";
import { createArticle, getAllArticles, getSingleArticle, deleteArticle, updateArticle } from "../controller/blog.controller.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";
import { verifyAdminToken } from "../middleware/verifyAdminToken.js";
import upload from "../middleware/upload.js";

const router = express.Router();


router.post("/create", validateAccessToken, verifyAdminToken, upload.single("cover_image"), createArticle);
router.put("/update/:id", validateAccessToken, verifyAdminToken, upload.single("cover_image"), updateArticle);
router.delete("/delete/:id", validateAccessToken, verifyAdminToken, deleteArticle);

router.get("/", getAllArticles);          // Public
router.get("/:id", getSingleArticle);     // Public

export default router;
