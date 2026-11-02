// Pure auto-moderation rules shared by the moderation services, controllers and SQL queries.
// No imports on purpose: safe to use from tests and low-level modules.
//
// A strike is active when: is_strike AND status <> 'dismissed' AND created_at within STRIKE_WINDOW_DAYS
// A mute is active when:   lifted_at IS NULL AND muted_until > NOW()

export const STRIKE_WINDOW_DAYS = 30;
export const MUTED_CODE = "CHAT_MUTED";
export const MUTED_MESSAGE =
  "You can't send messages right now because of repeated community guidelines violations.";

const HOUR_MS = 60 * 60 * 1000;

/** SQL condition that is TRUE when the user_chat_mutes row aliased `alias` is active. */
export const activeMuteSql = (alias = "m") =>
  `(${alias}.lifted_at IS NULL AND ${alias}.muted_until > NOW())`;

/** SQL condition that is TRUE when the message_moderation_flags row aliased `alias` is an active strike. */
export const activeStrikeSql = (alias = "f") =>
  `(${alias}.is_strike AND ${alias}.status <> 'dismissed' AND ${alias}.created_at > NOW() - INTERVAL '${STRIKE_WINDOW_DAYS} days')`;

/**
 * Escalation ladder for a user's active strike count (including the new strike).
 *   1-2 → warn, 3-4 → 24h mute, 5+ → 7-day mute and ask admins to review a ban.
 * @param {number} strikeCount
 * @returns {{ action: 'none'|'warn'|'mute', hours?: number, escalate?: boolean }}
 */
export const decideAutoAction = (strikeCount) => {
  const n = Number(strikeCount);
  if (!Number.isInteger(n) || n < 1) return { action: "none" };
  if (n >= 5) return { action: "mute", hours: 168, escalate: true };
  if (n >= 3) return { action: "mute", hours: 24 };
  return { action: "warn" };
};

/** End of a mute of `hours` starting at `now`. */
export const computeMutedUntil = (hours, now = new Date()) => new Date(now.getTime() + hours * HOUR_MS);

/** Body sent with 403 responses when a muted user tries to send. */
export const mutedPayload = ({ muted_until }) => ({
  code: MUTED_CODE,
  error: MUTED_MESSAGE,
  muted_until: muted_until ? new Date(muted_until).toISOString() : null,
});
