import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Builds a rich, normalized semantic string from a user's full profile.
 *
 * Accepts either:
 *   - buildSemanticProfileText(profileObj, intentTags)  ← NEW preferred form
 *   - buildSemanticProfileText(profession, aboutMe, intentTags) ← OLD form, still works
 *
 * The richer the text, the better the vector embedding and cosine matching.
 */
export const buildSemanticProfileText = (profileOrProfession, aboutMeOrIntentTags, intentTagsLegacy) => {
  const parts = [];

  // ── Detect call signature ────────────────────────────────────────────────
  let profile       = null;
  let profession    = null;
  let aboutMe       = null;
  let intentTags    = null;

  if (profileOrProfession && typeof profileOrProfession === "object" && !Array.isArray(profileOrProfession)) {
    // NEW: (profileObj, intentTags)
    profile    = profileOrProfession;
    intentTags = aboutMeOrIntentTags?.intent_tags || aboutMeOrIntentTags || null;
    profession = profile.profession || null;
    aboutMe    = profile.about_me   || null;
  } else {
    // LEGACY: (profession, aboutMe, intentTags)
    profession = profileOrProfession || null;
    aboutMe    = aboutMeOrIntentTags || null;
    intentTags = intentTagsLegacy?.intent_tags || intentTagsLegacy || null;
  }

  // ── Core identity ────────────────────────────────────────────────────────
  if (profession && String(profession).trim()) {
    parts.push(String(profession).trim());
  }

  // ── Intent tags (psychological dimensions) ───────────────────────────────
  const tags = intentTags;
  if (tags) {
    if (tags.ambition_level)      parts.push(`${tags.ambition_level} Ambition`);
    if (tags.stress_cycle)        parts.push(`${tags.stress_cycle} Stress Cycle`);
    if (tags.communication_style) parts.push(`${tags.communication_style} Communication Style`);
    if (tags.relationship_intent) parts.push(`${tags.relationship_intent} Relationship Intent`);
    if (tags.social_preference)   parts.push(`${tags.social_preference} Social Preference`);
  }

  // ── Relationship expectations ────────────────────────────────────────────
  if (profile) {
    const safeParseJson = (f) => {
      if (!f) return null;
      if (typeof f === "object" && !Array.isArray(f)) return f;
      try { return JSON.parse(f); } catch { return null; }
    };

    // ── Normalized entities (NER) ────────────────────────────────────────────
    const ner = profile.normalized_entities_parsed || safeParseJson(profile.normalized_entities);
    if (ner) {
      if (ner.career_tier) parts.push(`Career Tier: ${ner.career_tier}`);
      if (ner.industry_cluster) parts.push(`Industry: ${ner.industry_cluster}`);
      if (ner.professional_cluster) parts.push(`Profession Cluster: ${ner.professional_cluster}`);
      if (ner.seniority_level) parts.push(`Seniority: ${ner.seniority_level}`);
      if (ner.work_environment) parts.push(`Work Environment: ${ner.work_environment}`);
      if (ner.income_band_estimate) parts.push(`Income Band: ${ner.income_band_estimate}`);
      if (ner.career_stability) parts.push(`Career Stability: ${ner.career_stability}`);
      if (ner.work_intensity) parts.push(`Work Intensity: ${ner.work_intensity}`);
    }

    // ── Contextual tags (implicit/environmental dimensions) ─────────────────
    const cTags = profile.contextual_tags_parsed || safeParseJson(profile.contextual_tags);
    if (cTags) {
      if (cTags.city_energy)           parts.push(`City Energy: ${cTags.city_energy}`);
      if (cTags.cost_of_living)        parts.push(`Cost of Living: ${cTags.cost_of_living}`);
      if (cTags.career_pressure)       parts.push(`Career Pressure: ${cTags.career_pressure}`);
      if (cTags.commute_stress)        parts.push(`Commute Stress: ${cTags.commute_stress}`);
      if (cTags.social_environment)    parts.push(`Social Environment: ${cTags.social_environment}`);
      if (cTags.emotional_environment) parts.push(`Emotional Environment: ${cTags.emotional_environment}`);
      if (cTags.lifestyle_intensity)   parts.push(`Lifestyle Intensity: ${cTags.lifestyle_intensity}`);
    }

    if (profile.relationship_goal)  parts.push(`Goal: ${profile.relationship_goal}`);
    if (profile.relationship_pace)  parts.push(`Pace: ${profile.relationship_pace}`);
    if (profile.relationship_values) parts.push(`Values: ${profile.relationship_values}`);
    if (profile.love_language_affection) parts.push(`Love Language: ${profile.love_language_affection}`);
    if (profile.children_preference) parts.push(`Children: ${profile.children_preference}`);
    if (profile.interested_in)      parts.push(`Interested in: ${profile.interested_in}`);

    const lifeRhythms = profile.life_rhythms_parsed || safeParseJson(profile.life_rhythms);
    if (lifeRhythms) {
      if (lifeRhythms.emotional_style)  parts.push(`Emotional: ${lifeRhythms.emotional_style}`);
      if (lifeRhythms.social_energy)    parts.push(`Social Energy: ${lifeRhythms.social_energy}`);
      if (lifeRhythms.life_pace)        parts.push(`Life Pace: ${lifeRhythms.life_pace}`);
      if (lifeRhythms.work_rhythm)      parts.push(`Work Rhythm: ${lifeRhythms.work_rhythm}`);
    }

    // ── Personality / flat columns ────────────────────────────────────────
    if (profile.work_environment)    parts.push(`Work: ${profile.work_environment}`);
    if (profile.health_activity_level) parts.push(`Health: ${profile.health_activity_level}`);
    if (profile.religious_belief)    parts.push(`Religion: ${profile.religious_belief}`);
    if (profile.freetime_style)      parts.push(`Freetime: ${profile.freetime_style}`);

    // ── Interests / Hobbies ──────────────────────────────────────────────
    const interests = profile.interests_parsed || safeParseJson(profile.interests);
    const hobbies   = profile.hobbies_parsed   || safeParseJson(profile.hobbies);
    if (interests) {
      const interestStr = typeof interests === "string" ? interests : JSON.stringify(interests);
      if (interestStr && interestStr !== "{}") parts.push(`Interests: ${interestStr}`);
    }
    if (hobbies) {
      const hobbiesStr = typeof hobbies === "string" ? hobbies : JSON.stringify(hobbies);
      if (hobbiesStr && hobbiesStr !== "{}") parts.push(`Hobbies: ${hobbiesStr}`);
    }

    // ── Q&A prompts (brief semantic inclusion) ────────────────────────────
    const prompts = profile.prompts || {};
    const promptValues = Object.values(prompts).filter(Boolean).slice(0, 5); // top 5 answers
    if (promptValues.length > 0) {
      parts.push(`Answers: ${promptValues.join(". ")}`);
    }
  }

  const tagsString = parts.join(", ");

  // ── About Me bio (appended at end for maximum embedding influence) ───────
  if (aboutMe && String(aboutMe).trim().length > 0) {
    return `${tagsString}. Bio: ${String(aboutMe).trim()}`;
  }

  return tagsString;
};

/**
 * Generates a 768-dimensional vector embedding for a given text using Gemini text-embedding.
 */
export const generateEmbedding = async (text) => {
  if (!text || text.trim().length === 0) {
    console.warn("⚠️ generateEmbedding: empty text provided, returning null.");
    return null;
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-embedding-2" });

    console.log("🤖 Calling Gemini for text embedding...");
    const result = await model.embedContent({
      content: { parts: [{ text }] },
      outputDimensionality: 768,
    });
    const embedding = result.embedding.values;

    if (!embedding || !Array.isArray(embedding)) {
      console.error("❌ Invalid embedding format returned from Gemini.");
      return null;
    }

    console.log(`✅ Gemini Embedding Generated successfully. Dimension: ${embedding.length}`);
    return embedding;
  } catch (error) {
    console.error("❌ Gemini Embedding API Error:", error.message);
    return null;
  }
};
