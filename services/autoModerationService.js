import { pool } from "../config/db.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import {
  STRIKE_WINDOW_DAYS,
  activeMuteSql,
  activeStrikeSql,
  computeMutedUntil,
  decideAutoAction,
} from "../utils/moderationRules.js";

// Automatic escalation for chat abuse: strikes → auto-warning → timed chat mute.
// A strike is a severe, human-written flag (see contentModerationService.recordFlag).
// The flag itself stays 'pending' so an admin still reviews it; dismissing it
// removes the strike and lifts any mute it caused. See utils/moderationRules.js.

// Lazy imports: server.js imports this module indirectly (controllers).
const getIo = async () => (await import("../server.js")).io;
const getSendNotification = async () => (await import("../server.js")).sendNotification;

const formatDateTime = (date) =>
  new Date(date).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

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

/** Active mute row for a user, or null. */
export const getActiveMute = async (userId, db = pool) => {
  const { rows } = await db.query(
    `SELECT * FROM user_chat_mutes m
     WHERE m.user_id = $1 AND ${activeMuteSql("m")}
     ORDER BY m.muted_until DESC
     LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
};

/** Number of active strikes for a user. */
export const countActiveStrikes = async (userId, db = pool) => {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS strikes FROM message_moderation_flags f
     WHERE f.sender_id = $1 AND ${activeStrikeSql("f")}`,
    [userId],
  );
  return rows[0].strikes;
};

/** Strike count, active mute and recent mute history for the admin user-details view. */
export const getModerationDetails = async (userId) => {
  const [strikes, mute, history] = await Promise.all([
    countActiveStrikes(userId),
    getActiveMute(userId),
    pool.query(
      `SELECT m.*, a.full_name AS lifted_by_name
       FROM user_chat_mutes m
       LEFT JOIN admins a ON a.id = m.lifted_by
       WHERE m.user_id = $1
       ORDER BY m.muted_at DESC
       LIMIT 10`,
      [userId],
    ),
  ]);
  return { active_strikes: strikes, active_mute: mute, mute_history: history.rows };
};

/**
 * Applies the escalation ladder for a new strike flag. Fire-and-forget from recordFlag;
 * never called for AI-generated or mild flags.
 * @returns {{ strike_count: number, auto_action: string|null, muted_until: string|null, needs_ban_review: boolean }}
 */
export const applyStrike = async (flag) => {
  const result = await withTransaction(async (client) => {
    // Serialize per sender so a burst of messages can't create several mutes.
    await client.query(`SELECT pg_advisory_xact_lock($1::int)`, [flag.sender_id]);

    const strikeCount = await countActiveStrikes(flag.sender_id, client);
    const decision = decideAutoAction(strikeCount);
    const out = { strike_count: strikeCount, auto_action: null, muted_until: null, needs_ban_review: !!decision.escalate, mute: null };

    if (decision.action === "warn") {
      out.auto_action = "warned";
    } else if (decision.action === "mute") {
      const mutedUntil = computeMutedUntil(decision.hours);
      const current = await getActiveMute(flag.sender_id, client);
      // Only a higher tier replaces a running mute; a same-tier strike (e.g. two messages
      // sent just before the mute landed) keeps the current one.
      const currentHours = current
        ? (new Date(current.muted_until) - new Date(current.muted_at)) / (60 * 60 * 1000)
        : 0;
      if (current && currentHours >= decision.hours - 0.01) {
        out.muted_until = new Date(current.muted_until).toISOString();
      } else {
        const { rows } = await client.query(
          `INSERT INTO user_chat_mutes (user_id, muted_until, strike_count, source_flag_id)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [flag.sender_id, mutedUntil, strikeCount, flag.id],
        );
        // A shorter mute that is still running is superseded by the new one.
        if (current) {
          await client.query(
            `UPDATE user_chat_mutes SET lifted_at = NOW(), lift_reason = 'replaced' WHERE id = $1`,
            [current.id],
          );
        }
        out.mute = rows[0];
        out.muted_until = mutedUntil.toISOString();
      }
      out.auto_action = "muted";
    }

    if (out.auto_action) {
      await client.query(`UPDATE message_moderation_flags SET auto_action = $1 WHERE id = $2`, [out.auto_action, flag.id]);
    }
    return out;
  });

  const sendNotification = await getSendNotification();
  if (result.auto_action === "warned") {
    const remaining = 3 - result.strike_count;
    await sendNotification(
      flag.sender_id,
      "Community Guidelines Warning",
      `One of your messages was automatically flagged for violating our community guidelines ` +
        `(strike ${result.strike_count} in the last ${STRIKE_WINDOW_DAYS} days). ` +
        (remaining > 0
          ? `${remaining === 1 ? "One more strike" : `${remaining} more strikes`} will temporarily stop you from sending messages.`
          : `Further violations will temporarily stop you from sending messages.`),
    );
    logAuditEvent(flag.sender_id, "AUTO_MODERATION_WARN", { flag_id: flag.id, strike_count: result.strike_count });
  } else if (result.mute) {
    await sendNotification(
      flag.sender_id,
      "Messaging Paused",
      `Because of repeated community guidelines violations (${result.strike_count} strikes in the last ` +
        `${STRIKE_WINDOW_DAYS} days), you can't send messages until ${formatDateTime(result.muted_until)}. ` +
        `You can still read your conversations.`,
    );
    const io = await getIo();
    io.to(String(flag.sender_id)).emit("chat_muted", { muted_until: result.muted_until });
    logAuditEvent(flag.sender_id, "AUTO_MODERATION_MUTE", {
      flag_id: flag.id,
      mute_id: result.mute.id,
      strike_count: result.strike_count,
      muted_until: result.muted_until,
      needs_ban_review: result.needs_ban_review,
    });
  }

  const { mute, ...summary } = result;
  return summary;
};

/**
 * Lifts an active mute. Works with a pool or a transaction client; call
 * notifyUnmuted after commit to tell the user.
 * @returns the lifted row, or null if it was not active.
 */
export const liftMute = async (muteId, { adminId = null, reason, note = null }, db = pool) => {
  const { rows } = await db.query(
    `UPDATE user_chat_mutes m
     SET lifted_at = NOW(), lifted_by = $2, lift_reason = $3, lift_note = $4
     WHERE m.id = $1 AND ${activeMuteSql("m")}
     RETURNING *`,
    [muteId, adminId, reason, note],
  );
  return rows[0] || null;
};

/** Notifies the user that a lifted mute no longer applies (unless another mute is still active). */
export const notifyUnmuted = async (userId) => {
  const stillMuted = await getActiveMute(userId);
  const io = await getIo();
  if (stillMuted) {
    io.to(String(userId)).emit("chat_muted", { muted_until: new Date(stillMuted.muted_until).toISOString() });
    return;
  }
  io.to(String(userId)).emit("chat_unmuted", {});
  const sendNotification = await getSendNotification();
  await sendNotification(userId, "Messaging Restored", "You can send messages again. Thank you for keeping conversations respectful.");
};
