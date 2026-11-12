import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import { clearAuthCookies, setAuthCookies } from "../utils/cookieHelper.js";
import { deleteFromSupabase } from "../utils/supabaseUpload.js";
import {
  ACCOUNT_DELETED_CODE,
  ACCOUNT_DELETED_RESTORABLE_CODE,
  bannedSql,
} from "../utils/banRules.js";

// Soft account deletion. A user's "delete" only sets users.deleted_at; the data
// stays until an admin erases it (eraseAccount). The user can restore the
// account, or archive it and start fresh, by proving the email with a code.
// What erase keeps and removes follows ACCOUNT_DELETION_DATA_RETENTION.md.

export const ERASE_DEADLINE_DAYS = Number(process.env.ACCOUNT_ERASE_DEADLINE_DAYS) || 28;
export const CODE_PURPOSES = ["delete", "restore", "start_fresh"];

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;

// Lazy imports: server.js imports this module indirectly (middleware), and
// sendEmail builds its client at load time.
const getIo = async () => (await import("../server.js")).io;
const getSendEmail = async () => (await import("./sendEmail.js")).sendEmail;
const getCloudinary = async () => (await import("../config/cloudinaryConfig.js")).default;

const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

export class AccountDeletionError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ─── Small helpers ───────────────────────────────────────────────────────────

const hashCode = (userId, code) =>
  crypto.createHash("sha256").update(`${userId}:${code}`).digest("hex");

/** HMAC of a normalized email, used to block banned users from signing up again. */
export const hashEmail = (email) => {
  const secret = process.env.EMAIL_HASH_SECRET;
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(String(email).trim().toLowerCase()).digest("hex");
};

export const maskEmail = (email) => {
  const [name, domain] = String(email).split("@");
  if (!domain) return "***";
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"*".repeat(Math.max(name.length - visible.length, 3))}@${domain}`;
};

const emailShell = (title, bodyHtml) => `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#FF2A6D 0%,#ff6b9d 100%);padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">Intentional Connection</h1>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <h2 style="margin:0 0 12px;font-size:20px;color:#1a1a2e;">${title}</h2>
          ${bodyHtml}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const CODE_COPY = {
  delete: { subject: "Confirm your account deletion", lead: "Use this code to confirm you want to delete your account." },
  restore: { subject: "Restore your account", lead: "Use this code to restore your deleted account." },
  start_fresh: { subject: "Start a new account", lead: "Use this code to set your old account aside and start a new one." },
};

const sendSafeEmail = async (to, subject, html) => {
  try {
    const sendEmail = await getSendEmail();
    await sendEmail({ to, subject, html });
  } catch (err) {
    console.error(`❌ [AccountDeletion] Email "${subject}" failed:`, err.message);
  }
};

const ageBand = (age) => {
  if (!Number.isFinite(age) || age < 18) return null;
  if (age >= 60) return "60+";
  const start = Math.floor(age / 5) * 5;
  return `${start}-${start + 4}`;
};

const countBand = (n) => {
  if (n === 0) return "0";
  if (n <= 10) return "1-10";
  if (n <= 100) return "11-100";
  return "100+";
};

const tenureBand = (createdAt, deletedAt) => {
  const months = (new Date(deletedAt) - new Date(createdAt)) / (30 * 24 * 60 * 60 * 1000);
  if (months < 1) return "<1m";
  if (months < 3) return "1-3m";
  if (months < 6) return "3-6m";
  if (months < 12) return "6-12m";
  return "12m+";
};

// ─── Lookups and responses ───────────────────────────────────────────────────

/** Returns { deleted_at } when the user is soft-deleted, else null. */
export const getDeletionState = async (userId) => {
  const { rows } = await pool.query(
    `SELECT deleted_at FROM users WHERE id = $1 AND deleted_at IS NOT NULL`,
    [userId],
  );
  return rows[0] || null;
};

/** Clears the auth cookies and sends the 403 for a session of a deleted account. */
export const deletedResponse = (res) => {
  clearAuthCookies(res);
  return res.status(403).json({
    code: ACCOUNT_DELETED_CODE,
    error: "This account has been deleted.",
  });
};

/** A deleted account that can still be restored or archived (not archived, not erased). */
export const findRestorableByEmail = async (email) => {
  const { rows } = await pool.query(
    `SELECT id, email, deleted_was_banned FROM users
     WHERE LOWER(email) = LOWER($1)
       AND deleted_at IS NOT NULL AND archived_at IS NULL AND purged_at IS NULL`,
    [String(email || "").trim()],
  );
  return rows[0] || null;
};

/**
 * 409 that sends the frontend to the "restore or start fresh" screen.
 * `revealEmail` only after the caller proved the account (password or OAuth),
 * since Google/LinkedIn flows don't otherwise know which email to send a code to.
 */
export const restorableResponse = (res, account, { revealEmail = false } = {}) => {
  clearAuthCookies(res);
  return res.status(409).json({
    code: ACCOUNT_DELETED_RESTORABLE_CODE,
    error: "This account was deleted. You can restore it or start fresh.",
    email_masked: maskEmail(account.email),
    ...(revealEmail && { email: account.email }),
    can_start_fresh: !account.deleted_was_banned,
  });
};

/** True when sign-up must be refused because the email belongs to an erased banned account. */
export const isSignupBlocked = async (email) => {
  const hash = hashEmail(email);
  if (!hash) return false;
  const { rowCount } = await pool.query(`SELECT 1 FROM blocked_signup_emails WHERE email_hash = $1`, [hash]);
  return rowCount > 0;
};

/** Signs the slim JWT pair and sets the auth cookies, exactly like login. */
export const issueSession = (res, user) => {
  const payload = { id: user.id, email: user.email, status: user.status };
  const accessToken = jwt.sign(payload, process.env.ACCESS_SECRET_KEY, { expiresIn: "30m" });
  const refreshToken = jwt.sign(payload, process.env.REFRESH_SECRET_KEY, { expiresIn: "7d" });
  setAuthCookies(res, accessToken, refreshToken);
};

// ─── Verification codes ──────────────────────────────────────────────────────

/** Emails a 6-digit code for `purpose`. At most one code per minute per user and purpose. */
export const sendVerificationCode = async (userId, email, purpose) => {
  const recent = await pool.query(
    `SELECT 1 FROM account_verification_codes
     WHERE user_id = $1 AND purpose = $2 AND created_at > NOW() - ($3 || ' milliseconds')::interval`,
    [userId, purpose, String(CODE_RESEND_MS)],
  );
  if (recent.rowCount > 0) {
    throw new AccountDeletionError("Please wait a minute before requesting another code.", 429);
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  // A new code replaces any unused older one
  await pool.query(
    `UPDATE account_verification_codes SET consumed_at = NOW()
     WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose],
  );
  await pool.query(
    `INSERT INTO account_verification_codes (user_id, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' milliseconds')::interval)`,
    [userId, purpose, hashCode(userId, code), String(CODE_TTL_MS)],
  );

  const copy = CODE_COPY[purpose];
  await sendSafeEmail(
    email,
    copy.subject,
    emailShell(
      copy.subject,
      `<p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;">${copy.lead} It expires in <strong>10 minutes</strong>.</p>
       <p style="margin:0 0 24px;font-size:32px;font-weight:800;letter-spacing:8px;color:#1a1a2e;text-align:center;">${code}</p>
       <p style="margin:0;font-size:13px;color:#888;">If you didn't ask for this, you can ignore this email.</p>`,
    ),
  );
};

/** Checks and consumes a code. Five wrong guesses kill the code. Throws on failure. */
export const verifyCode = async (userId, purpose, code) => {
  const { rows } = await pool.query(
    `SELECT id, code_hash, attempts, expires_at FROM account_verification_codes
     WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose],
  );
  const row = rows[0];
  if (!row || new Date(row.expires_at) < new Date() || row.attempts >= CODE_MAX_ATTEMPTS) {
    throw new AccountDeletionError("This code has expired. Please request a new one.", 400);
  }

  const expected = Buffer.from(row.code_hash, "hex");
  const given = Buffer.from(hashCode(userId, String(code || "").trim()), "hex");
  if (!crypto.timingSafeEqual(expected, given)) {
    await pool.query(`UPDATE account_verification_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    throw new AccountDeletionError("Incorrect code.", 400);
  }

  await pool.query(`UPDATE account_verification_codes SET consumed_at = NOW() WHERE id = $1`, [row.id]);
};

// ─── Delete / restore / archive ──────────────────────────────────────────────

/** Marks the account deleted, logs it out everywhere and emails a confirmation. */
export const softDeleteAccount = async (userId, req = null) => {
  const { rows } = await pool.query(
    `UPDATE users u SET
       deleted_at = NOW(),
       erase_due_at = NOW() + ($2 || ' days')::interval,
       deleted_was_banned = ${bannedSql("u")},
       updated_at = NOW()
     WHERE u.id = $1 AND u.deleted_at IS NULL
     RETURNING u.email, u.erase_due_at`,
    [userId, String(ERASE_DEADLINE_DAYS)],
  );
  if (!rows[0]) throw new AccountDeletionError("Account not found or already deleted.", 404);

  await logAuditEvent(userId, "ACCOUNT_DELETION_REQUESTED", "User deleted their account (soft delete).", req);

  try {
    const io = await getIo();
    const room = String(userId);
    io.to(room).emit("account_deleted", { code: ACCOUNT_DELETED_CODE });
    io.in(room).disconnectSockets(true);
  } catch (err) {
    console.error(`❌ [AccountDeletion] Socket logout failed for user ${userId}:`, err.message);
  }

  sendSafeEmail(
    rows[0].email,
    "Your account has been deleted",
    emailShell(
      "Your account has been deleted",
      `<p style="margin:0 0 16px;font-size:15px;color:#555;line-height:1.6;">Your profile is now hidden and you have been signed out.</p>
       <p style="margin:0;font-size:15px;color:#555;line-height:1.6;">Changed your mind? Sign up or log in with this email address to restore your account.</p>`,
    ),
  );
};

/** Brings a deleted (not archived, not erased) account back. Ban status is untouched. */
export const restoreAccount = async (userId, { adminId = null, req = null } = {}) => {
  const { rows } = await pool.query(
    `UPDATE users SET deleted_at = NULL, erase_due_at = NULL, deleted_was_banned = FALSE, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NOT NULL AND archived_at IS NULL AND purged_at IS NULL
     RETURNING id, email, status`,
    [userId],
  );
  const user = rows[0];
  if (!user) throw new AccountDeletionError("This account can't be restored.", 409);

  await logAuditEvent(
    adminId ? null : userId,
    "ACCOUNT_RESTORED",
    { user_id: userId, by: adminId ? "admin" : "user", admin_id: adminId },
    req,
  );

  if (adminId) {
    sendSafeEmail(
      user.email,
      "Your account has been restored",
      emailShell(
        "Your account has been restored",
        `<p style="margin:0;font-size:15px;color:#555;line-height:1.6;">Our team has restored your account. You can log in again as usual.</p>`,
      ),
    );
  }
  return user;
};

/**
 * "Start fresh": frees the email for a new sign-up. The old row keeps all its
 * data and stays in the admin erase queue with its original deadline.
 */
export const archiveForFreshStart = async (userId, req = null) => {
  const placeholderPassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  const { rows } = await pool.query(
    `UPDATE users SET
       email = 'archived-' || id || '@deleted.invalid',
       password = $2,
       archived_at = NOW(),
       updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NOT NULL AND archived_at IS NULL AND purged_at IS NULL
       AND deleted_was_banned = FALSE
     RETURNING id`,
    [userId, placeholderPassword],
  );
  if (!rows[0]) throw new AccountDeletionError("This account can't be set aside.", 409);
  await logAuditEvent(null, "ACCOUNT_ARCHIVED_FOR_FRESH_START", { user_id: userId }, req);
};

// ─── Admin erase ─────────────────────────────────────────────────────────────

// Optional tables: not every environment has them yet (manual migrations).
const OPTIONAL_TABLES = [
  "digital_twins", "ai_agent_config", "refined_query_sessions", "profile_compatibilities",
  "handshake_sessions", "trust_history", "cart", "alerts", "message_moderation_flags",
  "user_bans", "user_chat_mutes", "ghosting_alerts", "contact_messages",
  "newsletter_subscriptions", "user_plans",
];

const existingTables = async (client) => {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [OPTIONAL_TABLES],
  );
  return new Set(rows.map((r) => r.table_name));
};

const snapshotStats = async (client, userId) => {
  const { rows } = await client.query(
    `SELECT u.created_at, u.deleted_at, p.gender::text AS gender, p.age, p.dob, p.country,
            p.marital_status::text AS marital_status, p.education::text AS education,
            p.relationship_goal::text AS relationship_goal, p.interested_in::text AS interested_in,
            p.religious_belief::text AS religious_belief,
            (SELECT COUNT(*)::int FROM messages m WHERE m.sender_id = u.id) AS messages,
            (SELECT COUNT(*)::int FROM handshake_sessions h WHERE h.user_a_id = u.id OR h.user_b_id = u.id) AS handshakes,
            (SELECT pl.name FROM user_plans up JOIN plans pl ON pl.id = up.plan_id
              WHERE up.user_id = u.id ORDER BY up.created_at DESC LIMIT 1) AS plan_name
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  );
  const s = rows[0];
  if (!s) return;

  const age = s.age ?? (s.dob ? Math.floor((Date.now() - new Date(s.dob)) / (365.25 * 24 * 60 * 60 * 1000)) : null);
  await client.query(
    `INSERT INTO deletion_stats (gender, age_band, country, plan_name, signup_month, deletion_month,
                                 tenure_band, messages_band, handshakes_band)
     VALUES ($1, $2, $3, $4, date_trunc('month', $5::timestamptz)::date, date_trunc('month', $6::timestamptz)::date, $7, $8, $9)`,
    [
      s.gender, ageBand(age), s.country, s.plan_name, s.created_at, s.deleted_at,
      tenureBand(s.created_at, s.deleted_at), countBand(s.messages), countBand(s.handshakes),
    ],
  );

  // Sensitive or identifying-in-combination attributes: monthly totals only
  const monthly = ["marital_status", "education", "relationship_goal", "interested_in", "religious_belief"];
  for (const attribute of monthly) {
    if (!s[attribute]) continue;
    await client.query(
      `INSERT INTO deletion_stats_monthly (month, attribute, value, count)
       VALUES (date_trunc('month', $1::timestamptz)::date, $2, $3, 1)
       ON CONFLICT (month, attribute, value) DO UPDATE SET count = deletion_stats_monthly.count + 1`,
      [s.deleted_at, attribute, s[attribute]],
    );
  }
};

const deleteMediaFiles = async (urls) => {
  for (const url of urls) {
    if (!url) continue;
    try {
      if (url.includes("supabase.co")) {
        await deleteFromSupabase(url, "user_uploads");
      } else if (url.includes("cloudinary.com")) {
        // .../upload/v123/folder/name.ext → folder/name
        const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i);
        if (match) {
          const cloudinary = await getCloudinary();
          await cloudinary.uploader.destroy(match[1]);
        }
      }
    } catch (err) {
      console.error(`❌ [AccountDeletion] File delete failed (${url}):`, err.message);
    }
  }
};

/**
 * Admin-only permanent erasure, following ACCOUNT_DELETION_DATA_RETENTION.md:
 * personal data and content are removed; payments, subscriptions, plans, ban
 * records and security logs stay on an anonymised users row.
 */
export const eraseAccount = async (userId, adminId, req = null) => {
  const files = [];

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, email, archived_at, deleted_was_banned FROM users
       WHERE id = $1 AND deleted_at IS NOT NULL AND purged_at IS NULL
       FOR UPDATE`,
      [userId],
    );
    const user = rows[0];
    if (!user) throw new AccountDeletionError("Only deleted accounts that are not yet erased can be erased.", 409);

    const tables = await existingTables(client);
    const has = (t) => tables.has(t);

    // Ban evasion block, before the email is overwritten
    if (user.deleted_was_banned) {
      const hash = hashEmail(user.email);
      if (!hash) throw new AccountDeletionError("EMAIL_HASH_SECRET is not set; can't erase a banned account safely.", 500);
      await client.query(
        `INSERT INTO blocked_signup_emails (email_hash, reason) VALUES ($1, 'banned_at_deletion')
         ON CONFLICT (email_hash) DO NOTHING`,
        [hash],
      );
    }

    await snapshotStats(client, userId);

    // Files are removed only after the commit
    const media = await client.query(
      `SELECT image_url AS url FROM profiles WHERE user_id = $1 AND image_url IS NOT NULL
       UNION ALL
       SELECT attachment_url FROM messages
       WHERE (sender_id = $1 OR receiver_id = $1) AND attachment_url IS NOT NULL`,
      [userId],
    );
    files.push(...media.rows.map((r) => r.url));

    const sanctioned =
      user.deleted_was_banned ||
      (has("user_bans") && (await client.query(`SELECT 1 FROM user_bans WHERE user_id = $1 LIMIT 1`, [userId])).rowCount > 0) ||
      (has("user_chat_mutes") && (await client.query(`SELECT 1 FROM user_chat_mutes WHERE user_id = $1 LIMIT 1`, [userId])).rowCount > 0);

    // Content and AI data
    await client.query(`DELETE FROM messages WHERE sender_id = $1 OR receiver_id = $1`, [userId]);
    await client.query(`DELETE FROM reactions WHERE user_id = $1`, [userId]);
    // Notifications they caused can carry their name in the text, so those go too
    await client.query(`DELETE FROM notifications WHERE user_id = $1 OR sender_id = $1`, [userId]);
    if (has("digital_twins")) await client.query(`DELETE FROM digital_twins WHERE user_id = $1`, [userId]);
    if (has("ai_agent_config")) await client.query(`DELETE FROM ai_agent_config WHERE user_id = $1`, [userId]);
    if (has("refined_query_sessions")) await client.query(`DELETE FROM refined_query_sessions WHERE user_id = $1`, [userId]);
    if (has("profile_compatibilities")) {
      await client.query(`DELETE FROM profile_compatibilities WHERE user_a_id = $1 OR user_b_id = $1`, [userId]);
    }
    if (has("trust_history")) await client.query(`DELETE FROM trust_history WHERE user_id = $1`, [userId]);
    if (has("handshake_sessions")) {
      await client.query(`DELETE FROM handshake_sessions WHERE user_a_id = $1 OR user_b_id = $1`, [userId]);
    }
    if (has("ghosting_alerts")) {
      await client.query(`DELETE FROM ghosting_alerts WHERE user_id = $1 OR partner_id = $1`, [userId]);
    }
    if (has("cart")) await client.query(`DELETE FROM cart WHERE user_id = $1`, [userId]);
    if (has("user_plans")) {
      await client.query(
        `UPDATE user_plans SET last_search_signature = NULL, last_search_at = NULL WHERE user_id = $1`,
        [userId],
      );
    }
    await client.query(`DELETE FROM account_verification_codes WHERE user_id = $1`, [userId]);

    // Moderation records are kept only as evidence for a sanction
    if (has("message_moderation_flags")) {
      if (sanctioned) {
        await client.query(
          `DELETE FROM message_moderation_flags WHERE sender_id = $1 AND status = 'dismissed'`,
          [userId],
        );
      } else {
        await client.query(`DELETE FROM message_moderation_flags WHERE sender_id = $1`, [userId]);
      }
    }
    if (has("alerts") && !sanctioned) {
      await client.query(`DELETE FROM alerts WHERE user_id = $1`, [String(userId)]);
    }

    // Records keyed by email. An archived account's email now belongs to the new account.
    if (!user.archived_at) {
      if (has("contact_messages")) await client.query(`DELETE FROM contact_messages WHERE LOWER(email) = LOWER($1)`, [user.email]);
      if (has("newsletter_subscriptions")) {
        await client.query(`DELETE FROM newsletter_subscriptions WHERE LOWER(email) = LOWER($1)`, [user.email]);
      }
    }

    // Profile (cascades to profile_prompts, profile_views, addresses)
    try {
      await client.query(`DELETE FROM profiles WHERE user_id = $1`, [userId]);
    } catch (err) {
      if (err.code === "23503") {
        throw new AccountDeletionError(
          "Profile is still referenced by payments. Apply migrations/repoint_payments_fk_to_users.sql first.",
          500,
        );
      }
      throw err;
    }

    // Tombstone: no personal data left on the users row
    const placeholderPassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
    await client.query(
      `UPDATE users SET
         email = 'erased-' || id || '@deleted.invalid',
         password = $2,
         auth_provider = NULL,
         is_email_verified = DEFAULT,
         is_profile_completed = DEFAULT,
         last_seen = NULL,
         trust_score = DEFAULT,
         reason = CASE WHEN deleted_was_banned THEN reason ELSE NULL END,
         purged_at = NOW(),
         purged_by = $3,
         updated_at = NOW()
       WHERE id = $1`,
      [userId, placeholderPassword, adminId],
    );
  });

  await deleteMediaFiles(files);
  await logAuditEvent(null, "ACCOUNT_ERASED", { user_id: userId, admin_id: adminId }, req);
};

// ─── Admin queue ─────────────────────────────────────────────────────────────

/** Deleted accounts waiting for an admin to erase them, most urgent first. */
export const listPendingErasure = async () => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.deleted_at, u.erase_due_at, u.archived_at, u.deleted_was_banned,
            p.first_name, p.last_name, p.username,
            CEIL(EXTRACT(EPOCH FROM (u.erase_due_at - NOW())) / 86400)::int AS days_left
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.deleted_at IS NOT NULL AND u.purged_at IS NULL
     ORDER BY u.erase_due_at ASC`,
  );
  return rows;
};
