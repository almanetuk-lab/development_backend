import { uploadToSupabase } from "../utils/supabaseUpload.js";
import { pool } from "../config/db.js";

const TITLE_MAX = 200;
const SUBTITLE_MAX = 500;

// The editor sends HTML, so "<p></p>" counts as empty.
const hasText = (html) =>
  typeof html === "string" && html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;

// Returns an error message, or null when the fields are valid.
// `partial` allows omitted fields (update keeps the old value).
const validateArticleFields = ({ title, subtitle, content }, partial = false) => {
  if (!partial || title !== undefined) {
    if (typeof title !== "string" || !title.trim()) return "Title is required.";
    if (title.trim().length > TITLE_MAX) return `Title must be ${TITLE_MAX} characters or fewer.`;
  }
  if (subtitle !== undefined && subtitle !== null && String(subtitle).trim().length > SUBTITLE_MAX) {
    return `Subtitle must be ${SUBTITLE_MAX} characters or fewer.`;
  }
  if (!partial || content !== undefined) {
    if (!hasText(content)) return "Content is required.";
  }
  return null;
};

// Upload the cover image, turning storage failures into a readable 502.
const uploadCover = async (file, res) => {
  try {
    return { url: await uploadToSupabase(file) };
  } catch (err) {
    console.error("❌ [Blog] Cover image upload failed:", err.message);
    res.status(502).json({ ok: false, message: `Cover image upload failed: ${err.message}` });
    return { failed: true };
  }
};



// Create Article (Admin)
export const createArticle = async (req, res) => {
  try {
    const { title, subtitle, content } = req.body ?? {};

    const invalid = validateArticleFields({ title, subtitle, content });
    if (invalid) return res.status(400).json({ ok: false, message: invalid });

    let imageUrl = null;
    if (req.file) {
      const upload = await uploadCover(req.file, res);
      if (upload.failed) return;
      imageUrl = upload.url;
    }

    const result = await pool.query(
      "INSERT INTO articles (title, subtitle, content, cover_image, author_id) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [title.trim(), subtitle?.trim() || null, content, imageUrl, req.admin.id]
    );

    res.json({
      ok: true,
      message: "Article created successfully",
      article: result.rows[0]
    });

  } catch (err) {
    console.error("❌ [Blog] Create failed:", err);
    res.status(500).json({ ok: false, message: err.message });
  }
};


export const updateArticle = async (req, res) => {
  try {
    const id = req.params.id;
    const { title, subtitle, content } = req.body ?? {};

    const invalid = validateArticleFields({ title, subtitle, content }, true);
    if (invalid) return res.status(400).json({ ok: false, message: invalid });

    const old = await pool.query("SELECT * FROM articles WHERE id=$1", [id]);

    if (old.rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Article not found" });
    }

    const oldArticle = old.rows[0];

    let newImage = oldArticle.cover_image;
    if (req.file) {
      const upload = await uploadCover(req.file, res);
      if (upload.failed) return;
      newImage = upload.url;
    }

    const updated = await pool.query(
      `UPDATE articles SET 
      title=$1, subtitle=$2, content=$3, cover_image=$4, updated_at=NOW()
      WHERE id=$5 RETURNING *`,
      [
        title?.trim() || oldArticle.title,
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
    console.error("❌ [Blog] Update failed:", err);
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
