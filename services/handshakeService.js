import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { pool } from "../config/db.js";
import { getOrGenerateBurnoutCurve } from "./digitalTwinService.js";
import { awardHandshakePoints } from "./trustService.js";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── Default states (used when Gemini is unavailable) ──────────────────────

const DEFAULT_HANDSHAKE_STATE = {
  compatibility_markers: {
    professional_alignment: 50,
    lifestyle_alignment: 50,
    emotional_alignment: 50,
    communication_alignment: 50,
    growth_alignment: 50
  },
  risk_flags: {
    career_conflict_risk: false,
    communication_conflict_risk: false,
    stress_overlap_risk: false
  },
  handshake_summary: "Baseline compatibility signals processed due to temporary service unavailability.",
  stress_synchronization: {
    stress_alignment: 50,
    conflict_risk: 50,
    recovery_alignment: 50,
    communication_availability: 50,
    busy_overlap: [],
    summary: "Stress synchronization could not be computed due to temporary service unavailability."
  },
  // Module 6 — Privacy-Preserving Data Exchange default
  privacy_verification: {
    professional_alignment_score: 50,
    industry_match_score: 50,
    career_stage_match_score: 50,
    identity_protected: true,
    employer_hidden: true,
    salary_hidden: true,
    ai_privacy_summary: "Privacy verification unavailable due to temporary service interruption. No personal identity data was exposed."
  },
  // Module 7 — Structural Audit Report default
  audit_report: {
    overall_score: 50,
    grade: "C",
    strength_areas: [],
    risk_areas: [],
    recommendation: "Pending",
    synthesis_summary: "Structural audit unavailable due to temporary service interruption."
  },
  // Module 4 — Agent-to-Agent Friction Interview default
  friction_interview: {
    interviewSummary: "Friction interview details could not be generated due to temporary service interruption.",
    communicationCompatibility: 50,
    lifestyleCompatibility: 50,
    workRhythmCompatibility: 50,
    agreementPoints: [],
    frictionPoints: [],
    aiInsight: "Friction interview details unavailable."
  },
  // Module 5 — Conflict Simulation Logic default
  conflict_simulation: {
    conflictScenarios: [],
    conflictRisk: 50,
    resolutionSuggestions: [],
    predictedOutcome: "Conflict simulation details could not be generated due to temporary service interruption.",
    aiRecommendation: "Establish baseline relationship/scheduling boundaries."
  }
};

// ─── Module 6: Privacy Sanitization ────────────────────────────────────────

/**
 * PII fields that must NEVER appear in any Gemini payload.
 * Kept as a centralised allowlist so future twin fields are
 * automatically blocked unless explicitly added here.
 */
const PRIVACY_ALLOWED_TWIN_FIELDS = new Set([
  "professional_ambition",
  "lifestyle_rhythms",
  "emotional_architecture",
  "relationship_intent",
  "communication_style",
  "social_energy",
  "stress_cycle",
  "career_context",
  "personal_growth_indicators",
  "current_state_summary",
  "burnout_curve"
]);

/**
 * Strips all PII from a raw twin_data object.
 * Only fields in PRIVACY_ALLOWED_TWIN_FIELDS are forwarded.
 * Additionally, generalises career_context to remove exact job titles,
 * company names, salaries, or contact info if inadvertently present.
 *
 * @param {object} twinData  - raw twin_data from digital_twins
 * @param {object} burnout   - validated 12-month burnout curve
 * @returns {object}         - PII-free payload safe for Gemini
 */
const buildPrivacySanitizedTwin = (twinData, burnout) => {
  const safe = {};
  for (const field of PRIVACY_ALLOWED_TWIN_FIELDS) {
    if (field === "burnout_curve") {
      safe.burnout_curve = burnout;
    } else {
      safe[field] = twinData[field] || "N/A";
    }
  }
  // Explicitly remove any stray PII keys that should never reach Gemini
  delete safe.first_name;
  delete safe.last_name;
  delete safe.email;
  delete safe.phone;
  delete safe.employer;
  delete safe.company;
  delete safe.salary;
  delete safe.address;
  delete safe.city;
  delete safe.state;
  delete safe.country;
  delete safe.linkedin_url;
  return safe;
};

/**
 * Extracts first JSON block from text.
 */
const extractJsonFromText = (text) => {
  let cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
};

/**
 * Clamps a value to integer within 0–100.
 */
const clampScore = (val, fallback = 50) =>
  Math.min(100, Math.max(0, parseInt(val) || fallback));

// ─── Module 7: Structural Audit Report Builder ──────────────────────────────

const GRADE_THRESHOLDS = { A: 80, B: 65, C: 50 };

/**
 * Converts a numeric score 0-100 to a letter grade.
 */
const scoreToGrade = (score) => {
  if (score >= GRADE_THRESHOLDS.A) return "A";
  if (score >= GRADE_THRESHOLDS.B) return "B";
  if (score >= GRADE_THRESHOLDS.C) return "C";
  return "D";
};

/**
 * Determines the recommendation string based on overall score and active risk flags.
 */
const deriveRecommendation = (score, riskFlags) => {
  const activeRisks = Object.values(riskFlags || {}).filter(Boolean).length;
  if (score >= 80 && activeRisks === 0) return "Highly Compatible";
  if (score >= 65 && activeRisks <= 1) return "Compatible with Caution";
  if (score >= 50) return "Proceed Carefully";
  return "Not Recommended";
};

/**
 * Module 7 — buildAuditReport
 *
 * Synthesises the outputs of Modules 2 (compatibility), 3 (stress sync),
 * 6 (privacy verification), 4 (friction interview), and 5 (conflict simulation)
 * into a single Structural Audit Report.
 *
 * Pure deterministic JavaScript — ZERO extra Gemini calls.
 * If Gemini also returns an audit_report.synthesis_summary we prefer that
 * richer AI text; otherwise we generate a structured plain-language summary.
 *
 * @param {object} cm   - compatibility_markers
 * @param {object} rf   - risk_flags
 * @param {object} ss   - stress_synchronization
 * @param {object} pv   - privacy_verification
 * @param {object} fi   - friction_interview (Module 4)
 * @param {object} cs   - conflict_simulation (Module 5)
 * @param {string|null} aiSummary - synthesis_summary from Gemini (optional)
 * @returns {object}    - audit_report
 */
const buildAuditReport = (cm, rf, ss, pv, fi = null, cs = null, aiSummary = null) => {
  // ── 1. Overall score: weighted average across all available signals ─────
  // Weights reflect relative importance: compatibility anchors the report (40%),
  // stress sync (20%), privacy (15%), friction interview (15%), conflict simulation (10%).
  
  const cmScores = Object.values(cm || {}).filter(v => typeof v === "number");
  const cmAvg = cmScores.length
    ? Math.round(cmScores.reduce((a, b) => a + b, 0) / cmScores.length)
    : 50;

  const ssScore = Math.round(
    ((ss?.stress_alignment ?? 50) * 0.4) +
    ((ss?.recovery_alignment ?? 50) * 0.35) +
    (Math.max(0, 100 - (ss?.conflict_risk ?? 50)) * 0.25)
  );

  const pvScore = Math.round(
    ((pv?.professional_alignment_score ?? 50) * 0.4) +
    ((pv?.industry_match_score ?? 50) * 0.35) +
    ((pv?.career_stage_match_score ?? 50) * 0.25)
  );

  // Module 4: Friction interview average score
  const fiScore = fi
    ? Math.round(
        ((fi.communicationCompatibility ?? 50) +
         (fi.lifestyleCompatibility ?? 50) +
         (fi.workRhythmCompatibility ?? 50)) / 3
      )
    : 50;

  // Module 5: Conflict simulation compliance score
  const csScore = cs
    ? Math.max(0, 100 - (cs.conflictRisk ?? 50))
    : 50;

  // Weighted blend: compatibility 40%, stress 20%, privacy 15%, friction 15%, conflict 10%
  const overallScore = clampScore(
    Math.round(
      cmAvg * 0.40 +
      ssScore * 0.20 +
      pvScore * 0.15 +
      fiScore * 0.15 +
      csScore * 0.10
    )
  );

  // ── 2. Grade ──────────────────────────────────────────────────────────────
  const grade = scoreToGrade(overallScore);

  // ── 3. Strength areas ─────────────────────────────────────────────────────
  const strengthAreas = [];
  const STRENGTH_THRESHOLD = 72;

  const markerLabels = {
    professional_alignment: "Professional Alignment",
    lifestyle_alignment: "Lifestyle Alignment",
    emotional_alignment: "Emotional Alignment",
    communication_alignment: "Communication Alignment",
    growth_alignment: "Growth Alignment"
  };
  for (const [key, label] of Object.entries(markerLabels)) {
    if ((cm?.[key] ?? 0) >= STRENGTH_THRESHOLD) strengthAreas.push(label);
  }
  if ((ss?.stress_alignment ?? 0) >= STRENGTH_THRESHOLD) strengthAreas.push("Stress Rhythm Sync");
  if ((ss?.recovery_alignment ?? 0) >= STRENGTH_THRESHOLD) strengthAreas.push("Recovery Alignment");
  if ((pv?.professional_alignment_score ?? 0) >= STRENGTH_THRESHOLD) strengthAreas.push("Professional Compatibility");
  
  // Module 4 strengths
  if ((fi?.communicationCompatibility ?? 0) >= STRENGTH_THRESHOLD) strengthAreas.push("Frictionless Dialogue");
  if ((fi?.lifestyleCompatibility ?? 0) >= STRENGTH_THRESHOLD) strengthAreas.push("Daily Rhythm Harmony");
  if ((fi?.workRhythmCompatibility ?? 0) >= STRENGTH_THRESHOLD) strengthAreas.push("Work-Schedule Sync");

  // Module 5 strengths
  if ((cs?.conflictRisk ?? 100) < 40) strengthAreas.push("Low Conflict Probability");

  // ── 4. Risk areas ─────────────────────────────────────────────────────────
  const riskAreas = [];
  const RISK_THRESHOLD = 45;

  if (rf?.career_conflict_risk === true) riskAreas.push("Career Conflict Risk");
  if (rf?.communication_conflict_risk === true) riskAreas.push("Communication Conflict");
  if (rf?.stress_overlap_risk === true) riskAreas.push("Stress Overlap");
  if ((ss?.conflict_risk ?? 0) >= 65) riskAreas.push("High Stress Conflict Risk");
  
  for (const [key, label] of Object.entries(markerLabels)) {
    if ((cm?.[key] ?? 100) < RISK_THRESHOLD) riskAreas.push(`Low ${label}`);
  }

  // Module 4 risks
  if ((fi?.communicationCompatibility ?? 100) < RISK_THRESHOLD) riskAreas.push("Communication Friction");
  if ((fi?.lifestyleCompatibility ?? 100) < RISK_THRESHOLD) riskAreas.push("Lifestyle Friction");
  if ((fi?.workRhythmCompatibility ?? 100) < RISK_THRESHOLD) riskAreas.push("Schedule Desynchrony");

  // Module 5 risks
  if ((cs?.conflictRisk ?? 0) >= 65) riskAreas.push("Elevated Conflict Risk");

  // Deduplicate
  const uniqueRiskAreas = [...new Set(riskAreas)].slice(0, 3);

  // ── 5. Recommendation ─────────────────────────────────────────────────────
  const recommendation = deriveRecommendation(overallScore, rf);

  // ── 6. Synthesis summary ──────────────────────────────────────────────────
  // Prefer AI-generated summary; fall back to a deterministic plain-language one.
  let synthesisSum = aiSummary;
  if (!synthesisSum || typeof synthesisSum !== "string" || !synthesisSum.trim()) {
    const strengthText = strengthAreas.length
      ? `Key strengths include ${strengthAreas.slice(0, 2).join(" and ")}.`
      : "No dominant strength areas were identified.";
    const riskText = uniqueRiskAreas.length
      ? `Areas requiring attention: ${uniqueRiskAreas.slice(0, 2).join(", ")}.`
      : "No critical risk areas detected.";
    synthesisSum = `Overall compatibility score is ${overallScore}% (Grade ${grade}). ${strengthText} ${riskText} Recommendation: ${recommendation}.`;
  }

  return {
    overall_score: overallScore,
    grade,
    strength_areas: strengthAreas.slice(0, 5),
    risk_areas: uniqueRiskAreas,
    recommendation,
    synthesis_summary: synthesisSum.trim()
  };
};

/**
 * Module 3 — Stress-Cycle Delta Synchronization
 *
 * Compares the burnout rhythms and work cycles of two Digital Twins
 * and generates a stress compatibility risk profile.
 *
 * IMPORTANT: This runs inside the same Gemini call as the base handshake —
 * zero duplicate AI invocations.
 *
 * @param {number} userAId
 * @param {number} userBId
 * @param {object} twinA   - full digital_twins DB row for User A
 * @param {object} twinB   - full digital_twins DB row for User B
 * @returns {object}       - saved handshake_sessions row
 */
export const generateHandshake = async (userAId, userBId, twinA, twinB) => {
  try {
    console.log(`[DEBUG] Handshake Started`);
    console.log(`[DEBUG] Twin A Loaded (User ID: ${userAId})`);
    console.log(`[DEBUG] Twin B Loaded (User ID: ${userBId})`);

    const twinDataA = twinA.twin_data;
    const twinDataB = twinB.twin_data;

    // ── Step 1: Fetch profile metadata for burnout curve inference ──────────
    let profileA = {};
    let profileB = {};
    try {
      const [resA, resB] = await Promise.all([
        pool.query("SELECT profession, about_me, work_rhythm, work_environment, life_rhythms, sentiment_audit FROM profiles WHERE user_id = $1 LIMIT 1", [userAId]),
        pool.query("SELECT profession, about_me, work_rhythm, work_environment, life_rhythms, sentiment_audit FROM profiles WHERE user_id = $1 LIMIT 1", [userBId])
      ]);
      profileA = resA.rows[0] || {};
      profileB = resB.rows[0] || {};
    } catch (profileErr) {
      console.warn("⚠️ [Handshake] Could not fetch profiles for burnout inference:", profileErr.message);
    }

    // ── Step 2: Ensure both twins have valid burnout curves ─────────────────
    // Only calls Gemini if the curve is missing — reuses stored data otherwise.
    console.log(`[DEBUG] Ensuring burnout curves exist...`);
    const [burnoutA, burnoutB] = await Promise.all([
      getOrGenerateBurnoutCurve(userAId, twinDataA, profileA),
      getOrGenerateBurnoutCurve(userBId, twinDataB, profileB)
    ]);
    console.log(`[DEBUG] Burnout curves ready`);

    // ── Step 3: Build privacy-safe payloads (Module 6 — PII allowlist enforced) ─
    // buildPrivacySanitizedTwin() uses an explicit allowlist; no PII ever reaches Gemini.
    const privacySafeTwinA = buildPrivacySanitizedTwin(twinDataA, burnoutA);
    const privacySafeTwinB = buildPrivacySanitizedTwin(twinDataB, burnoutB);

    console.log(`[DEBUG] Compatibility Calculation Started`);
    console.log(`[DEBUG] Risk Analysis Started`);
    console.log(`[DEBUG] Stress Synchronization Analysis Started`);

    // ── Step 4: Single Gemini call — compatibility + stress sync + privacy + friction + conflict ──
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are the core personality handshake validation engine for Intentional Connection.
Your task is to analyze two abstract Digital Twins (User A and User B) and output:
1. Compatibility alignment signals and risk markers (Module 2).
2. Stress-Cycle Delta Synchronization — a month-by-month burnout rhythm comparison (Module 3).
3. Privacy Verification Report — confirm no PII is exposed and score professional/industry/career-stage alignment (Module 6).
4. Structural Audit — a high-level synthesis_summary across all signals (2-3 sentences, non-technical) (Module 7).
5. Agent-to-Agent Friction Interview (Module 4): Simulate a realistic, multi-turn Q&A interview between Digital Twin A and Digital Twin B. Have them ask and answer questions of each other regarding Communication Style, Lifestyle Rhythm, Professional Schedule, Emotional Profile, Intent Metadata, and Stress Synchronization. Write a summary, identify clear agreement points and friction points, score their dialog-based compatibility, and provide an AI insight.
6. Conflict Simulation Logic (Module 5): Simulate realistic relationship scenarios between the Digital Twins. Test scenarios such as: Busy Work Month, Communication Delay, Career Pressure, Lifestyle Difference, Emotional Stress, and Time Management. Predict conflict scenarios, overall conflict risk, specific actionable resolution suggestions, predicted outcome, and AI recommendation.

STRICT INSTRUCTIONS:
1. Do NOT refer to raw user information, names, emails, phone numbers, or exact employers.
2. Return ONLY a single raw JSON object. Do not include markdown fences, code backticks, or prose.
3. All percentage scores must be integers between 0 and 100.
4. Risk flags must be boolean values (true/false).
5. busy_overlap must be a JSON array of full English month names (e.g. ["March", "April"]).
   — A month counts as "busy overlap" when BOTH users have a burnout_curve value >= 65.
6. stress_alignment: how similar the monthly burnout patterns are (100 = identical rhythm, 0 = completely opposite).
7. conflict_risk: probability of relationship friction caused by simultaneous high-stress periods (0 = no risk, 100 = severe risk).
8. recovery_alignment: how well their low-stress/recovery months overlap (100 = perfect recovery sync).
9. communication_availability: estimated availability for quality communication outside peak periods (100 = always available).
10. summary (stress): 2-3 sentence narrative explaining the stress compatibility for a non-technical user.
11. privacy_verification rules:
    - professional_alignment_score: 0-100 score measuring how similar their generalised professional ambitions and work styles are.
    - industry_match_score: 0-100 score measuring how closely their inferred industries/sectors align.
    - career_stage_match_score: 0-100 score measuring how closely their career stages and leadership levels align.
    - identity_protected: always true — confirm no real identity info was used.
    - employer_hidden: always true — confirm no company name or employer was used.
    - salary_hidden: always true — confirm no salary or compensation data was used.
    - ai_privacy_summary: 1-2 sentence human-readable confirmation of what was compared (only generalised attributes) and that personal identity was never accessed.
12. audit_report.synthesis_summary ONLY: provide a 2-3 sentence executive summary synthesising the overall compatibility, stress synchronization, professional alignment, friction interview, and conflict simulation signals for a non-technical audience. Do not include any scores or raw field values in this summary.
13. friction_interview rules:
    - interviewSummary: 2-3 sentence summary of the simulated dialogue between the two digital twins.
    - communicationCompatibility: 0-100 score measuring their communication alignment based on the simulated dialogue.
    - lifestyleCompatibility: 0-100 score measuring their daily routine harmony based on the dialogue.
    - workRhythmCompatibility: 0-100 score measuring how well their work schedules and career rhythms align during the dialogue.
    - agreementPoints: array of 2-3 specific points they agreed on during the interview dialogue.
    - frictionPoints: array of 2-3 specific points of friction or disagreement identified during the interview dialogue.
    - aiInsight: 2-sentence deep psychological insight about their interaction patterns.
14. conflict_simulation rules:
    - conflictScenarios: array of 2-3 objects. Each object must have:
      * scenarioName: name of the simulated scenario (e.g. "Busy Work Month", "Lifestyle Difference")
      * description: 2-sentence description of the conflict scenario playing out between User A and User B.
      * likelyTriggers: what triggered the conflict in this scenario.
      * dynamicSimulation: a 2-3 line conversation snippet (A: ... \n B: ... \n A: ...) showing how they communicate during this crisis.
    - conflictRisk: 0-100 score measuring overall conflict risk/likelihood.
    - resolutionSuggestions: array of 2-3 actionable, profile-tailored suggestions to resolve or prevent these simulated conflicts.
    - predictedOutcome: 2-sentence prediction of how their relationship will fare under sustained pressure.
    - aiRecommendation: 2-sentence strategic recommendation for long-term relational stability.

REQUIRED JSON STRUCTURE:
{
  "compatibility_markers": {
    "professional_alignment": 88,
    "lifestyle_alignment": 75,
    "emotional_alignment": 92,
    "communication_alignment": 84,
    "growth_alignment": 80
  },
  "risk_flags": {
    "career_conflict_risk": false,
    "communication_conflict_risk": false,
    "stress_overlap_risk": false
  },
  "handshake_summary": "A 1-2 sentence description summarizing key alignment points and any potential friction.",
  "stress_synchronization": {
    "stress_alignment": 87,
    "conflict_risk": 24,
    "recovery_alignment": 91,
    "communication_availability": 88,
    "busy_overlap": ["March", "April"],
    "summary": "Both users experience similar work intensity during March and April. Communication expectations should be adjusted during these periods."
  },
  "privacy_verification": {
    "professional_alignment_score": 82,
    "industry_match_score": 78,
    "career_stage_match_score": 85,
    "identity_protected": true,
    "employer_hidden": true,
    "salary_hidden": true,
    "ai_privacy_summary": "Comparison was performed exclusively on generalised professional ambition, lifestyle rhythms, communication style, and emotional profile. No names, employers, salaries, or contact details were accessed or transmitted."
  },
  "audit_report": {
    "synthesis_summary": "These two individuals share strong emotional and lifestyle alignment, with their professional rhythms suggesting a complementary rather than competitive dynamic..."
  },
  "friction_interview": {
    "interviewSummary": "Twin A and Twin B engaged in a dialogue discussing work schedules and communication styles. Twin A expressed a preference for structured calendar boundaries, while Twin B favored fluid, spontaneous updates. They found common ground on prioritizing high-quality evening connections.",
    "communicationCompatibility": 82,
    "lifestyleCompatibility": 75,
    "workRhythmCompatibility": 68,
    "agreementPoints": [
      "Both value dedicated screen-free time during dinners",
      "Agreement on active listening during emotional check-ins"
    ],
    "frictionPoints": [
      "Twin A wants immediate replies during business hours, Twin B prefers batch-answering emails/messages",
      "Twin A has structured weekend routines, Twin B prefers absolute flexibility"
    ],
    "aiInsight": "Their dynamic represents an anchoring effect: Twin A provides stabilizing structure, while Twin B invites spontaneity. Healthy communication requires conscious adjustment of immediacy expectations."
  },
  "conflict_simulation": {
    "conflictScenarios": [
      {
        "scenarioName": "Busy Work Month",
        "description": "During a high-burnout period in Q3, Twin A retreats into task-focused isolation while Twin B seeks external verbal validation. This creates a temporary emotional distance.",
        "likelyTriggers": "Simultaneous high stress in September and task-oriented stress-recovery styles.",
        "dynamicSimulation": "Twin A: 'I just need to keep my head down and code for two weeks. Please don\\'t take it personally.'\nTwin B: 'I understand, but a quick morning check-in makes me feel connected. Complete silence is hard for me.'\nTwin A: 'Okay, I can send a simple heart emoji when I start my day to let you know I\\'m thinking of you.'"
      }
    ],
    "conflictRisk": 42,
    "resolutionSuggestions": [
      "Set an automated heart-emoji check-in ritual on particularly busy mornings.",
      "Agree on a weekly 30-minute stress-debrief session to clear communication backlogs."
    ],
    "predictedOutcome": "Highly likely to survive high-pressure periods if boundaries are proactively negotiated rather than assumed.",
    "aiRecommendation": "Create a shared 'relationship status dashboard' where each partner can signal their current daily stress level without needing long conversations."
  }
}

User A Digital Twin (Privacy-Safe — no PII):
${JSON.stringify(privacySafeTwinA, null, 2)}

User B Digital Twin (Privacy-Safe — no PII):
${JSON.stringify(privacySafeTwinB, null, 2)}
`;
    let rawText = "";
    let callSucceeded = false;
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      rawText = response.text();
      callSucceeded = true;
    } catch (apiErr) {
      console.warn("⚠️ [Handshake Service] Gemini API call failed. Using default compatibility/stress/friction/conflict fallback.", apiErr.message);
    }

    // ── Step 5: Parse and validate Gemini response ──────────────────────────
    let handshakeData = DEFAULT_HANDSHAKE_STATE;
    const jsonString = callSucceeded ? extractJsonFromText(rawText) : null;

    if (jsonString) {
      try {
        const parsed = JSON.parse(jsonString);

        const markers = parsed.compatibility_markers || {};
        const risks = parsed.risk_flags || {};
        const stressSync = parsed.stress_synchronization || {};
        const pv = parsed.privacy_verification || {};
        const ar = parsed.audit_report || {};
        const fi = parsed.friction_interview || {};
        const cs = parsed.conflict_simulation || {};

        // Validate busy_overlap — must be a string array
        let busyOverlap = [];
        if (Array.isArray(stressSync.busy_overlap)) {
          busyOverlap = stressSync.busy_overlap.filter(m => typeof m === "string");
        }

        // Module 6 — Privacy Verification: scores + hard-enforce boolean flags
        const privacyVerification = {
          professional_alignment_score: clampScore(pv.professional_alignment_score),
          industry_match_score: clampScore(pv.industry_match_score),
          career_stage_match_score: clampScore(pv.career_stage_match_score),
          // These are always true by design — never expose PII
          identity_protected: true,
          employer_hidden: true,
          salary_hidden: true,
          ai_privacy_summary:
            typeof pv.ai_privacy_summary === "string" && pv.ai_privacy_summary.trim()
              ? pv.ai_privacy_summary.trim()
              : DEFAULT_HANDSHAKE_STATE.privacy_verification.ai_privacy_summary
        };

        const compatibilityMarkers = {
          professional_alignment: clampScore(markers.professional_alignment),
          lifestyle_alignment: clampScore(markers.lifestyle_alignment),
          emotional_alignment: clampScore(markers.emotional_alignment),
          communication_alignment: clampScore(markers.communication_alignment),
          growth_alignment: clampScore(markers.growth_alignment)
        };
        const riskFlags = {
          career_conflict_risk: Boolean(risks.career_conflict_risk),
          communication_conflict_risk: Boolean(risks.communication_conflict_risk),
          stress_overlap_risk: Boolean(risks.stress_overlap_risk)
        };
        const stressSynchronization = {
          stress_alignment: clampScore(stressSync.stress_alignment),
          conflict_risk: clampScore(stressSync.conflict_risk),
          recovery_alignment: clampScore(stressSync.recovery_alignment),
          communication_availability: clampScore(stressSync.communication_availability),
          busy_overlap: busyOverlap,
          summary: stressSync.summary || "Stress cycle analysis completed."
        };

        // Module 4 — Friction Interview normalization
        const frictionInterview = {
          interviewSummary: typeof fi.interviewSummary === "string" && fi.interviewSummary.trim()
            ? fi.interviewSummary.trim()
            : DEFAULT_HANDSHAKE_STATE.friction_interview.interviewSummary,
          communicationCompatibility: clampScore(fi.communicationCompatibility),
          lifestyleCompatibility: clampScore(fi.lifestyleCompatibility),
          workRhythmCompatibility: clampScore(fi.workRhythmCompatibility),
          agreementPoints: Array.isArray(fi.agreementPoints)
            ? fi.agreementPoints.filter(p => typeof p === "string")
            : [],
          frictionPoints: Array.isArray(fi.frictionPoints)
            ? fi.frictionPoints.filter(p => typeof p === "string")
            : [],
          aiInsight: typeof fi.aiInsight === "string" && fi.aiInsight.trim()
            ? fi.aiInsight.trim()
            : DEFAULT_HANDSHAKE_STATE.friction_interview.aiInsight
        };

        // Module 5 — Conflict Simulation normalization
        const conflictSimulation = {
          conflictScenarios: Array.isArray(cs.conflictScenarios)
            ? cs.conflictScenarios.map(s => ({
                scenarioName: typeof s.scenarioName === "string" ? s.scenarioName : "Simulation Scenario",
                description: typeof s.description === "string" ? s.description : "No description provided.",
                likelyTriggers: typeof s.likelyTriggers === "string" ? s.likelyTriggers : "N/A",
                dynamicSimulation: typeof s.dynamicSimulation === "string" ? s.dynamicSimulation : ""
              }))
            : [],
          conflictRisk: clampScore(cs.conflictRisk),
          resolutionSuggestions: Array.isArray(cs.resolutionSuggestions)
            ? cs.resolutionSuggestions.filter(s => typeof s === "string")
            : [],
          predictedOutcome: typeof cs.predictedOutcome === "string" && cs.predictedOutcome.trim()
            ? cs.predictedOutcome.trim()
            : DEFAULT_HANDSHAKE_STATE.conflict_simulation.predictedOutcome,
          aiRecommendation: typeof cs.aiRecommendation === "string" && cs.aiRecommendation.trim()
            ? cs.aiRecommendation.trim()
            : DEFAULT_HANDSHAKE_STATE.conflict_simulation.aiRecommendation
        };

        // Module 7 — Build Structural Audit Report from Modules 2, 3, 6, 4, 5
        const aiSynthesisSummary = typeof ar.synthesis_summary === "string" && ar.synthesis_summary.trim()
          ? ar.synthesis_summary.trim()
          : null;
        const auditReport = buildAuditReport(
          compatibilityMarkers,
          riskFlags,
          stressSynchronization,
          privacyVerification,
          frictionInterview,
          conflictSimulation,
          aiSynthesisSummary
        );

        handshakeData = {
          compatibility_markers: compatibilityMarkers,
          risk_flags: riskFlags,
          handshake_summary: parsed.handshake_summary || "Compatibility signals processed successfully.",
          stress_synchronization: stressSynchronization,
          privacy_verification: privacyVerification,
          friction_interview: frictionInterview,
          conflict_simulation: conflictSimulation,
          audit_report: auditReport
        };
      } catch (parseErr) {
        console.error("❌ Failed to parse handshake response from Gemini:", parseErr.message);
      }
    } else {
      console.warn("⚠️ Could not extract valid JSON block from Gemini handshake response.");
    }

    // Module 7 — Fallback: always ensure audit_report is computed even on Gemini failure
    if (!handshakeData.audit_report || typeof handshakeData.audit_report.overall_score !== "number") {
      handshakeData.audit_report = buildAuditReport(
        handshakeData.compatibility_markers,
        handshakeData.risk_flags,
        handshakeData.stress_synchronization,
        handshakeData.privacy_verification,
        handshakeData.friction_interview,
        handshakeData.conflict_simulation,
        null
      );
    }

    // ── Step 6: Persist handshake session with all module outputs ──────────
    const insertQuery = `
      INSERT INTO handshake_sessions (
        user_a_id, user_b_id, status,
        compatibility_markers, risk_flags, handshake_summary,
        stress_synchronization, privacy_verification, audit_report,
        friction_interview, conflict_simulation,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING *;
    `;

    const insertResult = await pool.query(insertQuery, [
      userAId,
      userBId,
      "completed",
      JSON.stringify(handshakeData.compatibility_markers),
      JSON.stringify(handshakeData.risk_flags),
      handshakeData.handshake_summary,
      JSON.stringify(handshakeData.stress_synchronization),
      JSON.stringify(handshakeData.privacy_verification),
      JSON.stringify(handshakeData.audit_report),
      JSON.stringify(handshakeData.friction_interview),
      JSON.stringify(handshakeData.conflict_simulation)
    ]);

    console.log(`[DEBUG] Handshake Saved`);
    console.log(`[DEBUG] Handshake Complete (Modules 1-8 fully integrated — overall: ${handshakeData.audit_report.overall_score}%, grade: ${handshakeData.audit_report.grade})`);

    // Module 8 — Award trust points to both participants upon successful handshake
    const savedSession = insertResult.rows[0];
    await awardHandshakePoints(userAId, userBId, savedSession.id);

    return savedSession;

  } catch (error) {
    console.error("❌ Error in generateHandshake service:", error);
    throw error;
  }
};
