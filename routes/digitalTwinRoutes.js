import express from "express";
import { getDigitalTwin } from "../controller/digitalTwinController.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";

const router = express.Router();

// GET /api/twin
router.get("/", validateAccessToken, getDigitalTwin);

export default router;
