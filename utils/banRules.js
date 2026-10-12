// Pure ban rules shared by the ban service, middleware and SQL queries.
// No imports on purpose: safe to use from tests and low-level modules.
//
// A user is banned when: status = 'Deactivate' AND (banned_until IS NULL OR banned_until > NOW())
// banned_until IS NULL means permanent. An expired ban stops counting immediately,
// even before liftExpiredBans() tidies the row up.

export const BANNED_STATUS = "Deactivate";
export const SUSPENDED_CODE = "ACCOUNT_SUSPENDED";
export const RECIPIENT_UNAVAILABLE_CODE = "RECIPIENT_UNAVAILABLE";
export const SUSPENDED_MESSAGE =
  "Your account has been suspended for violating our community guidelines.";
export const MAX_BAN_DAYS = 3650;

const DAY_MS = 24 * 60 * 60 * 1000;

/** SQL condition that is TRUE when the users row aliased `alias` is banned. */
export const bannedSql = (alias = "u") =>
  `(${alias}.status = '${BANNED_STATUS}' AND (${alias}.banned_until IS NULL OR ${alias}.banned_until > NOW()))`;

/** SQL condition that is TRUE when the user id expression does NOT belong to a banned user. */
export const notBannedSql = (userIdExpr) =>
  `NOT EXISTS (SELECT 1 FROM users bu WHERE bu.id = ${userIdExpr} AND ${bannedSql("bu")})`;

/** JS mirror of bannedSql for a row with { status, banned_until }. */
export const isBanActive = (row, now = new Date()) =>
  !!row &&
  row.status === BANNED_STATUS &&
  (!row.banned_until || new Date(row.banned_until) > now);

/** End of a ban, or null for permanent. */
export const computeBannedUntil = ({ durationDays, permanent }, now = new Date()) => {
  if (permanent) return null;
  const days = Number(durationDays);
  if (!Number.isInteger(days) || days < 1 || days > MAX_BAN_DAYS) {
    throw new Error(`durationDays must be an integer between 1 and ${MAX_BAN_DAYS}`);
  }
  return new Date(now.getTime() + days * DAY_MS);
};

/** Body sent with 403 responses and the account_suspended socket event. */
export const suspensionPayload = ({ reason, banned_until }) => ({
  code: SUSPENDED_CODE,
  error: SUSPENDED_MESSAGE,
  reason: reason || null,
  banned_until: banned_until ? new Date(banned_until).toISOString() : null,
  is_permanent: !banned_until,
});
