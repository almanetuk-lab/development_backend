import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { pool } from "../config/db.js";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Default flat budrnout curvdde — used when no historical data is available.
 * Values represent estimated stress intensity per month (0–100).
 */
const DEFAULT_BURNOUT_CURVE = {
  jan: 40, feb: 40, mar: 40, apr: 40, may: 40, jun: 40,
  jul: 40, aug: 40, sep: 40, oct: 40, nov: 40, dec: 40
};

const DEFAULT_TWIN_STATE = {
  professional_ambition: "N/A",
  lifestyle_rhythms: "N/A",
  emotional_architecture: "N/A",
  relationship_intent: "N/A",
  communication_style: "N/A",
  social_energy: "N/A",
  stress_cycle: "N/A",
  career_context: "N/A",
  personal_growth_indicators: "N/A",
  current_state_summary: "Awaiting sufficient data to form a complete persona.",
  burnout_curve: DEFAULT_BURNOUT_CURVE,
  memory: {
    events: [],
    handshakes: [],
    relationship_learning: []
  }
};

/**
 * Extracts the first valid JSON object from an arbitrary string.
 */
const extractJsonFromText = (text) => {
  let cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
};

/**
 * Validates and normalises a burnout curve object.
 * Returns the curve if all 12 months are present, otherwise null.
 */
const validateBurnoutCurve = (curve) => {
  if (!curve || typeof curve !== "object") return null;
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const hasAll = MONTHS.every(m => typeof curve[m] === "number");
  if (!hasAll) return null;
  // Clamp all values to 0-100
  const normalised = {};
  MONTHS.forEach(m => { normalised[m] = Math.min(100, Math.max(0, Math.round(curve[m]))); });
  return normalised;
};

export const generateOrUpdateTwin = async (userId, profileData, aiOutputs) => {
  try {
    console.log(`🤖 [DigitalTwinService] Generating/Updating Twin for user ${userId}...`);
    console.log("[DEBUG] Twin Generation Started");

    // Fetch existing Twin
    const existingTwinResult = await pool.query(
      "SELECT twin_data FROM digital_twins WHERE user_id = $1",
      [userId]
    );

    let existingTwin = DEFAULT_TWIN_STATE;
    if (existingTwinResult.rows.length > 0) {
      existingTwin = existingTwinResult.rows[0].twin_data;
    }

    // Preserve an already-valid burnout_curve so Gemini never regenerates it unnecessarily
    const existingBurnoutCurve = validateBurnoutCurve(existingTwin.burnout_curve);

    // Prepare context for Gemini
    const contextStr = JSON.stringify({
      profile_data: profileData,
      ai_outputs: aiOutputs,
      existing_twin: existingTwin
    }, null, 2);

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are the core personality synthesis engine for Intentional Connection.
Your job is to generate a Persistent Agent Persona (Digital Twin) for a user based on their profile data, AI outputs, and existing twin memory.

Analyze the provided data and synthesize a comprehensive JSON object. Do not overwrite memory arrays; append relevant new psychological shifts or major profile updates into the "events" array in the memory structure.

BURNOUT CURVE RULES:
- The burnout_curve represents estimated monthly career stress intensity (0-100) for all 12 months.
- 0 = completely relaxed month, 100 = maximum burnout month.
- Infer the curve from profession, career_context, work rhythm, lifestyle, stress_cycle and any seasonal patterns.
- All 12 keys (jan through dec) MUST be present with integer values between 0 and 100.
${existingBurnoutCurve ? "- An existing valid burnout_curve is provided in the existing_twin — REUSE IT EXACTLY, do not recalculate." : "- No valid burnout_curve exists — you MUST generate a realistic one."}

REQUIRED JSON STRUCTURE (Return exactly this JSON, no markdown):
{
  "professional_ambition": "String describing ambition",
  "lifestyle_rhythms": "String describing daily rhythms",
  "emotional_architecture": "String describing emotional style",
  "relationship_intent": "String describing what they seek",
  "communication_style": "String describing how they communicate",
  "social_energy": "String describing their social capacity",
  "stress_cycle": "String describing stress triggers and recovery",
  "career_context": "String describing their work environment",
  "personal_growth_indicators": "String describing growth areas",
  "current_state_summary": "A cohesive 2-sentence summary of their current psychological state",
  "burnout_curve": {
    "jan": 0, "feb": 0, "mar": 0, "apr": 0, "may": 0, "jun": 0,
    "jul": 0, "aug": 0, "sep": 0, "oct": 0, "nov": 0, "dec": 0
  },
  "memory": {
    "events": ["Array of recent significant changes or realizations"],
    "handshakes": ["Array of future handshake data, keep existing"],
    "relationship_learning": ["Array of relationship learnings, keep existing"]
  }
}

INPUT DATA:
${contextStr}
`;

    const result = await model.generateContent(prompt);
    console.log("[DEBUG] Gemini Request Sent");

    const response = await result.response;
    const rawText = response.text();
    console.log("[DEBUG] Gemini Response Received");
    console.log("[DEBUG] Raw Response:", rawText);

    const jsonString = extractJsonFromText(rawText);
    if (!jsonString) {
      throw new Error("Could not extract JSON block from Gemini twin response");
    }

    const synthesizedTwin = JSON.parse(jsonString);
    console.log("[DEBUG] Parsed Twin JSON:", JSON.stringify(synthesizedTwin, null, 2));

    // Make sure we have the memory structure
    if (!synthesizedTwin.memory) {
      synthesizedTwin.memory = existingTwin.memory || DEFAULT_TWIN_STATE.memory;
    }

    // Validate / fallback burnout_curve
    const validatedCurve = validateBurnoutCurve(synthesizedTwin.burnout_curve)
      || existingBurnoutCurve
      || DEFAULT_BURNOUT_CURVE;
    synthesizedTwin.burnout_curve = validatedCurve;

    console.log("[DEBUG] Database Upsert Started");
    // Upsert into database
    await pool.query(`
      INSERT INTO digital_twins (user_id, twin_data, current_state_summary, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        twin_data = EXCLUDED.twin_data,
        current_state_summary = EXCLUDED.current_state_summary,
        updated_at = NOW()
    `, [userId, JSON.stringify(synthesizedTwin), synthesizedTwin.current_state_summary]);

    console.log("[DEBUG] Database Upsert Success");
    console.log(`[DEBUG] Saved Twin ID (user_id): ${userId}`);
    console.log(`✅ [DigitalTwinService] Digital Twin successfully updated for user ${userId}.`);
    return synthesizedTwin;

  } catch (error) {
    console.error(`❌ [DigitalTwinService] Error updating twin for user ${userId}:`, error.message);
    // Silent fail so we don't break background processing
  }
};

/**
 * Module 3 — Burnout Curve Helper
 *
 * Returns the burnout_curve for a user's Digital Twin.
 * If the stored twin does not have a valid curve, it infers one using Gemini
 * based on profession, stress_cycle, career_context and lifestyle_rhythms —
 * then persists the updated twin_data back to the database.
 *
 * This helper is called ONCE per handshake per user (only when curve is missing),
 * never during every handshake — keeping Gemini costs minimal.
 *
 * @param {number} userId
 * @param {object} twinData   - already-loaded twin_data object from DB
 * @param {object} profile    - profile row (profession, about_me, life_rhythms, etc.)
 * @returns {object}          - validated 12-month burnout curve
 */
export const getOrGenerateBurnoutCurve = async (userId, twinData, profile = {}) => {
  // Fast path — twin already has a valid curve
  const existing = validateBurnoutCurve(twinData?.burnout_curve);
  if (existing) {
    console.log(`✅ [BurnoutCurve] Reusing existing curve for user ${userId}.`);
    return existing;
  }

  console.log(`🔮 [BurnoutCurve] Generating missing burnout curve for user ${userId}...`);

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const contextSummary = {
      profession: profile.profession || twinData?.career_context || "Unknown",
      stress_cycle: twinData?.stress_cycle || "Unknown",
      career_context: twinData?.career_context || "Unknown",
      lifestyle_rhythms: twinData?.lifestyle_rhythms || "Unknown",
      professional_ambition: twinData?.professional_ambition || "Unknown",
      about_me: profile.about_me || "",
      work_rhythm: profile.work_rhythm || "",
      work_environment: profile.work_environment || ""
    };

    const prompt = `You are a behavioral analytics engine for Intentional Connection.

Based on the professional context below, generate a 12-month burnout intensity curve.

RULES:
- Values must be integers between 0 (fully relaxed) and 100 (maximum burnout).
- Base the curve on typical seasonal career pressure patterns for this profession and lifestyle.
- Return ONLY a raw JSON object — no markdown, no prose.

REQUIRED OUTPUT:
{
  "jan": 0, "feb": 0, "mar": 0, "apr": 0, "may": 0, "jun": 0,
  "jul": 0, "aug": 0, "sep": 0, "oct": 0, "nov": 0, "dec": 0
}

PROFESSIONAL CONTEXT:
${JSON.stringify(contextSummary, null, 2)}
`;

    const result = await model.generateContent(prompt);
    const rawText = result.response.text();
    const jsonString = extractJsonFromText(rawText);

    if (!jsonString) {
      console.warn(`⚠️ [BurnoutCurve] Could not parse Gemini response for user ${userId}. Using default.`);
      return DEFAULT_BURNOUT_CURVE;
    }

    const parsed = JSON.parse(jsonString);
    const validated = validateBurnoutCurve(parsed);

    if (!validated) {
      console.warn(`⚠️ [BurnoutCurve] Invalid curve structure for user ${userId}. Using default.`);
      return DEFAULT_BURNOUT_CURVE;
    }

    // Persist the newly generated curve back into the Digital Twin
    const updatedTwinData = { ...twinData, burnout_curve: validated };
    await pool.query(`
      UPDATE digital_twins
      SET twin_data = $1, updated_at = NOW()
      WHERE user_id = $2
    `, [JSON.stringify(updatedTwinData), userId]);

    console.log(`✅ [BurnoutCurve] Burnout curve generated and persisted for user ${userId}.`);
    return validated;

  } catch (error) {
    console.error(`❌ [BurnoutCurve] Error generating curve for user ${userId}:`, error.message);
    return DEFAULT_BURNOUT_CURVE;
  }
};
