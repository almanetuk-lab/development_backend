import express from "express";
import { getConfigurations } from "../controller/configController.js";
const router = express.Router();

router.get("/", getConfigurations);

export default router;