import { Router } from "express";
import { getAdminReport } from "../controller/reportController.js";
import { getNotRenewedUsers } from "../controller/notRenewedController.js";
const router = Router();

router.get("/", getAdminReport);
router.get("/not-renewed", getNotRenewedUsers);


export default router;
