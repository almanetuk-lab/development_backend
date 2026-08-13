import express from "express";
import { googleAuth } from "../controller/googleController.js";

const router = express.Router();

router.post("/api/auth/google", googleAuth);

export default router;
