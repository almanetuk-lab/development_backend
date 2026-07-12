
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Allowed values for each field — used for validation and normalization
export const ALLOWED_VALUES = {
  ambition_level: ["High", "Moderate", "Relaxed"],
  stress_cycle: ["Busy", "Balanced", "Flexible"],
  social_preference: ["High Energy", "Moderate", "Low Energy"],
  communication_style: ["Calm", "Direct", "Deep", "Friendly"],
  relationship_intent: ["Meaningful", "Casual", "Serious"],
};

// Default safe fallback — returned when AI fails or response is unparseable
export const DEFAULT_INTENT_TAGS = {
  ambition_level: "Moderate",
  stress_cycle: "Balanced",
  social_preference: "Moderate",
  communication_style: "Friendly",
  relationship_intent: "Meaningful",
};

export const DEFAULT_CONFIDENCE_SCORE = 0.50;

// Allowed values for contextual tags
export const ALLOWED_CONTEXTUAL_VALUES = {
  city_energy: ["Fast-Paced", "Metropolitan", "Calm", "Suburban", "Moderate"],
  cost_of_living: ["High", "Moderate", "Low"],
  career_pressure: ["High", "Moderate", "Low"],
  commute_stress: ["Likely", "Unlikely", "Moderate"],
  social_environment: ["Urban Professional", "Selective", "Quiet", "Outgoing", "Balanced"],
  emotional_environment: ["Calm", "Intense", "Sensitive", "Balanced"],
  lifestyle_intensity: ["High Intensity", "Balanced", "Slow-Paced"],
};

// Default fallback for contextual tags
export const DEFAULT_CONTEXTUAL_TAGS = {
  city_energy: "Moderate",
  cost_of_living: "Moderate",
  career_pressure: "Moderate",
  commute_stress: "Moderate",
  social_environment: "Balanced",
  emotional_environment: "Balanced",
  lifestyle_intensity: "Balanced",
};

/**
 * Validates and normalizes a raw parsed object against ALLOWED_VALUES.
 * Falls back to defaults for any field that is missing or invalid.
 */
export const validateAndNormalize = (raw) => {
  const result = {};
  // Handle nested intent_tags or flat object if Gemini didn't nest it
  const rawTags = raw?.intent_tags || raw || {};

  for (const [field, allowed] of Object.entries(ALLOWED_VALUES)) {
    let value = rawTags?.[field];

    // Legacy support mapping
    if (value === undefined && field === "ambition_level") {
      value = rawTags?.ambition;
    }
    if (value === undefined && field === "relationship_intent") {
      value = rawTags?.relationship_intent || rawTags?.lifestyle_preference || rawTags?.relationship_goal;
    }

    if (typeof value === "string" && allowed.includes(value.trim())) {
      result[field] = value.trim();
    } else {
      // Try case-insensitive, space/underscore insensitive partial match
      const normalizeStr = (s) => String(s || "").toLowerCase().replace(/_/g, " ").trim();
      const matched = allowed.find(
        (v) => normalizeStr(v) === normalizeStr(value)
      );
      result[field] = matched || DEFAULT_INTENT_TAGS[field];
    }
  }
  return result;
};

/**
 * Validates and normalizes contextual tags raw parsed object.
 */
export const validateAndNormalizeContextual = (raw) => {
  const result = {};
  const rawTags = raw?.contextual_tags || raw || {};

  for (const [field, allowed] of Object.entries(ALLOWED_CONTEXTUAL_VALUES)) {
    const value = rawTags?.[field];
    if (typeof value === "string" && allowed.includes(value.trim())) {
      result[field] = value.trim();
    } else {
      const normalizeStr = (s) => String(s || "").toLowerCase().replace(/_/g, " ").trim();
      const matched = allowed.find(
        (v) => normalizeStr(v) === normalizeStr(value)
      );
      result[field] = matched || DEFAULT_CONTEXTUAL_TAGS[field];
    }
  }
  return result;
};

/**
 * Parses, clamps, and rounds the confidence score between 0 and 1 to 2 decimals.
 */
const parseConfidenceScore = (score) => {
  if (score === undefined || score === null) {
    return DEFAULT_CONFIDENCE_SCORE;
  }
  let parsed = typeof score === "number" ? score : parseFloat(score);
  if (isNaN(parsed)) {
    return DEFAULT_CONFIDENCE_SCORE;
  }
  // Clamp between 0.00 and 1.00
  parsed = Math.min(1.00, Math.max(0.00, parsed));
  // Round to 2 decimals
  return parseFloat(parsed.toFixed(2));
};

/**
 * Extracts the first valid JSON object from an arbitrary string.
 * Handles cases where Gemini wraps JSON in markdown or adds prose.
 */
const extractJsonFromText = (text) => {
  // Strip markdown fences first
  let cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // Find the first { ... } block
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  return cleaned.slice(start, end + 1);
};

export const extractIntentTags = async (profileOrAboutMe, prompts = null) => {
  let aboutMeText = "";
  let profileTextContext = "";

  if (profileOrAboutMe && typeof profileOrAboutMe === "object") {
    const p = profileOrAboutMe;
    aboutMeText = p.about_me || p.about || "";

    const parts = [];
    if (aboutMeText) parts.push(`About Me/Bio: ${aboutMeText}`);
    if (p.profession) parts.push(`Profession: ${p.profession}`);
    if (p.relationship_goal) parts.push(`Relationship Goal: ${p.relationship_goal}`);

    const activePrompts = prompts || p.prompts;
    if (activePrompts && typeof activePrompts === "object") {
      const qas = Object.entries(activePrompts)
        .map(([k, v]) => `Q: ${k} - A: ${v}`)
        .join("\n");
      if (qas) parts.push(`Q&A Prompts:\n${qas}`);
    }
    profileTextContext = parts.join("\n");
  } else {
    aboutMeText = profileOrAboutMe || "";
    profileTextContext = aboutMeText;
  }

  // Always return a safe object — never null
  if (!profileTextContext || profileTextContext.trim().length === 0) {
    console.warn("⚠️ extractIntentTags: empty or invalid input — returning defaults.");
    return {
      intent_tags: DEFAULT_INTENT_TAGS,
      confidence_score: DEFAULT_CONFIDENCE_SCORE,
    };
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are an AI Intent Interpretation Engine for a professional compatibility platform called Intentional Connection.

Analyze the user's profile details and return ONLY valid raw JSON. No markdown. No explanation. No extra text.

STRICT RULES:
1. Return ONLY a single JSON object with two fields: "intent_tags" (an object) and "confidence_score" (a number).
2. No markdown, no code fences, no backticks
3. No text before or after the JSON
4. Never return null or undefined values
5. All fields in "intent_tags" must be present
6. Values of "intent_tags" must exactly match the allowed options listed below
7. "confidence_score" must be a number between 0 and 1, rounded to 2 decimals

FIELDS AND ALLOWED VALUES FOR "intent_tags":
- ambition_level: "High" | "Moderate" | "Relaxed"
- stress_cycle: "Busy" | "Balanced" | "Flexible"
- social_preference: "High Energy" | "Moderate" | "Low Energy"
- communication_style: "Calm" | "Direct" | "Deep" | "Friendly"
- relationship_intent: "Meaningful" | "Casual" | "Serious"

INTERPRETATION GUIDE FOR "intent_tags":
- ambition_level: High = driven, career-focused, hustling. Moderate = balanced goals. Relaxed = easygoing, no-pressure.
- stress_cycle: Busy = packed schedule. Balanced = steady rhythm. Flexible = free and adaptable.
- social_preference: High Energy = loves crowds and events. Moderate = selective social. Low Energy = prefers quiet and depth.
- communication_style: Calm = gentle and patient. Direct = clear and no-nonsense. Deep = philosophical and thoughtful. Friendly = warm and approachable.
- relationship_intent: Meaningful = looking for depth. Casual = open and exploring. Serious = committed and future-focused.

CONFIDENCE SCORE LOGIC:
Evaluate the clarity, detail, and structure of the input profile context to assign a "confidence_score":
- 0.90+ → highly clear and structured bio or detailed Q&A answers (e.g., "I work long hours but value deep emotional connection" → 0.91)
- 0.70 to 0.89 → moderate clarity
- below 0.70 → vague or ambiguous profile (e.g., "I want partner" → 0.42)

User Profile Context:
"${profileTextContext.trim()}"

Return this exact JSON structure with no other text:
{
  "intent_tags": {
    "ambition_level": "",
    "stress_cycle": "",
    "social_preference": "",
    "communication_style": "",
    "relationship_intent": ""
  },
  "confidence_score": 0.50
}`;

    console.log("🤖 Calling Gemini for intent tags and confidence score...");
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text();
    console.log("🤖 Gemini RAW Response:", rawText);

    // Extract JSON block from response
    const jsonString = extractJsonFromText(rawText);
    if (!jsonString) {
      console.error("❌ Could not locate JSON block in Gemini response. Using defaults.");
      return { intent_tags: DEFAULT_INTENT_TAGS, confidence_score: DEFAULT_CONFIDENCE_SCORE };
    }
    console.log("🤖 Gemini EXTRACTED JSON string:", jsonString);

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("❌ JSON.parse failed on extracted string:", jsonString, parseError.message);
      return { intent_tags: DEFAULT_INTENT_TAGS, confidence_score: DEFAULT_CONFIDENCE_SCORE };
    }

    const intentTags = validateAndNormalize(parsed);
    const confidenceScore = parseConfidenceScore(parsed?.confidence_score);

    console.log("✅ Gemini Intent Tags VALIDATED:", intentTags);
    console.log("✅ Gemini Confidence Score VALIDATED:", confidenceScore);

    return { intent_tags: intentTags, confidence_score: confidenceScore };
  } catch (error) {
    console.error("❌ Gemini API Error in extractIntentTags:", error.message);
    return { intent_tags: DEFAULT_INTENT_TAGS, confidence_score: DEFAULT_CONFIDENCE_SCORE };
  }
};

/**
 * AI Contextual Metadata Enrichment Engine (Intentional Connection)
 * Infers environmental, location, career, and intensity tags based on profile context.
 */
export const enrichContextualMetadata = async (profileOrAboutMe, prompts = null) => {
  let profileText = "";

  if (profileOrAboutMe && typeof profileOrAboutMe === "object") {
    const p = profileOrAboutMe;
    const parts = [];
    if (p.about_me || p.about) parts.push(`About Me/Bio: ${p.about_me || p.about}`);
    if (p.profession) parts.push(`Profession: ${p.profession}`);
    if (p.company) parts.push(`Company: ${p.company}`);
    if (p.company_type) parts.push(`Company Type: ${p.company_type}`);
    if (p.city || p.state || p.country) parts.push(`Location: ${[p.city, p.state, p.country].filter(Boolean).join(", ")}`);
    if (p.relationship_goal) parts.push(`Relationship Goal: ${p.relationship_goal}`);
    if (p.relationship_values) parts.push(`Relationship Values: ${p.relationship_values}`);

    // Parse life rhythms if available
    const lr = p.life_rhythms_parsed || p.life_rhythms;
    let parsedLr = null;
    if (lr) {
      if (typeof lr === "object") parsedLr = lr;
      else { try { parsedLr = JSON.parse(lr); } catch { } }
    }
    if (parsedLr) {
      if (parsedLr.emotional_style) parts.push(`Emotional Style: ${parsedLr.emotional_style}`);
      if (parsedLr.social_energy) parts.push(`Social Energy: ${parsedLr.social_energy}`);
      if (parsedLr.life_pace) parts.push(`Life Pace: ${parsedLr.life_pace}`);
      if (parsedLr.work_rhythm) parts.push(`Work Rhythm: ${parsedLr.work_rhythm}`);
      if (parsedLr.communication_rhythm) parts.push(`Communication Rhythm: ${parsedLr.communication_rhythm}`);
    }

    // Parse prompts (Q&A)
    const activePrompts = prompts || p.prompts;
    if (activePrompts && typeof activePrompts === "object") {
      const qas = Object.entries(activePrompts)
        .map(([k, v]) => `Q: ${k} - A: ${v}`)
        .join("\n");
      if (qas) parts.push(`Q&A Prompts:\n${qas}`);
    }

    profileText = parts.join("\n");
  } else {
    profileText = profileOrAboutMe || "";
  }

  if (!profileText || profileText.trim().length === 0) {
    console.warn("⚠️ enrichContextualMetadata: empty profile text context — returning defaults.");
    return DEFAULT_CONTEXTUAL_TAGS;
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are an AI Contextual Metadata Enrichment Engine for a compatibility matching platform called Intentional Connection.

Your task is to analyze the user's profile details, bio, location, profession, lifestyle rhythm, and Q&A prompts.
You must infer additional implicit contextual intelligence tags, even if not explicitly written, based on social patterns, industry pressures, location dynamics, and psychological rhythm.

STRICT RULES:
1. Return ONLY a single valid raw JSON object. No markdown. No explanation. No extra text.
2. All fields listed below must be present. Never return null or undefined values.
3. No code fences, no backticks, no text before or after the JSON.
4. Values for each field must be chosen from the allowed options below.

CATEGORIES AND ALLOWED VALUES:
- city_energy: "Fast-Paced" | "Metropolitan" | "Calm" | "Suburban" | "Moderate"
- cost_of_living: "High" | "Moderate" | "Low"
- career_pressure: "High" | "Moderate" | "Low"
- commute_stress: "Likely" | "Unlikely" | "Moderate"
- social_environment: "Urban Professional" | "Selective" | "Quiet" | "Outgoing" | "Balanced"
- emotional_environment: "Calm" | "Intense" | "Sensitive" | "Balanced"
- lifestyle_intensity: "High Intensity" | "Balanced" | "Slow-Paced"

EXAMPLES OF CONTEXTUAL INFERENCES:
- Finance, Tech, Consulting, Law in Tier-1 cities (London, New York, Mumbai) -> city_energy: "Fast-Paced", cost_of_living: "High", career_pressure: "High", commute_stress: "Likely".
- Remote software engineers, creative writers, or artists -> commute_stress: "Unlikely", career_pressure: "Moderate".
- Highly structured or sensitive bios -> emotional_environment: "Sensitive" or "Calm".
- High ambition + busy schedules -> lifestyle_intensity: "High Intensity".

USER PROFILE CONTEXT:
${profileText}

Return this exact JSON structure with no other text:
{
  "city_energy": "",
  "cost_of_living": "",
  "career_pressure": "",
  "commute_stress": "",
  "social_environment": "",
  "emotional_environment": "",
  "lifestyle_intensity": ""
}`;

    console.log("🤖 Calling Gemini for contextual metadata enrichment...");
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text();
    console.log("🤖 Gemini Contextual Enriched RAW Response:", rawText);

    const jsonString = extractJsonFromText(rawText);
    if (!jsonString) {
      console.error("❌ Could not locate JSON block in Gemini contextual response. Using defaults.");
      return DEFAULT_CONTEXTUAL_TAGS;
    }
    console.log("🤖 Gemini EXTRACTED Contextual JSON string:", jsonString);

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("❌ JSON.parse failed on extracted contextual string:", jsonString, parseError.message);
      return DEFAULT_CONTEXTUAL_TAGS;
    }

    const contextualTags = validateAndNormalizeContextual(parsed);
    console.log("✅ Gemini Contextual Tags VALIDATED:", contextualTags);
    return contextualTags;
  } catch (error) {
    console.error("❌ Gemini API Error in enrichContextualMetadata:", error.message);
    return DEFAULT_CONTEXTUAL_TAGS;
  }
};

/**
 * Advanced AI Compatibility & Intent Matching Engine (Intentional Connection)
 *
 * @param {object} profileA       - Full profile object for User A (from fetchFullProfile)
 * @param {object} profileB       - Full profile object for User B (from fetchFullProfile)
 * @param {object} [localScores]  - Optional pre-computed local scores to anchor AI reasoning
 */
export const generateAICompatibility = async (profileA, profileB, localScores = null) => {
  // Helper to build robust local fallback report based on pre-computed local scores
  const generateLocalFallbackReport = (pA, pB, scoresObj) => {
    const vectorSim = scoresObj?.vector_similarity ?? 68;
    const tagMatch = scoresObj?.intent_tag_match ?? 70;
    const contextualMatch = scoresObj?.contextual_match ?? 70;
    const professionalMatch = scoresObj?.professional_alignment ?? 68;

    const overall = (scoresObj?.pre_computed_combined ?? Math.round(
      vectorSim * 0.3 + tagMatch * 0.3 + contextualMatch * 0.2 + professionalMatch * 0.2
    )) || 68;

    return {
      overall_compatibility: overall,
      compatibility_type: "Values-Focused Match",
      ai_match_summary: "Compatibility calculated using available profile data.",
      strengths: [
        vectorSim > 80 ? "High semantic profile alignment" : "Mutual intentional relationship focus",
        tagMatch > 60 ? "Overlapping psychological intent tags" : "Overlapping professional values",
        contextualMatch > 60 ? "Harmonious lifestyle and environment pacing" : "Open communication patterns"
      ].filter(Boolean),
      possible_challenges: [
        tagMatch < 40 ? "Slight differences in social preference and ambition levels" : "Balancing individual work schedules",
        (scoresObj?.lifestyle_rhythm ?? 50) < 40 ? "Adapting to different day-to-day rhythm paces" : "Adapting to differences in closeness rhythms"
      ].filter(Boolean),
      scores: {
        emotional_compatibility: scoresObj?.emotional_tone_match ?? tagMatch ?? 70,
        lifestyle_compatibility: scoresObj?.lifestyle_rhythm ?? 65,
        communication_compatibility: tagMatch ?? 70,
        relationship_alignment: scoresObj?.relationship_expectations ?? 72,
        professional_alignment: professionalMatch ?? 68,
        long_term_potential: overall ?? 65,
        social_compatibility: scoresObj?.personality_match ?? 68,
        values_alignment: vectorSim ?? 70,
        attraction_potential: scoresObj?.preference_match ?? 65,
      },
      relationship_dynamic: "Balanced and supportive relationship style",
      conversation_starters: [
        "What does an ideal slow evening look like to you?",
        "How do you like to express affection in a relationship?",
        "What is a personal project you are passionate about right now?",
      ],
    };
  };

  // 1. Audit Profile Completeness for User A and User B
  const auditCompleteness = (p, label) => {
    const missing = [];
    if (!p.about_me || p.about_me.trim() === "") missing.push("about_me");
    if (!p.intent_tags || Object.keys(p.intent_tags_parsed || {}).length === 0) missing.push("intent_tags");
    if (p.confidence_score === null || p.confidence_score === undefined) missing.push("confidence_score");
    if (!p.intent_embedding) missing.push("intent_embedding");
    if (!p.contextual_tags || Object.keys(p.contextual_tags_parsed || {}).length === 0) missing.push("contextual_tags");
    if (!p.normalized_entities || Object.keys(p.normalized_entities_parsed || {}).length === 0) missing.push("normalized_entities");

    const promptsCount = Object.keys(p.prompts || {}).length;
    if (promptsCount === 0) missing.push("profile_prompts");

    console.log(`📋 [Profile Completeness] User ${label} (ID: ${p.user_id}):`);
    console.log(`   → Completeness: ${((7 - missing.length) / 7 * 100).toFixed(0)}% (${7 - missing.length}/7 fields)`);
    console.log(`   → Missing fields: ${missing.length > 0 ? missing.join(", ") : "None"}`);
    return { missing, isComplete: missing.length === 0 };
  };

  console.log(`🧬 ─────────────────────────────────────────────────────────────`);
  console.log(`🧬 Running compatibility profile completeness audit...`);
  const completenessA = auditCompleteness(profileA, "A");
  const completenessB = auditCompleteness(profileB, "B");
  console.log(`🧬 ─────────────────────────────────────────────────────────────`);

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // ─── Format full profile details for AI contextualization ───────────────
    const formatProfileDetails = (p) => {
      const name = `${p.first_name || ""}`.trim() || p.username || "User";

      const safeParseJson = (field) => {
        if (!field) return null;
        if (typeof field === "object") return field;
        try { return JSON.parse(field); } catch { return null; }
      };

      // Parse all JSONB fields
      const lifeRhythms = p.life_rhythms_parsed || safeParseJson(p.life_rhythms) || {};
      const waysISpendTime = p.ways_i_spend_time_parsed || safeParseJson(p.ways_i_spend_time) || {};
      const selfExpression = safeParseJson(p.self_expression) || p.self_expression || "N/A";
      const professionalIdent = safeParseJson(p.professional_identity) || p.professional_identity || "N/A";
      const valuesInOthers = safeParseJson(p.values_in_others) || p.values_in_others || "N/A";
      const intentTags = p.intent_tags_parsed || safeParseJson(p.intent_tags) || {};
      const contextualTags = p.contextual_tags_parsed || safeParseJson(p.contextual_tags) || null;
      // Sentiment & Tone Audit data (new: emotional state awareness)
      const sentimentAudit = p.sentiment_audit_parsed || safeParseJson(p.sentiment_audit) || null;

      // Flatten prompts to readable text
      const prompts = p.prompts || {};
      const promptsText = Object.entries(prompts)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n") || "N/A";

      const details = {
        // ── Basic Identity ────────────────────────────────────────────────
        name,
        age: p.age || "N/A",
        gender: p.gender || "N/A",
        city: p.city || "N/A",
        zodiac_sign: p.zodiac_sign || "N/A",
        languages: p.languages_spoken || "N/A",

        // ── About & Bio ───────────────────────────────────────────────────
        about_me: p.about_me || "N/A",

        // ── Professional ─────────────────────────────────────────────────
        profession: p.profession || "N/A",
        company_type: p.company_type || "N/A",
        experience: p.experience || "N/A",
        professional_identity: professionalIdent,
        work_environment: p.work_environment || "N/A",
        work_rhythm: lifeRhythms.work_rhythm || p.work_rhythm || "N/A",
        career_decision_style: p.career_decision_style || "N/A",
        work_demand_response: p.work_demand_response || "N/A",

        // ── AI Intent Tags (Psychological Profile) ────────────────────────
        intent_tags: {
          ambition_level: intentTags.ambition_level || "N/A",
          stress_cycle: intentTags.stress_cycle || "N/A",
          social_preference: intentTags.social_preference || "N/A",
          communication_style: intentTags.communication_style || "N/A",
          relationship_intent: intentTags.relationship_intent || "N/A",
        },
        confidence_score: p.confidence_score || "N/A",

        // ── Emotional & Personality ───────────────────────────────────────
        emotional_style: lifeRhythms.emotional_style || "N/A",
        social_energy: lifeRhythms.social_energy || "N/A",
        life_pace: lifeRhythms.life_pace || "N/A",
        self_expression: selfExpression,

        // ── Lifestyle Rhythm ─────────────────────────────────────────────
        freetime_style: p.freetime_style || "N/A",   // ← FIXED: was p.free_time_style (bug)
        ways_i_spend_time: waysISpendTime,
        health_activity_level: p.health_activity_level || "N/A",
        pets_preference: p.pets_preference || "N/A",
        religious_belief: p.religious_belief || "N/A",
        smoking: p.smoking || "N/A",
        drinking: p.drinking || "N/A",

        // ── Interests & Hobbies ──────────────────────────────────────────
        interests: p.interests_parsed || safeParseJson(p.interests) || p.interests || "N/A",
        hobbies: p.hobbies_parsed || safeParseJson(p.hobbies) || p.hobbies || "N/A",
        values_in_others: valuesInOthers,

        // ── Relationship Expectations ─────────────────────────────────────
        relationship_goal: p.relationship_goal || "N/A",
        relationship_pace: p.relationship_pace || "N/A",
        relationship_values: p.relationship_values || "N/A",
        love_language_affection: p.love_language_affection || "N/A",
        preference_of_closeness: p.preference_of_closeness || "N/A",
        approach_to_physical_closeness: p.approach_to_physical_closeness || "N/A",
        children_preference: p.children_preference || "N/A",
        interested_in: p.interested_in || "N/A",

        // ── Contextual Metadata (Environmental / Career Intelligence) ──────
        contextual_metadata: contextualTags ? {
          city_energy: contextualTags.city_energy || "N/A",
          cost_of_living: contextualTags.cost_of_living || "N/A",
          career_pressure: contextualTags.career_pressure || "N/A",
          commute_stress: contextualTags.commute_stress || "N/A",
          social_environment: contextualTags.social_environment || "N/A",
          emotional_environment: contextualTags.emotional_environment || "N/A",
          lifestyle_intensity: contextualTags.lifestyle_intensity || "N/A",
        } : null,

        // ── Sentiment & Tone Audit (Emotional State Awareness) ─────────────
        // Tells the AI about each user's emotional tone, stress level, and
        // what kind of partner they psychologically need right now.
        sentiment_audit: sentimentAudit ? {
          primary_tone: sentimentAudit.primary_tone || "N/A",
          stress_level: sentimentAudit.stress_level || "N/A",
          emotional_energy: sentimentAudit.emotional_energy || "N/A",
          social_capacity: sentimentAudit.social_capacity || "N/A",
          relationship_need: sentimentAudit.relationship_need || "N/A",
          emotional_resilience: sentimentAudit.emotional_resilience || "N/A",
          lifestyle_friction: sentimentAudit.lifestyle_friction || "N/A",
          conflict_style: sentimentAudit.conflict_style || "N/A",
          stress_recovery_style: sentimentAudit.stress_recovery_style || "N/A",
          communication_pressure: sentimentAudit.communication_pressure || "N/A",
          recommended_partner_traits: sentimentAudit.recommended_partner_traits || [],
          burnout_signals: sentimentAudit.burnout_signals || [],
        } : null,

        // ── Normalized Professional Entities (NER) ────────────────────────
        normalized_entities: p.normalized_entities_parsed || safeParseJson(p.normalized_entities) || null,

        // ── Q&A Prompts (Question-Answer Form Data) ───────────────────────
        qa_prompts: promptsText,
      };

      return JSON.stringify(details, null, 2);
    };

    const strA = formatProfileDetails(profileA);
    const strB = formatProfileDetails(profileB);

    // ─── Build local scores context string for AI prompt ─────────────────
    let localScoresContext = "";
    if (localScores) {
      const fmt = (v) => (v !== null && v !== undefined ? `${v}%` : "N/A (insufficient data)");
      localScoresContext = `
PRE-COMPUTED LOCAL SCORES (Use these as data-anchored reference points — don't just echo them):
- Vector Semantic Similarity  : ${fmt(localScores.vector_similarity)}
- Intent Tag Field Match      : ${fmt(localScores.intent_tag_match)}
- Relationship Expectations   : ${fmt(localScores.relationship_expectations)}
- Lifestyle Rhythm            : ${fmt(localScores.lifestyle_rhythm)}
- Lifestyle Preferences       : ${fmt(localScores.preference_match)}
- Personality Match           : ${fmt(localScores.personality_match)}
- Contextual Environment Match: ${fmt(localScores.contextual_match)}
- Professional Alignment      : ${fmt(localScores.professional_alignment)}
- Pre-Computed Combined Score : ${fmt(localScores.pre_computed_combined)}
- Shared Q&A Prompts          : ${localScores.qa_overlap_count} out of ${localScores.qa_total_keys_a} / ${localScores.qa_total_keys_b}
- Avg AI Confidence           : ${localScores.avg_confidence}

These local scores are mathematically computed. Your AI scores should be directionally consistent with them
(within ±15%), but informed by your deeper psychological reasoning. Do not simply copy these values.
`;
    }

    const prompt = `You are an advanced AI Compatibility & Intent Matching Engine for the "Intentional Connection" platform.
Your task is to deeply analyze two user profiles and generate a detailed psychological compatibility report.

Analyze like a:
- Relationship Psychologist
- Behavioral Analyst
- Emotional Intelligence Expert
- Lifestyle Compatibility Expert
- Professional Compatibility Advisor

The analysis must feel human, emotionally intelligent, balanced, and realistic.

INPUT DATA:
- PROFILE A:
${strA}

- PROFILE B:
${strB}

${localScoresContext}

IMPORTANT ANALYSIS RULES:
1. Do NOT only compare exact matching values.
2. Understand emotional meaning behind answers.
3. Detect compatibility patterns across ALL data fields (including lifestyle rhythm, Q&A prompts, relationship expectations).
4. Detect conflicts and strengths.
5. Use behavioral reasoning.
6. Focus on long-term compatibility.
7. Detect intentional vs casual personalities.
8. Detect emotional maturity.
9. Analyze work-life compatibility.
10. Analyze communication rhythm.
11. Consider the Q&A prompts (qa_prompts field) as deeper personality windows.
12. Factor in lifestyle preferences (smoking, drinking, religion, health, pets) as compatibility signals.
13. Analyze the contextual_metadata block (city_energy, career_pressure, lifestyle_intensity, emotional_environment, social_environment) for each user. Identify environmental compatibility or stress mismatches — e.g., one user has High career_pressure in a Fast-Paced city while the other has a Slow-Paced lifestyle. Explain how this dynamic would play out in daily life and long-term relationship compatibility.
14. Analyze the normalized_entities block to evaluate professional alignment. Evaluate if their career tiers, industry clusters, work environments, and work intensities align or clash. High pressure executives might pair well together or need a calming partner. Explain professional dynamics.
15. SENTIMENT & EMOTIONAL TONE RULES (Critical — apply when sentiment_audit is present):
    a. Inspect the sentiment_audit block for each user. This reveals their current emotional state, stress level, and psychological needs.
    b. If User A has a distress tone (Burned Out / Frustrated / Overwhelmed / Anxious / Stressed / Lonely) AND User B has emotional_resilience = "High" or primary_tone = "Balanced" / "Calm" / "Optimistic": BOOST emotional_compatibility by 8-15 points. Explain why this pairing is emotionally complementary.
    c. If BOTH users have high stress_level or distress tones, flag this as a potential challenge (emotional bandwidth clash) but frame it with empathy and growth framing.
    d. If User A's recommended_partner_traits align with User B's actual emotional profile traits, explicitly mention this alignment in strengths.
    e. If burnout_signals are present for either user, reference them sensitively in the ai_match_summary.
    f. Use the relationship_need field to validate whether this match actually meets the emotional need. If it does, boost relationship_alignment. If not, note it as a gentle challenge.
    g. Always maintain an emotionally intelligent, warm, and non-clinical tone in the narrative output.

WEIGHT SYSTEM TO CALCULATE THE OVERALL COMPATIBILITY:
- Emotional Compatibility      → 20%
- Relationship Alignment       → 20%
- Communication Compatibility  → 15%
- Values Alignment             → 15%
- Lifestyle Compatibility      → 10%
- Long-Term Potential          → 10%
- Professional Alignment       → 5%
- Interests Similarity         → 5%

Calculate "overall_compatibility" as the weighted sum of these scores:
overall_compatibility = Math.round(
  emotional_compatibility * 0.20 + 
  relationship_alignment * 0.20 + 
  communication_compatibility * 0.15 + 
  values_alignment * 0.15 + 
  lifestyle_compatibility * 0.10 + 
  long_term_potential * 0.10 + 
  professional_alignment * 0.05 + 
  attraction_potential * 0.05
)

CONFLICT DETECTION:
Actively check for emotional mismatch, attachment mismatch, communication imbalance, lifestyle conflict,
ambition imbalance, social energy mismatch, and long-term goal conflict.
If conflicts exist, explain them calmly in the challenges section, suggest growth possibilities, and do not sound negative.

FINAL OUTPUT FORMAT:
Return ONLY valid raw JSON with NO markdown fences, no backticks, no markdown formatting, and no conversational preamble.

JSON SCHEMA TO RETURN:
{
  "overall_compatibility": 87,
  "scores": {
    "emotional_compatibility": 92,
    "lifestyle_compatibility": 81,
    "communication_compatibility": 88,
    "relationship_alignment": 91,
    "professional_alignment": 72,
    "long_term_potential": 90,
    "social_compatibility": 84,
    "values_alignment": 89,
    "attraction_potential": 80
  },
  "strengths": [
    "...",
    "...",
    "..."
  ],
  "possible_challenges": [
    "...",
    "..."
  ],
  "ai_match_summary": "These users appear highly compatible emotionally and psychologically...",
  "relationship_dynamic": "Calm, emotionally aware, growth-oriented connection",
  "compatibility_type": "Intentional Emotional Match",
  "conversation_starters": [
    "...",
    "...",
    "..."
  ]
}
`;

    console.log("🤖 Calling Gemini Matching Engine for psychological profiling...");
    console.log(`🤖 Gemini model: gemini-2.5-flash`);
    console.log(`🤖 Gemini Prompt length: ${prompt.length} chars`);

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text();
    console.log("🤖 Gemini matching response size:", rawText.length, "chars");

    const jsonString = extractJsonFromText(rawText);
    if (!jsonString) {
      console.warn("⚠️ extractJsonFromText: could not extract JSON from raw response.");
      throw new Error("Could not extract JSON block from Gemini matching response");
    }

    const parsed = JSON.parse(jsonString);
    console.log("✅ Successfully parsed Gemini JSON response!");

    // Structure validation and safe defaults
    const scores = parsed.scores || {};
    return {
      overall_compatibility: parsed.overall_compatibility || parsed.overall_score || 75,
      scores: {
        emotional_compatibility: scores.emotional_compatibility || 75,
        lifestyle_compatibility: scores.lifestyle_compatibility || 75,
        communication_compatibility: scores.communication_compatibility || 75,
        relationship_alignment: scores.relationship_alignment || 75,
        professional_alignment: scores.professional_alignment || 75,
        long_term_potential: scores.long_term_potential || 75,
        social_compatibility: scores.social_compatibility || 75,
        values_alignment: scores.values_alignment || 75,
        attraction_potential: scores.attraction_potential || 75,
      },
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [
        "Shared intentional communication preferences",
        "Aligned on deep core relationship goals",
        "Harmonious lifestyle pace",
      ],
      possible_challenges: Array.isArray(parsed.possible_challenges) ? parsed.possible_challenges : [
        "Slight differences in career energy",
        "Aligning on preferred socializing paces",
      ],
      ai_match_summary: parsed.ai_match_summary || "These profiles show a promising baseline alignment in communication and lifestyle intent.",
      relationship_dynamic: parsed.relationship_dynamic || "Thoughtful, emotionally aware connection",
      compatibility_type: parsed.compatibility_type || "Intentional Match",
      conversation_starters: Array.isArray(parsed.conversation_starters) ? parsed.conversation_starters : [
        "You both seem to value intentional conversations — what does a perfect meaningful weekend look like for you?",
        "What's something you've learned recently that changed your perspective?",
        "What helps you recharge mentally after a busy week?",
      ],
    };
  } catch (error) {
    console.error("❌ generateAICompatibility Error captured in catch block:", error.message || error);
    console.log("🛡️ ACTIVATING GRACEFUL COMPATIBILITY FALLBACK ENGINE (Local Data Anchored)");

    // Dynamic fallback generation using pre-computed scores so the client always succeeds
    const fallbackReport = generateLocalFallbackReport(profileA, profileB, localScores);
    console.log("🛡️ Successfully generated dynamic fallback report:", JSON.stringify(fallbackReport));
    return fallbackReport;
  }
};
