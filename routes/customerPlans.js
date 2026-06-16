import express from "express";
import { getAllPlans} from "../controller/customerPlansController.js";
const router = express.Router();

// for Customer only See routes
router.get("/", getAllPlans);    // List all plans
export default router;
