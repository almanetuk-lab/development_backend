import { pool } from "../config/db.js";
import { io, sendNotification } from "../server.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import { buildListEnvelope } from "../utils/pagination.js";
import { activeMuteSql, activeStrikeSql } from "../utils/moderationRules.js";
import { getActiveMute, liftMute, notifyUnmuted } from "../services/autoModerationService.js";

const REMOVED_CONTENT = "[Removed by moderator]";

// security_audit_logs.user_id references users(id), so admin actions are logged
// with a null user and the admin id carried in details.
const auditAdminAction = (req, action, details) =>
  logAuditEvent(null, action, { admin_id: req.admin?.id ?? null, ...details }, req);

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

/**
 * Moves a flag out of 'pending'. Conditional on status so two admins acting on
 * the same flag cannot both succeed — the loser gets 404/409.
 */
const transitionFlag = async (client, { id, status, adminId, note }) => {
  const { rows } = await client.query(
    `UPDATE message_moderation_flags
     SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_note = $3
     WHERE id = $4 AND status = 'pending'
     RETURNING *`,
    [status, adminId, note || null, id],
  );
  if (rows.length) return { flag: rows[0] };

  const existing = await client.query(
    `SELECT status FROM message_moderation_flags WHERE id = $1`,
    [id],
  );
  if (!existing.rows.length) {
    return { error: { code: 404, body: { status: "error", message: "Flagged message not found" } } };
  }
  return {
    error: {
      code: 409,
      body: {
        status: "error",
        message: `This alert was already handled (${existing.rows[0].status}).`,
        current_status: existing.rows[0].status,
      },
    },
  };
};

const emitResolved = (flag) => {
  io.to("admins").emit("abuse_alert_resolved", { id: flag.id, status: flag.status });
};

// ---------------- List Flagged Messages ----------------
export const getFlaggedMessages = async (req, res) => {
  try {
    const { status, page, limit } = req.validatedQuery;
    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM message_moderation_flags WHERE ($1 = 'all' OR status = $1)`,
      [status],
    );

    const { rows } = await pool.query(
      `
      SELECT
        f.*,
        (f.message_id IS NOT NULL) AS message_exists,
        NULLIF(TRIM(CONCAT(sp.first_name, ' ', sp.last_name)), '') AS sender_name,
        NULLIF(TRIM(CONCAT(rp.first_name, ' ', rp.last_name)), '') AS receiver_name,
        su.email AS sender_email,
        su.status AS sender_status,
        a.full_name AS reviewed_by_name,
        (
          SELECT COUNT(*)::int FROM message_moderation_flags w
          WHERE w.sender_id = f.sender_id AND w.status = 'warned'
        ) AS warning_count,
        (
          SELECT COUNT(*)::int FROM message_moderation_flags st
          WHERE st.sender_id = f.sender_id AND ${activeStrikeSql("st")}
        ) AS active_strikes,
        (
          SELECT MAX(m.muted_until) FROM user_chat_mutes m
          WHERE m.user_id = f.sender_id AND ${activeMuteSql("m")}
        ) AS sender_muted_until
      FROM message_moderation_flags f
      LEFT JOIN profiles sp ON sp.user_id = f.sender_id
      LEFT JOIN profiles rp ON rp.user_id = f.receiver_id
      LEFT JOIN users su ON su.id = f.sender_id
      LEFT JOIN admins a ON a.id = f.reviewed_by
      WHERE ($1 = 'all' OR f.status = $1)
      ORDER BY f.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [status, limit, offset],
    );

    return res.status(200).json(
      buildListEnvelope({
        rows,
        page,
        limit,
        totalCount: countResult.rows[0].total,
        filters: { status },
      }),
    );
  } catch (error) {
    console.error("Admin get flagged messages error:", error);
    return res.status(500).json({ status: "error", message: "Failed to fetch flagged messages" });
  }
};

// ---------------- Pending Count (sidebar badge) ----------------
export const getFlaggedCount = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS pending FROM message_moderation_flags WHERE status = 'pending'`,
    );
    return res.status(200).json({ pending: rows[0].pending });
  } catch (error) {
    console.error("Admin get flagged count error:", error);
    return res.status(500).json({ status: "error", message: "Failed to fetch flagged count" });
  }
};

// ---------------- Dismiss ----------------
export const dismissFlag = async (req, res) => {
  try {
    const { id } = req.params;
    const note = req.body?.note;

    const result = await withTransaction(async (client) => {
      const t = await transitionFlag(client, { id, status: "dismissed", adminId: req.admin.id, note });
      if (t.error) return t;
      if (t.flag.message_id) {
        await client.query(`UPDATE messages SET is_flagged = FALSE WHERE id = $1`, [t.flag.message_id]);
      }
      // A dismissed strike stops counting; lift the auto-mute it caused, if still running.
      if (t.flag.is_strike) {
        const { rows } = await client.query(
          `SELECT id FROM user_chat_mutes m WHERE m.source_flag_id = $1 AND ${activeMuteSql("m")}`,
          [t.flag.id],
        );
        for (const row of rows) {
          t.liftedMute = await liftMute(row.id, { adminId: req.admin.id, reason: "flag_dismissed", note }, client);
        }
      }
      return t;
    });
    if (result.error) return res.status(result.error.code).json(result.error.body);

    auditAdminAction(req, "MODERATION_DISMISS", { flag_id: result.flag.id, message_id: result.flag.message_id, target_user_id: result.flag.sender_id, lifted_mute_id: result.liftedMute?.id ?? null });
    emitResolved(result.flag);
    if (result.liftedMute) {
      notifyUnmuted(result.flag.sender_id).catch((err) => console.error("❌ Failed to notify unmute:", err.message));
    }

    return res.status(200).json({ status: "success", message: "Alert dismissed", flag: result.flag });
  } catch (error) {
    console.error("Admin dismiss flag error:", error);
    return res.status(500).json({ status: "error", message: "Failed to dismiss alert" });
  }
};

// ---------------- Warn Sender ----------------
export const warnFlag = async (req, res) => {
  try {
    const { id } = req.params;
    const note = req.body?.note;

    const flagResult = await pool.query(
      `SELECT is_ai_generated FROM message_moderation_flags WHERE id = $1`,
      [id],
    );
    if (!flagResult.rows.length) {
      return res.status(404).json({ status: "error", message: "Flagged message not found" });
    }
    // The user didn't write an AI-agent message, so they can't be warned for it.
    if (flagResult.rows[0].is_ai_generated) {
      return res.status(400).json({
        status: "error",
        message: "This message was written by the user's AI agent, so the user cannot be warned for it.",
      });
    }

    const result = await withTransaction((client) =>
      transitionFlag(client, { id, status: "warned", adminId: req.admin.id, note }),
    );
    if (result.error) return res.status(result.error.code).json(result.error.body);
    const { flag } = result;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS warnings FROM message_moderation_flags WHERE sender_id = $1 AND status = 'warned'`,
      [flag.sender_id],
    );
    const warningCount = countResult.rows[0].warnings;

    await sendNotification(
      flag.sender_id,
      "Community Guidelines Warning",
      `One of your messages was flagged for violating our community guidelines. This is warning #${warningCount}. ` +
        `Repeated violations may lead to your account being deactivated.` +
        (note ? ` Moderator note: ${note}` : ""),
    );

    auditAdminAction(req, "MODERATION_WARN", { flag_id: flag.id, message_id: flag.message_id, target_user_id: flag.sender_id, warning_count: warningCount });
    emitResolved(flag);

    return res.status(200).json({ status: "success", message: "User warned", flag, warning_count: warningCount });
  } catch (error) {
    console.error("Admin warn flag error:", error);
    return res.status(500).json({ status: "error", message: "Failed to warn user" });
  }
};

// ---------------- Delete (soft) ----------------
export const deleteFlaggedMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const note = req.body?.note;

    const result = await withTransaction(async (client) => {
      const t = await transitionFlag(client, { id, status: "deleted", adminId: req.admin.id, note });
      if (t.error) return t;
      // Message may already be gone if the sender deleted it; the flag keeps the snapshot.
      if (t.flag.message_id) {
        const upd = await client.query(
          `UPDATE messages SET content = $1, attachment_url = NULL WHERE id = $2 RETURNING id, sender_id, receiver_id, content`,
          [REMOVED_CONTENT, t.flag.message_id],
        );
        t.message = upd.rows[0] || null;
      }
      return t;
    });
    if (result.error) return res.status(result.error.code).json(result.error.body);
    const { flag, message } = result;

    if (message) {
      const payload = { id: message.id, content: message.content, attachment_url: null };
      io.to(String(message.sender_id)).emit("message_moderated", payload);
      io.to(String(message.receiver_id)).emit("message_moderated", payload);
    }

    auditAdminAction(req, "MODERATION_DELETE", { flag_id: flag.id, message_id: flag.message_id, target_user_id: flag.sender_id });
    emitResolved(flag);

    return res.status(200).json({ status: "success", message: "Message removed", flag });
  } catch (error) {
    console.error("Admin delete flagged message error:", error);
    return res.status(500).json({ status: "error", message: "Failed to remove message" });
  }
};

// ---------------- Unmute User ----------------
export const unmuteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const note = req.body?.note;

    const mute = await getActiveMute(id);
    if (!mute) {
      return res.status(404).json({ status: "error", message: "This user is not muted." });
    }
    const lifted = await liftMute(mute.id, { adminId: req.admin.id, reason: "admin", note });
    if (!lifted) {
      return res.status(409).json({ status: "error", message: "This mute has already ended." });
    }

    auditAdminAction(req, "MODERATION_UNMUTE", { mute_id: lifted.id, target_user_id: lifted.user_id });
    await notifyUnmuted(lifted.user_id);

    return res.status(200).json({ status: "success", message: "User unmuted", mute: lifted });
  } catch (error) {
    console.error("Admin unmute user error:", error);
    return res.status(500).json({ status: "error", message: "Failed to unmute user" });
  }
};
