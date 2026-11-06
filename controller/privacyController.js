import { pool } from "../config/db.js";
import bcrypt from "bcrypt";
import { clearAuthCookies } from "../utils/cookieHelper.js";
import {
  AccountDeletionError,
  sendVerificationCode,
  softDeleteAccount,
  verifyCode,
} from "../services/accountDeletionService.js";

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

// Accounts created through Google/LinkedIn have a random placeholder password
// the user never knew, so they confirm with an emailed code instead.
const usesEmailCode = (authProvider) => authProvider === "google" || authProvider === "linkedin";

const sendDeletionError = (res, error, fallback) => {
  if (error instanceof AccountDeletionError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(`❌ ${fallback}:`, error);
  return res.status(500).json({ error: `${fallback}. Please try again later.` });
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
 * Tells the settings page how this account confirms deletion: "password" or "code".
 */
export const getDeletionMethod = async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT auth_provider FROM users WHERE id = $1", [req.user.id]);
    if (!rows[0]) {
      return res.status(404).json({ error: "User account not found." });
    }
    return res.status(200).json({ method: usesEmailCode(rows[0].auth_provider) ? "code" : "password" });
  } catch (error) {
    return sendDeletionError(res, error, "Failed to load deletion settings");
  }
};

/**
 * Emails a deletion confirmation code. Only for Google/LinkedIn accounts.
 */
export const requestDeletionCode = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      "SELECT email, auth_provider FROM users WHERE id = $1 AND deleted_at IS NULL",
      [userId]
    );
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ error: "User account not found." });
    }
    if (!usesEmailCode(user.auth_provider)) {
      return res.status(400).json({ error: "Please confirm with your password instead." });
    }

    await sendVerificationCode(userId, user.email, "delete");
    return res.status(200).json({ message: "We've emailed you a 6-digit code." });
  } catch (error) {
    return sendDeletionError(res, error, "Failed to send the code");
  }
};

/**
 * Account deletion: marks the account deleted (soft delete). Nothing is erased
 * here — an admin erases deleted accounts from the admin panel.
 */
export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    const { password, code } = req.body;

    const { rows } = await pool.query(
      "SELECT password, auth_provider FROM users WHERE id = $1 AND deleted_at IS NULL",
      [userId]
    );
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ error: "User account not found." });
    }

    if (usesEmailCode(user.auth_provider)) {
      if (!code) {
        return res.status(400).json({ error: "Enter the code we emailed you." });
      }
      await verifyCode(userId, "delete", code);
    } else {
      if (!password) {
        return res.status(400).json({ error: "Password verification is required to delete your account." });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: "Incorrect password. Deletion aborted." });
      }
    }

    await softDeleteAccount(userId, req);
    clearAuthCookies(res);

    return res.status(200).json({
      message: "Your account has been deleted. Sign up or log in with the same email to restore it.",
    });
  } catch (error) {
    return sendDeletionError(res, error, "Failed to delete account");
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
