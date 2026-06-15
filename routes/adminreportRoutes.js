import { Router } from "express";
import { getUsersByType } from "../controller/adminReportController.js";

const router = Router();

router.get("/", getUsersByType);

export default router;
