import express from "express";
import { validate } from "../validations/validate.js";
import { recoveryActionSchema, recoveryCodeSchema } from "../validations/accountDeletionSchemas.js";
import { requestRecoveryCode, restoreDeletedAccount, startFresh } from "../controller/accountRecoveryController.js";

const router = express.Router();

// Deleted-account recovery (public; rate limited with the auth limiter in server.js)
router.post("/api/account/recover/code", validate(recoveryCodeSchema), requestRecoveryCode); // Email a restore/start-fresh code
router.post("/api/account/restore", validate(recoveryActionSchema), restoreDeletedAccount); // Restore + log in
router.post("/api/account/start-fresh", validate(recoveryActionSchema), startFresh); // Archive old account, free the email

export default router;
