import { pool } from "../config/db.js";

export const getNotRenewedUsers = async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    const values = [];
    let rangeFilter = "";

    // ✅ optional date filter on expiry date
    if (fromDate && toDate) {
      const fromTS = `${fromDate} 00:00:00`;
      const toTS = `${toDate} 23:59:59`;

      values.push(fromTS, toTS);
      rangeFilter = `AND l.expires_at BETWEEN $1 AND $2`;
    }

    const query = `
      WITH latest AS (
        SELECT DISTINCT ON (up.user_id)
          up.user_id,
          up.plan_id,
          up.expires_at,
          up.created_at
        FROM user_plans up
        WHERE up.expires_at IS NOT NULL
        ORDER BY up.user_id, up.expires_at DESC, up.created_at DESC
      )
      SELECT
        u.id AS user_id,
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(p.first_name,''), ' ', COALESCE(p.last_name,''))), ''),
          'N/A'
        ) AS name,
        u.email,
        COALESCE(p.phone, 'N/A') AS phone,
        pl.name AS last_plan,
        l.expires_at AS last_expires_at
      FROM latest l
      JOIN users u ON u.id = l.user_id
      LEFT JOIN profiles p ON p.user_id = u.id
      LEFT JOIN plans pl ON pl.id = l.plan_id
      WHERE
        l.expires_at < NOW()
        ${rangeFilter}
        AND NOT EXISTS (
          SELECT 1
          FROM user_plans up2
          WHERE up2.user_id = u.id
            AND up2.expires_at IS NOT NULL
            AND up2.expires_at >= NOW()
        )
      ORDER BY l.expires_at DESC;
    `;

    const result = await pool.query(query, values);
    return res.json({ data: result.rows });
  } catch (e) {
    console.error("Not Renewed Users Error:", e);
    return res.status(500).json({ message: e.message });
  }
};