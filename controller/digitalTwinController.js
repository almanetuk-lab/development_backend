import { pool } from "../config/db.js";

export const getDigitalTwin = async (req, res) => {
  try {
    const userId = req.user.id;

    const query = `
      SELECT id, user_id, twin_data, current_state_summary, updated_at
      FROM digital_twins
      WHERE user_id = $1
    `;

    const result = await pool.query(query, [userId]);

    if (!result.rows.length) {
      return res.status(404).json({ message: "Digital Twin not found for this user." });
    }

    return res.status(200).json({
      message: "Digital Twin fetched successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Error fetching Digital Twin:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
