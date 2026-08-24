import { pool } from "../config/db.js";

export const getAuditLogs = async (req, res) => {
  try {
    const { start_date, end_date, action, user_id, limit = 50, offset = 0 } = req.query;

    let queryStr = `
      SELECT al.*, u.email as user_email, pr.first_name, pr.last_name
      FROM security_audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN profiles pr ON al.user_id = pr.user_id
      WHERE 1=1
    `;
    const values = [];
    let paramIndex = 1;

    if (start_date) {
      queryStr += ` AND al.created_at >= $${paramIndex}`;
      values.push(`${start_date} 00:00:00`);
      paramIndex++;
    }

    if (end_date) {
      queryStr += ` AND al.created_at <= $${paramIndex}`;
      values.push(`${end_date} 23:59:59`);
      paramIndex++;
    }

    if (action) {
      queryStr += ` AND al.action = $${paramIndex}`;
      values.push(action);
      paramIndex++;
    }

    if (user_id) {
      queryStr += ` AND al.user_id = $${paramIndex}`;
      values.push(user_id);
      paramIndex++;
    }

    // Count query for pagination
    const countQueryStr = queryStr.replace("al.*, u.email as user_email, pr.first_name, pr.last_name", "COUNT(*) as total");
    const countRes = await pool.query(countQueryStr, values);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    // Sorting and Pagination
    queryStr += ` ORDER BY al.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    values.push(parseInt(limit, 10), parseInt(offset, 10));

    const { rows } = await pool.query(queryStr, values);

    res.json({
      total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      logs: rows
    });
  } catch (err) {
    console.error("Error fetching audit logs:", err);
    res.status(500).json({ error: "Database error" });
  }
};
