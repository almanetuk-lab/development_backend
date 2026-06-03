import { pool } from "../config/db.js";

export const checkActivePlan = async (req, res, next) => {
  try {
    const userId = req.user.id; // comes from validateAccessToken

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
      return res.status(403).json({
        code: "PLAN_EXPIRED",
        message: "Your plan has expired. Please upgrade.",
      });
    }

    const expiresAt = new Date(result.rows[0].expires_at);
    if (expiresAt < new Date()) {
      return res.status(403).json({
        code: "PLAN_EXPIRED",
        message: "Your plan has expired. Please upgrade.",
      });
    }

    next();
  } catch (err) {
    console.error("Plan check error:", err);
    res.status(500).json({ message: "Plan validation failed" });
  }
};
