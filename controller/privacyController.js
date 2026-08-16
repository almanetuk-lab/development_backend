import { pool } from "../config/db.js";

import { deleteFromSupabase } from "../utils/supabaseUpload.js";
import bcrypt from "bcrypt";

// helper to log audit events
const logAuditEvent = async (userId, action, details, req) => {
  try {
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress || null;
    const userAgent = req.headers["user-agent"] || null;
    await pool.query(
      `INSERT INTO security_audit_logs (user_id, action, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, details, ipAddress, userAgent]
    );
  } catch (err) {
    console.error("❌ Error writing security audit log:", err.message);
  }
};

/**
 * GDPR Right to Access: Export all personal data.
 */
export const exportUserData = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(400).json({ error: "Invalid user token session." });
    }

    // 1. Fetch user account metadata
    const userRes = await pool.query(
      "SELECT id, email, status, created_at FROM users WHERE id = $1",
      [userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User account not found." });
    }
    const user = userRes.rows[0];

    // 2. Fetch profile data
    const profileRes = await pool.query(
      "SELECT id, first_name, last_name, username, about_me, profession, image_url, created_at, updated_at FROM profiles WHERE user_id = $1",
      [userId]
    );
    const profile = profileRes.rows[0] || null;

    // 3. Fetch digital twin state
    const twinRes = await pool.query(
      "SELECT id, twin_data, current_state_summary, updated_at FROM digital_twins WHERE user_id = $1",
      [userId]
    );
    const digitalTwin = twinRes.rows[0] || null;

    // 4. Fetch handshake sessions
    const handshakesRes = await pool.query(
      "SELECT id, user_a_id, user_b_id, status, compatibility_markers, risk_flags, handshake_summary, created_at FROM handshake_sessions WHERE user_a_id = $1 OR user_b_id = $1",
      [userId]
    );
    const handshakeSessions = handshakesRes.rows;

    // 5. Fetch messages
    const messagesRes = await pool.query(
      "SELECT id, sender_id, receiver_id, content, attachment_url, is_read, created_at FROM messages WHERE sender_id = $1 OR receiver_id = $1 ORDER BY created_at ASC",
      [userId]
    );
    const messages = messagesRes.rows;

    // 6. Fetch notification preferences / list
    const notificationsRes = await pool.query(
      "SELECT id, title, message, type, is_read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
      [userId]
    );
    const notifications = notificationsRes.rows;

    // Aggregate everything
    const personalDataArchive = {
      export_info: {
        platform: "Intentional Connection",
        export_date: new Date().toISOString(),
        gdpr_compliance: "UK GDPR / Data Protection Act 2018",
      },
      account: user,
      profile,
      digital_twin: digitalTwin,
      handshake_sessions: handshakeSessions,
      messages,
      notifications,
    };

    // Log the audit event
    await logAuditEvent(userId, "DATA_EXPORT", "User requested and downloaded complete personal data export.", req);

    // Send as JSON file download
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=intentional_connection_export_${userId}.json`);
    return res.status(200).json(personalDataArchive);
  } catch (error) {
    console.error("❌ GDPR Export error:", error);
    return res.status(500).json({ error: "Failed to export personal data. Please try again later." });
  }
};

/**
 * GDPR Right to Erasure: Permanent Account Deletion.
 */
export const deleteAccountPermanently = async (req, res) => {
  try {
    const userId = req.user.id;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: "Password verification is required to delete your account." });
    }

    // 1. Fetch user credentials
    const userRes = await pool.query(
      "SELECT password FROM users WHERE id = $1",
      [userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User account not found." });
    }
    const user = userRes.rows[0];

    // 2. Validate password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Incorrect password. Deletion aborted." });
    }

    console.log(`🧹 Starting erasure workflow for user ${userId}...`);

    // 3. Collect media references to delete from Supabase storage
    // Fetch profile picture
    const profilePicRes = await pool.query(
      "SELECT image_url FROM profiles WHERE user_id = $1",
      [userId]
    );
    const profilePic = profilePicRes.rows[0]?.image_url;
    if (profilePic) {
      await deleteFromSupabase(profilePic, "user_uploads");
    }

    // Fetch message attachments
    const attachmentsRes = await pool.query(
      "SELECT attachment_url FROM messages WHERE sender_id = $1 AND attachment_url IS NOT NULL",
      [userId]
    );
    for (const row of attachmentsRes.rows) {
      if (row.attachment_url) {
        await deleteFromSupabase(row.attachment_url, "user_uploads");
      }
    }

    // 4. (Vector data deleted automatically via DB cascade when user row is removed)

    // 5. Log audit event before deletion (User ID is referenced, will set to NULL on delete)
    await logAuditEvent(userId, "ACCOUNT_ERASURE", `Permanent account deletion executed for user ID: ${userId}`, req);

    // 6. Delete user from relational database (Cascades will clear profiles, messages, twins, etc.)
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);

    console.log(`✅ Erasure workflow completed successfully for user ${userId}.`);

    return res.status(200).json({
      message: "Your account and all associated personal data have been permanently deleted in accordance with UK GDPR."
    });
  } catch (error) {
    console.error("❌ GDPR Deletion error:", error);
    return res.status(500).json({ error: "Failed to delete account. Please try again later." });
  }
};

/**
 * GDPR Consent: Logs consent setting updates.
 */
export const updateConsentStatus = async (req, res) => {
  try {
    const userId = req.user?.id || null; // Optional if guest visitor
    const { consentDetails } = req.body;

    if (!consentDetails) {
      return res.status(400).json({ error: "Consent details are required." });
    }

    await logAuditEvent(
      userId,
      "CONSENT_CHANGE",
      `User updated privacy consent settings: ${JSON.stringify(consentDetails)}`,
      req
    );

    return res.status(200).json({ status: "success", message: "Consent preferences logged successfully." });
  } catch (error) {
    console.error("❌ GDPR Consent error:", error);
    return res.status(500).json({ error: "Failed to log consent status." });
  }
};
