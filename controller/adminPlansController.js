import { pool } from "../config/db.js";
import { logAuditEvent } from "../utils/auditLogger.js";

// ---------------------- Get All Plans ----------------------
export const getAllPlans = async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT * FROM plans ORDER BY id ASC;");
        res.json(rows);
    } catch (err) {
        console.error("Error fetching plans:", err);
        res.status(500).json({ error: "Database error" });
    }
};

// Admin: toggle active / inactive
export const togglePlanStatus = async (req, res) => {
    const { planId } = req.params;
    const { rows } = await pool.query("SELECT is_active FROM plans WHERE id = $1", [planId]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const newStatus = rows[0].is_active === 1 ? 0 : 1;
    await pool.query("UPDATE plans SET is_active = $1 WHERE id = $2", [newStatus, planId]);
    
    const adminId = req.admin?.id || req.user?.id || null;
    logAuditEvent(adminId, "PLAN_TOGGLE_STATUS", { plan_id: planId, active: newStatus === 1 }, req);

    res.json({ success: true, is_active: newStatus });
};

// ---------------------- Get Plan By ID ----------------------
export const getPlanById = async (req, res) => {
    try {
        const { id } = req.params;

        const q = `SELECT * FROM plans WHERE id = $1;`;
        const { rows } = await pool.query(q, [id]);

        if (rows.length === 0)
            return res.status(404).json({ message: "Plan not found" });

        res.json(rows[0]);
    } catch (err) {
        console.error("Error fetching plan:", err);
        res.status(500).json({ error: "Database error" });
    }
};

// ---------------------- Create Plan ----------------------
export const createPlan = async (req, res) => {
    try {
        const {
            name,
            description,
            price,
            duration,
            type,
            billing_info,
            audio_call_limit,
            video_call_limit,
            people_search_limit,
            people_message_limit,
            allowed_features,
        } = req.body;

        // ✅ Basic field validation
        if (!name || !description || !duration || !type || !billing_info) {
            return res.status(400).json({ error: "Missing required fields." });
        }

        // ✅ Build dynamic query parts
        const columns = ["name", "description", "price", "duration", "type", "billing_info"];
        const values = [name, description, price || 0, duration, type, billing_info];
        const placeholders = ["$1", "$2", "$3", "$4", "$5", "$6"];
        let index = 7;

        // Optional fields — include only if provided
        const optionalFields = {
            audio_call_limit,
            video_call_limit,
            people_search_limit,
            people_message_limit,
            allowed_features: allowed_features ? (typeof allowed_features === "string" ? allowed_features : JSON.stringify(allowed_features)) : null,
        };

        for (const [key, value] of Object.entries(optionalFields)) {
            if (value !== undefined && value !== null && value !== "") {
                columns.push(key);
                values.push(value);
                placeholders.push(`$${index++}`);
            }
        }

        const query = `
      INSERT INTO plans (${columns.join(", ")})
      VALUES (${placeholders.join(", ")})
      RETURNING *;
    `;

        const { rows } = await pool.query(query, values);
        console.log(rows[0]);

        const adminId = req.admin?.id || req.user?.id || null;
        logAuditEvent(adminId, "PLAN_CREATE", { name, price, type }, req);

        res.status(201).json(rows[0]);
    } catch (err) {
        console.error("Error creating plan:", err);
        res.status(500).json({ error: "Database error" });
    }
};
// ---------------------- Update Plan ----------------------
export const updatePlan = async (req, res) => {
    try {
        const { id } = req.params;

        const {
            name,
            price,
            duration,
            video_call_limit,
            people_search_limit,
            people_message_limit,
            audio_call_limit,
            type,
            description,
            billing_info,
            allowed_features,
        } = req.body;

        const q = `
      UPDATE plans
      SET name=$1, price=$2, duration=$3, video_call_limit=$4,
          people_search_limit=$5, people_message_limit=$6,
          audio_call_limit=$7, type=$8, description=$9, billing_info=$10,
          allowed_features=$11
      WHERE id=$12;
    `;

        await pool.query(q, [
            name,
            price,
            duration,
            video_call_limit,
            people_search_limit,
            people_message_limit,
            audio_call_limit,
            type,
            description,
            billing_info,
            allowed_features ? (typeof allowed_features === "string" ? allowed_features : JSON.stringify(allowed_features)) : null,
            id,
        ]);

        const adminId = req.admin?.id || req.user?.id || null;
        logAuditEvent(adminId, "PLAN_UPDATE", { plan_id: id, name, price, type }, req);

        res.json({ message: "Plan updated successfully" });
    } catch (err) {
        console.error("Error updating plan:", err);
        res.status(500).json({ error: "Database error" });
    }
};

// ---------------------- Delete Plan ----------------------
export const deletePlan = async (req, res) => {
    try {
        const { id } = req.params;

        const q = `DELETE FROM plans WHERE id = $1;`;
        await pool.query(q, [id]);

        res.json({ message: "Plan deleted successfully" });
    } catch (err) {
        console.error("Error deleting plan:", err);
        res.status(500).json({ error: "Database error" });
    }
};
