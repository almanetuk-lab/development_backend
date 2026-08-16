import { pool } from "../config/db.js";

export const getPlanStatus = async (req, res) => {
  try {
    // ✅ comes from token
    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT up.expires_at, p.name as plan_name
      FROM user_plans up
      LEFT JOIN plans p ON up.plan_id = p.id
      WHERE up.user_id = $1
        AND up.status = 'active'
      ORDER BY up.expires_at DESC
      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ active: false, days_left: 0, plan_name: "Free Plan" });
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
      plan_name: result.rows[0].plan_name || "Premium Plan"
    });
  } catch (err) {
    console.error("Plan status error:", err);
    res.status(500).json({ active: false, days_left: 0, plan_name: "Free Plan" });
  }
};
