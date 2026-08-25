import { pool } from "../config/db.js";

/**
 * Logs an event to the security_audit_logs table.
 * @param {number|null} userId 
 * @param {string} action 
 * @param {object|string|null} details 
 * @param {object|null} req Express request object to retrieve IP and User Agent
 */
export const logAuditEvent = async (userId, action, details, req = null) => {
  try {
    let ipAddress = null;
    let userAgent = null;

    if (req) {
      ipAddress = req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress || null;
      userAgent = req.headers["user-agent"] || null;
    }

    const detailsStr = details 
      ? (typeof details === "object" ? JSON.stringify(details) : details)
      : null;

    await pool.query(
      `INSERT INTO security_audit_logs (user_id, action, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, action, detailsStr, ipAddress, userAgent]
    );
  } catch (err) {
    console.error("❌ Error writing security audit log:", err.message);
  }
};
