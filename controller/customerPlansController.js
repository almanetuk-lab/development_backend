import { pool } from "../config/db.js";

//  User: only active plans
export const getAllPlans = async (req, res) => {
    try {
        const query = `
      SELECT * FROM plans
      WHERE is_active = 1
      ORDER BY id ASC;
    `;
        const { rows: plans } = await pool.query(query);
        res.json(plans);
    } catch (err) {
        console.error("Error fetching active plans:", err);
        res.status(500).json({ error: "Database error" });
    }
};