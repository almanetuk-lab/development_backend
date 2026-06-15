import { pool } from "../config/db.js";

export const getUsersByType = async (req, res) => {
  try {
    const { type = "all", fromDate, toDate } = req.query;

    const conditions = ["1=1"];
    const values = [];

    // status filter (same logic as yours)
    if (type === "approved") conditions.push(`u.status = 'Approve'`);
    if (type === "hold") conditions.push(`u.status = 'On Hold'`);
    if (type === "process") conditions.push(`u.status = 'In Process'`);
    if (type === "deactivated") conditions.push(`u.status = 'Deactivate'`);

    // ✅ date filter (users.created_at based)
    if (fromDate && toDate) {
      const fromTS = `${fromDate} 00:00:00`;
      const toTS = `${toDate} 23:59:59`;

      values.push(fromTS, toTS);
      conditions.push(`u.created_at BETWEEN $1 AND $2`);
    }

    const query = `
      SELECT
        u.id,
        COALESCE(p.first_name, 'N/A') AS name,
        COALESCE(p.last_name, 'N/A') AS Lname,
        u.email,
        p.age,
        p.profession,
        u.status,
        u.created_at
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY u.id DESC
    `;

    const result = await pool.query(query, values);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
