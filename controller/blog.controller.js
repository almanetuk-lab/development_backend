import { v2 as cloudinary } from "cloudinary";
import { pool } from "../config/db.js";



// Create Article (Admin)
export const createArticle = async (req, res) => {
  try {
    const { title, subtitle, content } = req.body;

    const imageUrl = req.file ? req.file.path : null; // Cloudinary image URL

    const result = await pool.query(
      "INSERT INTO articles (title, subtitle, content, cover_image, author_id) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [title, subtitle, content, imageUrl, req.user.id]
    );

    res.json({
      ok: true,
      message: "Article created successfully",
      article: result.rows[0]
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ ok: false, message: err.message });
  }
};


export const updateArticle = async (req, res) => {
  try {
    const id = req.params.id;
    const { title, subtitle, content } = req.body;

    const old = await pool.query("SELECT * FROM articles WHERE id=$1", [id]);

    if (old.rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Article not found" });
    }

    const oldArticle = old.rows[0];

    const newImage = req.file ? req.file.path : oldArticle.cover_image;

    const updated = await pool.query(
      `UPDATE articles SET 
      title=$1, subtitle=$2, content=$3, cover_image=$4, updated_at=NOW()
      WHERE id=$5 RETURNING *`,
      [
        title || oldArticle.title,
        subtitle || oldArticle.subtitle,
        content || oldArticle.content,
        newImage,
        id
      ]
    );

    res.json({
      ok: true,
      message: "Article updated successfully",
      article: updated.rows[0]
    });

  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
};


// Get all articles
export const getAllArticles = async (req, res) => {
  const result = await pool.query(
    `SELECT 
        a.*,
        u.full_name AS author
      FROM articles a
      LEFT JOIN admins u ON a.author_id = u.id
      ORDER BY a.created_at DESC
      ` );
  res.json({ ok: true, articles: result.rows });
};



// Get single article
export const getSingleArticle = async (req, res) => {
  const result = await pool.query(
    `SELECT 
        a.*,
        u.full_name AS author
      FROM articles a
      LEFT JOIN admins u ON a.author_id = u.id
      WHERE a.id = $1
      `, [req.params.id]
  );
  res.json({ ok: true, article: result.rows[0] });
};



// Delete article (Admin)
export const deleteArticle = async (req, res) => {
  await pool.query("DELETE FROM articles WHERE id=$1", [req.params.id]);
  res.json({ ok: true, message: "Article deleted" });
};
