import express from "express";
import { getSentimentHealth } from "../controller/healthController.js";

const router = express.Router();

router.get("/sentiment", getSentimentHealth);

export default router;
