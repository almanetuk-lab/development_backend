import express from "express";
import { getAllPlans, getPlanById, createPlan, updatePlan, deletePlan, togglePlanStatus } from "../controller/adminPlansController.js";
const router = express.Router();

router.put("/:planId/toggle", togglePlanStatus);
// Admin CRUD routes
router.get("/", getAllPlans);          // List all plans
router.get("/:id", getPlanById);       // Get single plan
router.post("/", createPlan);          // Create new plan
router.put("/:id", updatePlan);        // Update plan
router.delete("/:id", deletePlan); 

// Delete plan

export default router;
