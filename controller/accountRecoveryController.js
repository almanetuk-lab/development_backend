import { pool } from "../config/db.js";
import {
  AccountDeletionError,
  archiveForFreshStart,
  findRestorableByEmail,
  issueSession,
  restoreAccount,
  sendVerificationCode,
  verifyCode,
} from "../services/accountDeletionService.js";
import { getActiveBan, suspendedResponse } from "../services/accountBanService.js";

// Public endpoints behind the "This account was deleted" screen. The user
// proves the email with a code, then restores the old account or sets it
// aside to start fresh.

const sendRecoveryError = (res, error, fallback) => {
  if (error instanceof AccountDeletionError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(`❌ ${fallback}:`, error);
  return res.status(500).json({ error: `${fallback}. Please try again later.` });
};

const GENERIC_CODE_REPLY = { message: "If that account can be recovered, we've emailed a 6-digit code." };

/** POST /api/account/recover/code { email, purpose } */
export const requestRecoveryCode = async (req, res) => {
  try {
    const { email, purpose } = req.body;
    const account = await findRestorableByEmail(email);

    // Same reply whether or not the account exists, so this can't probe emails
    if (!account || (purpose === "start_fresh" && account.deleted_was_banned)) {
      return res.status(200).json(GENERIC_CODE_REPLY);
    }

    await sendVerificationCode(account.id, account.email, purpose);
    return res.status(200).json(GENERIC_CODE_REPLY);
  } catch (error) {
    return sendRecoveryError(res, error, "Failed to send the code");
  }
};

/** POST /api/account/restore { email, code } → restores and logs the user in. */
export const restoreDeletedAccount = async (req, res) => {
  try {
    const { email, code } = req.body;
    const account = await findRestorableByEmail(email);
    if (!account) {
      return res.status(400).json({ error: "This code has expired. Please request a new one." });
    }

    await verifyCode(account.id, "restore", code);
    const user = await restoreAccount(account.id, { req });

    // A ban survives deletion: restore, but no session for a banned account
    const ban = await getActiveBan(user.id);
    if (ban) return suspendedResponse(res, ban);

    issueSession(res, user);

    const { rows } = await pool.query(
      `SELECT id, user_id, first_name, last_name, profession, username, about_me
       FROM profiles WHERE user_id = $1`,
      [user.id]
    );
    const user_profile = rows[0] ? { ...rows[0], email: user.email } : null;

    return res.status(200).json({
      message: "Welcome back! Your account has been restored.",
      user_profile,
      status: user.status,
    });
  } catch (error) {
    return sendRecoveryError(res, error, "Failed to restore the account");
  }
};

/** POST /api/account/start-fresh { email, code } → frees the email for a new sign-up. */
export const startFresh = async (req, res) => {
  try {
    const { email, code } = req.body;
    const account = await findRestorableByEmail(email);
    if (!account) {
      return res.status(400).json({ error: "This code has expired. Please request a new one." });
    }
    if (account.deleted_was_banned) {
      return res.status(403).json({ error: "This email can't be used for a new account." });
    }

    await verifyCode(account.id, "start_fresh", code);
    await archiveForFreshStart(account.id, req);

    return res.status(200).json({ message: "Your old account has been set aside. You can now create a new one." });
  } catch (error) {
    return sendRecoveryError(res, error, "Failed to start a new account");
  }
};
