/**
 * sentimentAuditService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Sentiment & Tone Audit System — AI Interpretation Layer
 * Platform: Intentional Connection
 *
 * Responsibilities (Single):
 *   - Accept profile text / onboarding answers / prompts
 *   - Call Gemini to detect emotional tone, stress, burnout signals
 *   - Return a structured, validated sentiment audit object
 *
 * This service does NOT score compatibility — that stays in matchController.
 * This service does NOT re-rank suggestions — that stays in queryRefinementService.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── Configurable Scoring Weights ─────────────────────────────────────────────
// These weights are used by the compatibility engine (matchController) and
// re-ranking engine (queryRefinementService). They are defined here as the
// single source of truth so future tuning only requires one change.
export const SENTIMENT_WEIGHTS = {
  emotional_tone_match: 0.12, // 12% — primary tone alignment dimension
  emotional_resilience_bonus: 0.08, // 8%  — bonus for high-resilience partner match
  low_friction_bonus: 0.06, // 6%  — bonus for low-friction lifestyle match
};

// ── Allowed Values per Field ──────────────────────────────────────────────────
// Gemini must return exactly one of these for each field.
// Validated in validateAndNormalizeSentiment() below.
export const ALLOWED_SENTIMENT_VALUES = {
  primary_tone: [
    "Burned Out",
    "Frustrated",
    "Overwhelmed",
    "Anxious",
    "Lonely",
    "Stressed",
    "Melancholic",
    "Optimistic",
    "Balanced",
    "Calm",
    "Energetic",
    "Driven",
    "Content",
    "Uncertain",
  ],
  stress_level: ["Low", "Moderate", "High", "Critical"],
  emotional_energy: ["Low", "Moderate", "High"],
  social_capacity: ["Low", "Moderate", "High"],
  relationship_need: [
    "Emotional Stability",
    "Deep Connection",
    "Calm Companionship",
    "Space & Respect",
    "Adventure & Fun",
    "Intellectual Stimulation",
    "Consistent Support",
    "Independence",
    "Growth Together",
    "Warmth & Affection",
  ],
  emotional_resilience: ["Low", "Moderate", "High"],
  lifestyle_friction: ["Low", "Moderate", "High"],
  conflict_style: [
    "Avoidant",
    "Collaborative",
    "Assertive",
    "Passive",
    "Direct",
    "Reflective",
  ],
  stress_recovery_style: [
    "Solitude",
    "Social Connection",
    "Physical Activity",
    "Creative Outlets",
    "Routine & Structure",
    "Nature & Rest",
    "Conversation",
  ],
  communication_pressure: ["Low", "Moderate", "High"],
};

// ── Distress Tone Set ─────────────────────────────────────────────────────────
// If a user's primary_tone is in this set, sentiment-aware boosting is activated
// for their suggestions and compatibility scoring.
export const DISTRESS_TONES = new Set([
  "Burned Out",
  "Frustrated",
  "Overwhelmed",
  "Anxious",
  "Stressed",
  "Melancholic",
  "Lonely",
]);

// ── Tone → Recommended Partner Traits Mapping ─────────────────────────────────
// Used to enrich suggestions with explanation snippets and boost candidates
// whose profile traits align with what this user emotionally needs.
export const TONE_TO_PARTNER_TRAITS = {
  "Burned Out": [
    "High Emotional Resilience",
    "Calm Personality",
    "Low Friction Lifestyle",
    "Emotionally Stable",
    "Supportive Communicator",
  ],
  "Frustrated": [
    "Calm Personality",
    "Patient Communicator",
    "Low Drama Profile",
    "Emotionally Grounded",
    "Collaborative Conflict Style",
  ],
  "Overwhelmed": [
    "Low-Friction Lifestyle",
    "Calm Personality",
    "Emotionally Stable",
    "Consistent Support",
    "Stress-Aware Partner",
  ],
  "Anxious": [
    "Stable Communicator",
    "Emotionally Grounded",
    "Low Pressure Environment",
    "Consistent Presence",
    "Reassuring Partner",
  ],
  "Lonely": [
    "Emotionally Available",
    "Warm & Attentive",
    "Consistent Presence",
    "Deep Connection Focus",
    "Open & Expressive",
  ],
  "Stressed": [
    "Calm Personality",
    "Low-Friction Lifestyle",
    "Emotionally Stable",
    "Supportive Communicator",
  ],
  "Melancholic": [
    "Emotionally Available",
    "Warm & Attentive",
    "Patient Communicator",
    "Deep Connection Focus",
  ],
  "Optimistic": [],  // No special boost — standard matching
  "Balanced": [],
  "Calm": [],
  "Energetic": [],
  "Driven": [],
  "Content": [],
  "Uncertain": [
    "Consistent Presence",
    "Patient Communicator",
    "Emotionally Stable",
  ],
};

// ── Explanation Snippet Templates ─────────────────────────────────────────────
// Used in recommendation API responses (future: compatibility explanation UI).
// Extensible: add more templates as the system evolves.
export const EXPLANATION_SNIPPETS = {
  "Burned Out": "Recommended due to their calm, low-friction communication style.",
  "Frustrated": "This profile matches your preference for patient, grounded interaction.",
  "Overwhelmed": "Recommended for their emotionally stable and low-pressure lifestyle.",
  "Anxious": "This match offers consistent, reassuring communication patterns.",
  "Lonely": "Highly emotionally available and focused on deep connection.",
  "Stressed": "Their calm lifestyle and low communication pressure are a strong match.",
  "Melancholic": "Warm, attentive, and focused on meaningful emotional connection.",
  "Uncertain": "Patient and consistent — a steady presence for uncertain times.",
  default: "Compatibility recommended based on emotional tone alignment.",
};

// ── Safe Default Fallback ─────────────────────────────────────────────────────
// Returned when Gemini fails, input is empty, or parse fails.
// Never null — always a valid object so existing flows are never blocked.
export const DEFAULT_SENTIMENT_AUDIT = {
  primary_tone: "Balanced",
  stress_level: "Moderate",
  emotional_resilience: "Moderate",
  lifestyle_friction: "Moderate",
  distress_indicator: false,
  confidence_score: 0.50,
  analysis_summary: "Baseline emotional stability and balanced lifestyle pace.",
  audit_timestamp: new Date().toISOString(),
  communication_style: "Moderate",
  conflict_resolution_style: "Collaborative",

  // Backward compatibility fields
  emotional_energy: "Moderate",
  social_capacity: "Moderate",
  relationship_need: "Deep Connection",
  stress_recovery_style: "Routine & Structure",
  recommended_partner_traits: [],
  burnout_signals: [],
  is_default: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips markdown fences and extracts the first valid JSON block from text.
 * Mirrors the pattern used across geminiService.js and entityRecognitionService.js.
 */
const extractJsonFromText = (text) => {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
};

/**
 * Normalizes a string value: lowercase, trim, replace underscores.
 */
const normalizeStr = (s) =>
  String(s || "").toLowerCase().replace(/_/g, " ").trim();

/**
 * Case-insensitive fuzzy match against an allowed values list.
 * Returns the matched allowed value or the fallback default.
 */
const fuzzyMatch = (value, allowed, defaultVal) => {
  if (!value) return defaultVal;
  // Exact match first
  if (typeof value === "string" && allowed.includes(value.trim())) {
    return value.trim();
  }
  // Case-insensitive match
  const matched = allowed.find(
    (v) => normalizeStr(v) === normalizeStr(value)
  );
  return matched || defaultVal;
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTED FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates and normalizes a raw parsed Gemini response against ALLOWED_SENTIMENT_VALUES.
 * Falls back to defaults for any field that is missing, null, or invalid.
 *
 * @param {object} raw - Raw parsed JSON from Gemini
 * @returns {object} Fully validated sentiment audit object
 */
export const validateAndNormalizeSentiment = (raw) => {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SENTIMENT_AUDIT };
  }

  const primaryTone = fuzzyMatch(
    raw.primary_tone,
    ALLOWED_SENTIMENT_VALUES.primary_tone,
    DEFAULT_SENTIMENT_AUDIT.primary_tone
  );

  const stressLevel = fuzzyMatch(
    raw.stress_level,
    ALLOWED_SENTIMENT_VALUES.stress_level,
    DEFAULT_SENTIMENT_AUDIT.stress_level
  );

  const emotionalResilience = fuzzyMatch(
    raw.emotional_resilience,
    ALLOWED_SENTIMENT_VALUES.emotional_resilience,
    DEFAULT_SENTIMENT_AUDIT.emotional_resilience
  );

  const lifestyleFriction = fuzzyMatch(
    raw.lifestyle_friction,
    ALLOWED_SENTIMENT_VALUES.lifestyle_friction,
    DEFAULT_SENTIMENT_AUDIT.lifestyle_friction
  );

  const distressIndicator = isDistressTone(primaryTone);

  // Confidence Score: clamp 0.0 – 1.0
  let confidence = parseFloat(raw.confidence_score ?? raw.confidence ?? DEFAULT_SENTIMENT_AUDIT.confidence_score);
  if (isNaN(confidence)) confidence = DEFAULT_SENTIMENT_AUDIT.confidence_score;
  confidence = parseFloat(Math.min(1.0, Math.max(0.0, confidence)).toFixed(2));

  const analysisSummary = raw.analysis_summary || raw.ai_summary || `Profile exhibits a ${primaryTone} emotional tone with ${stressLevel} stress level and ${emotionalResilience} emotional resilience.`;

  const communicationStyle = raw.communication_style || raw.communication_pressure || "Moderate";
  const conflictResolutionStyle = raw.conflict_resolution_style || raw.conflict_style || "Collaborative";

  // Derive recommended_partner_traits from validated primary_tone if Gemini
  // didn't return them or returned an invalid array.
  const aiTraits = Array.isArray(raw.recommended_partner_traits)
    ? raw.recommended_partner_traits.filter((t) => typeof t === "string" && t.trim())
    : [];
  const mappedTraits = TONE_TO_PARTNER_TRAITS[primaryTone] || [];
  // Merge: AI-suggested traits first, then mapping defaults (de-duplicated)
  const mergedTraits = [...new Set([...aiTraits, ...mappedTraits])];

  const burnoutSignals = Array.isArray(raw.burnout_signals)
    ? raw.burnout_signals.filter((s) => typeof s === "string" && s.trim())
    : [];

  return {
    primary_tone: primaryTone,
    stress_level: stressLevel,
    emotional_resilience: emotionalResilience,
    lifestyle_friction: lifestyleFriction,
    distress_indicator: distressIndicator,
    confidence_score: confidence,
    analysis_summary: analysisSummary,
    audit_timestamp: raw.audit_timestamp || new Date().toISOString(),
    communication_style: communicationStyle,
    conflict_resolution_style: conflictResolutionStyle,

    // Backward compatibility fields
    emotional_energy: fuzzyMatch(
      raw.emotional_energy,
      ALLOWED_SENTIMENT_VALUES.emotional_energy,
      DEFAULT_SENTIMENT_AUDIT.emotional_energy
    ),
    social_capacity: fuzzyMatch(
      raw.social_capacity,
      ALLOWED_SENTIMENT_VALUES.social_capacity,
      DEFAULT_SENTIMENT_AUDIT.social_capacity
    ),
    relationship_need: fuzzyMatch(
      raw.relationship_need,
      ALLOWED_SENTIMENT_VALUES.relationship_need,
      DEFAULT_SENTIMENT_AUDIT.relationship_need
    ),
    stress_recovery_style: fuzzyMatch(
      raw.stress_recovery_style,
      ALLOWED_SENTIMENT_VALUES.stress_recovery_style,
      DEFAULT_SENTIMENT_AUDIT.stress_recovery_style
    ),
    recommended_partner_traits: mergedTraits,
    burnout_signals: burnoutSignals,
    is_default: false,
  };
};

/**
 * Returns whether a given primary_tone is in the distress set.
 * Used by matchController to decide whether to activate emotional boosting.
 *
 * @param {string} primaryTone
 * @returns {boolean}
 */
export const isDistressTone = (primaryTone) =>
  Boolean(primaryTone && DISTRESS_TONES.has(primaryTone));

/**
 * Returns the explanation snippet for a user's primary tone.
 * Used to enrich suggestion responses with human-readable context.
 *
 * @param {string} primaryTone
 * @returns {string}
 */
export const getExplanationSnippet = (primaryTone) =>
  EXPLANATION_SNIPPETS[primaryTone] || EXPLANATION_SNIPPETS.default;

/**
 * Builds the profile text context string for Gemini sentiment analysis.
 * Aggregates: about_me, prompts, onboarding answers, lifestyle text.
 *
 * @param {object|string} profileOrText - Full profile object OR raw text string
 * @param {object} [prompts]            - Optional Q&A prompts override
 * @returns {string}
 */
const buildSentimentProfileText = (profileOrText, prompts = null) => {
  if (!profileOrText) return "";

  if (typeof profileOrText === "string") {
    return profileOrText.trim();
  }

  const p = profileOrText;
  const parts = [];

  // About Me / Bio
  if (p.about_me) parts.push(`About Me: ${p.about_me}`);

  // Profession & work context
  if (p.profession) parts.push(`Profession: ${p.profession}`);
  if (p.work_environment) parts.push(`Work Environment: ${p.work_environment}`);

  // Relationship goals
  if (p.relationship_goal) parts.push(`Relationship Goal: ${p.relationship_goal}`);
  if (p.relationship_values) parts.push(`Relationship Values: ${p.relationship_values}`);

  // Life rhythms (emotional / social / work pace)
  const lr = p.life_rhythms_parsed || (() => {
    try { return typeof p.life_rhythms === "object" ? p.life_rhythms : JSON.parse(p.life_rhythms || "null"); }
    catch { return null; }
  })();
  if (lr) {
    if (lr.emotional_style) parts.push(`Emotional Style: ${lr.emotional_style}`);
    if (lr.social_energy) parts.push(`Social Energy: ${lr.social_energy}`);
    if (lr.life_pace) parts.push(`Life Pace: ${lr.life_pace}`);
    if (lr.work_rhythm) parts.push(`Work Rhythm: ${lr.work_rhythm}`);
    if (lr.communication_rhythm) parts.push(`Communication Rhythm: ${lr.communication_rhythm}`);
  }

  // Lifestyle preferences
  if (p.freetime_style) parts.push(`Freetime: ${p.freetime_style}`);
  if (p.health_activity_level) parts.push(`Health Activity: ${p.health_activity_level}`);

  // Q&A prompts (onboarding answers — rich source for tone signals)
  const activePrompts = prompts || p.prompts;
  if (activePrompts && typeof activePrompts === "object") {
    const qas = Object.entries(activePrompts)
      .filter(([, v]) => v && String(v).trim())
      .map(([k, v]) => `Q: ${k}\nA: ${v}`)
      .join("\n");
    if (qas) parts.push(`Profile Q&A:\n${qas}`);
  }

  return parts.join("\n").trim();
};

/**
 * Main AI Sentiment & Tone Analysis function.
 *
 * Calls Gemini with a structured prompt and returns a validated sentiment audit.
 * ALWAYS returns a valid object — never throws, never returns null.
 * If Gemini fails, the DEFAULT_SENTIMENT_AUDIT is returned (is_default: true).
 *
 * Audit log events emitted:
 *   ✅ SENTIMENT_AUDIT_SUCCESS — successful analysis
 *   ⚠️ SENTIMENT_AUDIT_FALLBACK — fallback used (with reason)
 *
 * @param {object|string} profileOrText - Full profile object OR raw text string
 * @param {object} [prompts]            - Optional Q&A prompts override
 * @returns {Promise<object>} Validated sentiment audit object
 */
export const analyzeSentimentAndTone = async (profileOrText, prompts = null) => {
  const profileText = buildSentimentProfileText(profileOrText, prompts);

  // ── Guard: empty input ───────────────────────────────────────────────────
  if (!profileText || profileText.trim().length < 10) {
    console.warn("⚠️ SENTIMENT_AUDIT_FALLBACK: Input text too short or empty. Returning defaults.");
    return { ...DEFAULT_SENTIMENT_AUDIT, fallback_reason: "empty_input" };
  }

  // ── Guard: skip if unchanged (Hash check) ────────────────────────────────
  const contentHash = crypto.createHash("sha256").update(profileText).digest("hex");
  if (profileOrText && typeof profileOrText === "object" && profileOrText.sentiment_audit) {
    let existingAudit = profileOrText.sentiment_audit;
    if (typeof existingAudit === "string") {
      try { existingAudit = JSON.parse(existingAudit); } catch { existingAudit = {}; }
    }
    if (existingAudit && existingAudit.profile_hash === contentHash) {
      console.log("ℹ️ [SENTIMENT_AUDIT_SKIPPED] Profile text unchanged. Skipping Gemini API call to save latency and costs.");
      return existingAudit;
    }
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // ── Gemini Prompt ────────────────────────────────────────────────────────
    const prompt = `You are an AI Sentiment & Emotional Tone Analysis Engine for a professional relationship compatibility platform called Intentional Connection.

Your task is to analyze a user's profile text, bio, lifestyle descriptions, and Q&A answers to detect their current emotional tone, stress state, and psychological needs.

STRICT OUTPUT RULES:
1. Return ONLY a single valid raw JSON object. No markdown, no code fences, no explanation.
2. All fields listed below MUST be present. Never return null or undefined values.
3. Values must exactly match the allowed options listed below.
4. Arrays must be valid JSON arrays of strings.
5. "confidence_score" must be a number between 0.00 and 1.00.

FIELD DEFINITIONS AND ALLOWED VALUES:

primary_tone (the dominant emotional state — pick the SINGLE best match):
  "Burned Out" | "Frustrated" | "Overwhelmed" | "Anxious" | "Lonely" |
  "Stressed" | "Melancholic" | "Optimistic" | "Balanced" | "Calm" |
  "Energetic" | "Driven" | "Content" | "Uncertain"

stress_level (overall perceived stress intensity):
  "Low" | "Moderate" | "High" | "Critical"

emotional_resilience (their own emotional resilience/recovery capacity):
  "Low" | "Moderate" | "High"

lifestyle_friction (how much friction or chaos is present in their life):
  "Low" | "Moderate" | "High"

confidence_score (how confident you are in this analysis based on text richness):
  0.90+ = rich, detailed bio with clear emotional signals
  0.70-0.89 = moderate clarity
  below 0.70 = vague or limited input

analysis_summary (a detailed paragraph describing the emotional landscape, tone justifications, and subtle stressors of this user):
  Write a warm, empathetic behavioral summary explaining their emotional state.

communication_style (how much communication feels like a demand or drain):
  "Low" | "Moderate" | "High"

conflict_resolution_style (how they tend to handle disagreements):
  "Avoidant" | "Collaborative" | "Assertive" | "Passive" | "Direct" | "Reflective"

emotional_energy (available emotional bandwidth):
  "Low" | "Moderate" | "High"

social_capacity (willingness and energy for social interaction):
  "Low" | "Moderate" | "High"

relationship_need (what this person most needs from a partner):
  "Emotional Stability" | "Deep Connection" | "Calm Companionship" |
  "Space & Respect" | "Adventure & Fun" | "Intellectual Stimulation" |
  "Consistent Support" | "Independence" | "Growth Together" | "Warmth & Affection"

stress_recovery_style (what helps them recover from stress):
  "Solitude" | "Social Connection" | "Physical Activity" |
  "Creative Outlets" | "Routine & Structure" | "Nature & Rest" | "Conversation"

recommended_partner_traits (array of 3-5 partner traits this user would benefit from):
  Use descriptive trait strings such as:
  "Calm Personality", "Emotionally Stable", "Low Friction Lifestyle",
  "High Emotional Resilience", "Patient Communicator", "Low Drama Profile",
  "Supportive Communicator", "Consistent Presence", "Emotionally Available",
  "Stable Communicator", "Warm & Attentive", "Grounded & Secure"

burnout_signals (array of 0-5 specific phrases or signals detected — empty array if none):
  Short descriptions of detected language patterns that suggest stress/burnout,
  e.g. ["mentions exhaustion", "uses overwhelmed language", "references work-life imbalance"]

DETECTION GUIDANCE:
- "Burned Out": Look for words like exhausted, drained, burned out, running on empty, need a break, overwhelmed by work
- "Frustrated": Look for words like annoyed, fed up, nothing works, tired of, not what I expected, disappointing
- "Overwhelmed": Too much, can't handle, drowning, too many things, life is chaotic
- "Anxious": Worried, nervous, uncertain about, scared, overthinking, what if
- "Lonely": Alone, isolated, missing connection, no one understands, longing for
- "Stressed": Pressure, deadline, busy, hectic, a lot going on, juggling
- "Balanced": Stable, doing well, managing, content, healthy pace, equilibrium
- "Optimistic": Excited, looking forward, hopeful, motivated, ready for

USER PROFILE TEXT:
"""
${profileText.trim()}
"""

Return EXACTLY this JSON structure (no other text):
{
  "primary_tone": "",
  "stress_level": "",
  "emotional_resilience": "",
  "lifestyle_friction": "",
  "confidence_score": 0.75,
  "analysis_summary": "",
  "communication_style": "",
  "conflict_resolution_style": "",
  
  "emotional_energy": "",
  "social_capacity": "",
  "relationship_need": "",
  "stress_recovery_style": "",
  "recommended_partner_traits": [],
  "burnout_signals": []
}`;

    console.log("🧠 SENTIMENT_AUDIT: Calling Gemini for tone analysis...");
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text();
    console.log("🧠 SENTIMENT_AUDIT: Gemini raw response length:", rawText.length);

    // ── Extract JSON block ───────────────────────────────────────────────────
    const jsonString = extractJsonFromText(rawText);
    if (!jsonString) {
      console.error("⚠️ SENTIMENT_AUDIT_FALLBACK: Could not locate JSON block in Gemini response.");
      return { ...DEFAULT_SENTIMENT_AUDIT, fallback_reason: "json_extraction_failed" };
    }

    // ── Parse JSON ───────────────────────────────────────────────────────────
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("⚠️ SENTIMENT_AUDIT_FALLBACK: JSON.parse failed:", parseError.message);
      return { ...DEFAULT_SENTIMENT_AUDIT, fallback_reason: "json_parse_failed" };
    }

    // ── Validate & Normalize ─────────────────────────────────────────────────
    const validated = validateAndNormalizeSentiment(parsed);
    validated.profile_hash = contentHash; // Track hash for future skips

    // ── Audit Log: Success ───────────────────────────────────────────────────
    console.log(`✅ SENTIMENT_AUDIT_SUCCESS: primary_tone=${validated.primary_tone}, stress=${validated.stress_level}, confidence=${validated.confidence_score}`);
    if (validated.burnout_signals.length > 0) {
      console.log(`   🔍 Burnout signals detected: ${validated.burnout_signals.join(", ")}`);
    }
    if (isDistressTone(validated.primary_tone)) {
      console.log(`   ⚡ Distress tone detected — emotional safety boosting will be activated for this user.`);
      console.log(`   💡 Recommended partner traits: ${validated.recommended_partner_traits.join(", ")}`);
    }

    return validated;

  } catch (error) {
    // ── Audit Log: Fallback ──────────────────────────────────────────────────
    console.error("⚠️ SENTIMENT_AUDIT_FALLBACK: Gemini API error:", error.message);
    console.warn("   → Existing recommendation flow will continue unaffected.");
    return {
      ...DEFAULT_SENTIMENT_AUDIT,
      fallback_reason: `gemini_error: ${error.message}`,
    };
  }
};
