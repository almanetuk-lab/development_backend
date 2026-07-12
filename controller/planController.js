import { pool } from "../config/db.js";

export const getPlanStatus = async (req, res) => {
  try {
    // ✅ comes from token
    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT expires_at
      FROM user_plans
      WHERE user_id = $1
        AND status = 'active'
      ORDER BY expires_at DESC
      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ active: false, days_left: 0 });
    }

    const expiresAt = new Date(result.rows[0].expires_at);
    const today = new Date();

    const daysLeft = Math.max(
      Math.ceil((expiresAt - today) / (1000 * 60 * 60 * 24)),
      0
    );

    res.json({
      active: daysLeft > 0,
      days_left: daysLeft,
    });
  } catch (err) {
    console.error("Plan status error:", err);
    res.status(500).json({ active: false, days_left: 0 });
  }
};
