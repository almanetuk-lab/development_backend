import { pool } from "../config/db.js";

export const getConfigurations = async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM configurations LIMIT 1;");
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Error fetching configuration:", err);
        res.status(500).json({ error: "Database error" });
    }
};