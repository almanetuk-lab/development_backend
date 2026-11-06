import {
  AccountDeletionError,
  ERASE_DEADLINE_DAYS,
  eraseAccount,
  listPendingErasure,
  restoreAccount,
} from "../services/accountDeletionService.js";
import { logAuditEvent } from "../utils/auditLogger.js";

// Admin side of account deletion: the "Pending erasure" queue, restore, and
// the only path to permanent erasure.

const sendAdminError = (res, error, fallback) => {
  if (error instanceof AccountDeletionError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error(`${fallback}:`, error);
  return res.status(500).json({ message: "Internal server error", error: error.message });
};

/** GET /api/admin/deleted-accounts */
export const getPendingErasure = async (req, res) => {
  try {
    const accounts = await listPendingErasure();
    return res.status(200).json({
      deadline_days: ERASE_DEADLINE_DAYS,
      // Badge turns red from day 21 of 28
      warning_days_left: ERASE_DEADLINE_DAYS - 21,
      accounts,
    });
  } catch (error) {
    return sendAdminError(res, error, "Admin list deleted accounts error");
  }
};

/** POST /api/admin/users/:id/restore-deletion */
export const restoreDeletedAccountByAdmin = async (req, res) => {
  try {
    const user = await restoreAccount(req.params.id, { adminId: req.admin?.id ?? null, req });
    return res.status(200).json({ status: "success", message: "Account restored", user: { id: user.id } });
  } catch (error) {
    return sendAdminError(res, error, "Admin restore deleted account error");
  }
};

/** POST /api/admin/users/:id/erase { confirm_user_id, reason } */
export const eraseDeletedAccount = async (req, res) => {
  try {
    const userId = req.params.id;
    if (req.body.confirm_user_id !== userId) {
      return res.status(400).json({ message: "The confirmation ID doesn't match this account." });
    }

    await eraseAccount(userId, req.admin?.id ?? null, req);
    logAuditEvent(null, "ADMIN_ERASE_REASON", { user_id: userId, admin_id: req.admin?.id ?? null, reason: req.body.reason || null }, req);

    return res.status(200).json({ status: "success", message: "Account permanently erased" });
  } catch (error) {
    return sendAdminError(res, error, "Admin erase account error");
  }
};
