import { pool } from "../config/db.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import { clearAuthCookies } from "../utils/cookieHelper.js";
import {
  BANNED_STATUS,
  computeBannedUntil,
  isBanActive,
  suspensionPayload,
} from "../utils/banRules.js";

// All account-ban logic lives here: ban, lift (reactivate / expire), lookups,
// force-logout and the ban emails. See utils/banRules.js for the "banned" rule.

const DEFAULT_RESTORE_STATUS = "Approve";

// Lazy imports: server.js imports this module indirectly (middleware), and
// sendEmail builds its client at load time.
const getIo = async () => (await import("../server.js")).io;
const getSendNotification = async () => (await import("../server.js")).sendNotification;
const getSendEmail = async () => (await import("./sendEmail.js")).sendEmail;

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

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatDate = (date) =>
  new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

// ─── Emails ──────────────────────────────────────────────────────────────────

const emailLayout = (title, bodyHtml) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#FF2A6D 0%,#ff6b9d 100%);padding:36px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Intentional Connection</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;font-weight:500;">Your mindful matchmaking platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#1a1a2e;">${title}</h2>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="background:#f9f9fb;border-top:1px solid #efefef;padding:24px 40px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:#aaa;">© ${new Date().getFullYear()} Intentional Connection. All rights reserved.</p>
              <p style="margin:0;font-size:12px;color:#bbb;">This is an automated email — please do not reply directly.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const button = (href, label) => `
  <table cellpadding="0" cellspacing="0" style="margin:0 auto 8px;">
    <tr>
      <td style="background:linear-gradient(135deg,#FF2A6D,#ff6b9d);border-radius:10px;">
        <a href="${href}" target="_blank"
           style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;

const paragraph = (html) =>
  `<p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;">${html}</p>`;

const banEmailHtml = ({ firstName, reason, bannedUntil }) => {
  const frontend = process.env.FRONTEND_URL || "";
  const duration = bannedUntil
    ? `You will be able to access your account again on <strong>${formatDate(bannedUntil)}</strong>.`
    : "This suspension is <strong>permanent</strong>.";
  return emailLayout(
    "Your account has been suspended",
    paragraph(`Hi ${escapeHtml(firstName || "there")},`) +
      paragraph("Your Intentional Connection account has been suspended for violating our community guidelines.") +
      `<div style="background:#fff5f8;border:1px solid #ffd6e4;border-radius:10px;padding:16px 20px;margin:0 0 20px;">
         <p style="margin:0;font-size:14px;color:#cc3366;line-height:1.6;"><strong>Reason:</strong> ${escapeHtml(reason)}</p>
       </div>` +
      paragraph(duration) +
      paragraph("If you believe this is a mistake, you can contact our team using the form below.") +
      button(`${frontend}/contact`, "Contact Us"),
  );
};

const reactivationEmailHtml = ({ firstName }) => {
  const frontend = process.env.FRONTEND_URL || "";
  return emailLayout(
    "Your account is active again",
    paragraph(`Hi ${escapeHtml(firstName || "there")},`) +
      paragraph("Your Intentional Connection account suspension has ended and you can log in again.") +
      paragraph("Please keep our community guidelines in mind so everyone can connect safely.") +
      button(`${frontend}/login`, "Log In"),
  );
};

const getContact = async (userId) => {
  const { rows } = await pool.query(
    `SELECT u.email, p.first_name FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  return rows[0] || null;
};

const sendBanEmail = async (userId, { reason, bannedUntil }) => {
  try {
    const contact = await getContact(userId);
    if (!contact?.email) return;
    const sendEmail = await getSendEmail();
    await sendEmail({
      to: contact.email,
      subject: "Your Intentional Connection account has been suspended",
      html: banEmailHtml({ firstName: contact.first_name, reason, bannedUntil }),
    });
  } catch (err) {
    console.error(`❌ [AccountBan] Ban email failed for user ${userId}:`, err.message);
  }
};

const sendReactivationEmail = async (userId) => {
  try {
    const contact = await getContact(userId);
    if (!contact?.email) return;
    const sendEmail = await getSendEmail();
    await sendEmail({
      to: contact.email,
      subject: "Your Intentional Connection account is active again",
      html: reactivationEmailHtml({ firstName: contact.first_name }),
    });
  } catch (err) {
    console.error(`❌ [AccountBan] Reactivation email failed for user ${userId}:`, err.message);
  }
};

// ─── Lookups ─────────────────────────────────────────────────────────────────

/**
 * Returns the user's active ban as { reason, banned_until, is_permanent }, or null.
 * An expired ban is lifted lazily (fire-and-forget) and reported as not banned.
 */
export const getActiveBan = async (userId) => {
  const { rows } = await pool.query(
    `SELECT status, reason, banned_until FROM users WHERE id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row || row.status !== BANNED_STATUS) return null;

  if (!isBanActive(row)) {
    liftBan(userId, { reason: "expired" }).catch((err) =>
      console.error(`❌ [AccountBan] Lazy lift failed for user ${userId}:`, err.message),
    );
    return null;
  }

  return {
    reason: row.reason,
    banned_until: row.banned_until,
    is_permanent: !row.banned_until,
  };
};

/** Clears the auth cookies and sends the standard 403 suspended response. */
export const suspendedResponse = (res, ban) => {
  clearAuthCookies(res);
  return res.status(403).json(suspensionPayload(ban));
};

/** Pushes account_suspended to every open tab/device of the user, then disconnects them. */
export const forceLogout = async (userId, ban) => {
  try {
    const io = await getIo();
    const room = String(userId);
    io.to(room).emit("account_suspended", suspensionPayload(ban));
    io.in(room).disconnectSockets(true);
  } catch (err) {
    console.error(`❌ [AccountBan] Force logout failed for user ${userId}:`, err.message);
  }
};

// ─── Ban / lift ──────────────────────────────────────────────────────────────

/**
 * Bans a user. Replaces any existing ban (the old one is closed as 'replaced').
 * @returns {Promise<{ id, status, reason, banned_until, is_permanent } | null>} null if the user doesn't exist
 */
export const banUser = async ({ userId, reason, durationDays, permanent, adminId = null, sourceFlagId = null, req = null }) => {
  const bannedUntil = computeBannedUntil({ durationDays, permanent });

  const user = await withTransaction(async (client) => {
    const current = await client.query(`SELECT id, status FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    if (!current.rows.length) return null;

    const closed = await client.query(
      `UPDATE user_bans
       SET lifted_at = NOW(), lifted_by = $2, lift_reason = 'replaced'
       WHERE user_id = $1 AND lifted_at IS NULL
       RETURNING previous_status`,
      [userId, adminId],
    );
    // Restore target: what the user was before their first (still-open) ban.
    const currentStatus = current.rows[0].status;
    const previousStatus =
      closed.rows[0]?.previous_status ||
      (currentStatus && currentStatus !== BANNED_STATUS ? currentStatus : DEFAULT_RESTORE_STATUS);

    await client.query(
      `INSERT INTO user_bans (user_id, reason, banned_by, banned_until, previous_status, source_flag_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, reason, adminId, bannedUntil, previousStatus, sourceFlagId],
    );

    const updated = await client.query(
      `UPDATE users
       SET status = $2, reason = $3, banned_until = $4, banned_at = NOW(), banned_by = $5, updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, reason, banned_until`,
      [userId, BANNED_STATUS, reason, bannedUntil, adminId],
    );
    return updated.rows[0];
  });
  if (!user) return null;

  await forceLogout(userId, user);

  const sendNotification = await getSendNotification();
  sendNotification(
    userId,
    "Account Suspended",
    bannedUntil
      ? `Your account has been suspended until ${formatDate(bannedUntil)}. Reason: ${reason}`
      : `Your account has been permanently suspended. Reason: ${reason}`,
  ).catch(() => {});
  sendBanEmail(userId, { reason, bannedUntil }).catch(() => {});

  logAuditEvent(
    null,
    "USER_BAN",
    {
      admin_id: adminId,
      target_user_id: userId,
      reason,
      banned_until: bannedUntil ? bannedUntil.toISOString() : null,
      permanent: !bannedUntil,
      source_flag_id: sourceFlagId,
    },
    req,
  );

  return { ...user, is_permanent: !user.banned_until };
};

/**
 * Lifts a user's ban. Race-safe: concurrent calls lift at most once.
 * @param {"expired"|"reactivated"} reason
 * @returns {Promise<{ id, status } | null>} null if the user was not banned (or, for 'expired', the ban hasn't ended)
 */
export const liftBan = async (userId, { reason, adminId = null, note = null, req = null }) => {
  const expiredOnly = reason === "expired";

  const user = await withTransaction(async (client) => {
    const current = await client.query(
      `SELECT status, banned_until FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const row = current.rows[0];
    if (!row || row.status !== BANNED_STATUS) return null;
    if (expiredOnly && isBanActive(row)) return null;

    const closed = await client.query(
      `UPDATE user_bans
       SET lifted_at = NOW(), lifted_by = $2, lift_reason = $3, lift_note = $4
       WHERE user_id = $1 AND lifted_at IS NULL
       RETURNING previous_status`,
      [userId, adminId, reason, note],
    );
    const previous = closed.rows[0]?.previous_status;
    const restoreStatus = previous && previous !== BANNED_STATUS ? previous : DEFAULT_RESTORE_STATUS;

    const updated = await client.query(
      `UPDATE users
       SET status = $2, reason = NULL, banned_until = NULL, banned_at = NULL, banned_by = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING id, status`,
      [userId, restoreStatus],
    );
    return updated.rows[0];
  });
  if (!user) return null;

  const sendNotification = await getSendNotification();
  sendNotification(
    userId,
    "Account Reactivated",
    "Your account suspension has ended. Welcome back — please keep our community guidelines in mind.",
  ).catch(() => {});
  sendReactivationEmail(userId).catch(() => {});

  logAuditEvent(
    null,
    expiredOnly ? "USER_BAN_EXPIRED" : "USER_REACTIVATE",
    { admin_id: adminId, target_user_id: userId, restored_status: user.status, note },
    req,
  );

  return user;
};

/** Lifts every ban whose end date has passed. Safe to run on several instances. */
export const liftExpiredBans = async () => {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM users
       WHERE status = $1 AND banned_until IS NOT NULL AND banned_until <= NOW()`,
      [BANNED_STATUS],
    );
    let lifted = 0;
    for (const { id } of rows) {
      try {
        if (await liftBan(id, { reason: "expired" })) lifted += 1;
      } catch (err) {
        console.error(`❌ [AccountBan] Failed to lift expired ban for user ${id}:`, err.message);
      }
    }
    if (lifted) console.log(`🔓 [AccountBan] Lifted ${lifted} expired ban(s).`);
    return lifted;
  } catch (err) {
    console.error("❌ [AccountBan] liftExpiredBans failed:", err.message);
    return 0;
  }
};

/** Current ban (with banning admin's name) and full ban history, for the admin user page. */
export const getBanDetails = async (userId) => {
  const [current, history] = await Promise.all([
    pool.query(
      `SELECT u.status, u.reason, u.banned_until, u.banned_at, u.banned_by, a.full_name AS banned_by_name
       FROM users u LEFT JOIN admins a ON a.id = u.banned_by
       WHERE u.id = $1`,
      [userId],
    ),
    pool.query(
      `SELECT b.*, ba.full_name AS banned_by_name, la.full_name AS lifted_by_name
       FROM user_bans b
       LEFT JOIN admins ba ON ba.id = b.banned_by
       LEFT JOIN admins la ON la.id = b.lifted_by
       WHERE b.user_id = $1
       ORDER BY b.banned_at DESC`,
      [userId],
    ),
  ]);
  const row = current.rows[0];
  const ban = isBanActive(row)
    ? {
        reason: row.reason,
        banned_at: row.banned_at,
        banned_until: row.banned_until,
        is_permanent: !row.banned_until,
        banned_by: row.banned_by,
        banned_by_name: row.banned_by_name,
      }
    : null;
  return { ban, ban_history: history.rows };
};
