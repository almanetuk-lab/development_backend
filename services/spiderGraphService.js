/**
 * spiderGraphService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Point #10 — Prompt-to-Spider-Graph Translation
 *
 * Converts NLP outputs (intent_tags, contextual_tags, sentiment_audit, normalized_entities)
 * into numeric scores (0-100) for three key spider graph dimensions:
 *   1. Professional Alignment
 *   2. Lifestyle Sync
 *   3. Emotional Readiness
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SCORING_MAPS = {
  ambition: { "Low": 30, "Moderate": 65, "High": 90, "Driven": 100 },
  careerTier: { "Entry-Level": 40, "Mid-Level": 65, "Senior/Manager": 85, "Executive/Founder": 100, "Professional/Specialist": 80 },
  lifestyleIntensity: { "Low Intensity": 30, "Balanced": 65, "High Intensity": 90 },
  socialPreference: { "Low": 30, "Moderate": 65, "High": 90 },
  relationshipIntent: { "Casual": 30, "Meaningful": 65, "Serious/Long-Term": 90, "Marriage": 100, "Supportive": 85 },
  emotionalResilience: { "Low": 30, "Moderate": 65, "High": 90 }
};

/**
 * Calculates a score by averaging valid values from a list.
 * @param {Array<number>} values 
 * @param {number} fallback 
 * @returns {number}
 */
const calculateAverage = (values, fallback = 50) => {
  const valid = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (valid.length === 0) return fallback;
  const sum = valid.reduce((a, b) => a + b, 0);
  return Math.round(sum / valid.length);
};

/**
 * Generates spider graph data from NLP tags.
 *
 * @param {object} intent_tags 
 * @param {object} contextual_tags 
 * @param {object} sentiment_audit 
 * @param {object} normalized_entities 
 * @returns {object} { professional_alignment, lifestyle_sync, emotional_readiness }
 */
export const generateSpiderGraphData = (
  intent_tags = {},
  contextual_tags = {},
  sentiment_audit = {},
  normalized_entities = {}
) => {
  // 1. Professional Alignment
  const ambitionScore = SCORING_MAPS.ambition[intent_tags?.ambition_level];
  const careerTierScore = SCORING_MAPS.careerTier[normalized_entities?.career_tier];
  
  const professional_alignment = calculateAverage([ambitionScore, careerTierScore], 60);

  // 2. Lifestyle Sync
  const lifestyleScore = SCORING_MAPS.lifestyleIntensity[contextual_tags?.lifestyle_intensity];
  const socialScore = SCORING_MAPS.socialPreference[intent_tags?.social_preference];
  
  const lifestyle_sync = calculateAverage([lifestyleScore, socialScore], 60);

  // 3. Emotional Readiness
  const relationshipScore = SCORING_MAPS.relationshipIntent[intent_tags?.relationship_intent];
  const resilienceScore = SCORING_MAPS.emotionalResilience[sentiment_audit?.emotional_resilience];
  
  // Also factor in stress level (lower stress = higher readiness)
  let stressPenalty = 0;
  if (sentiment_audit?.stress_level === "High") stressPenalty = -15;
  if (sentiment_audit?.stress_level === "Moderate") stressPenalty = -5;
  if (sentiment_audit?.stress_level === "Low") stressPenalty = 10;

  let emotional_readiness = calculateAverage([relationshipScore, resilienceScore], 60) + stressPenalty;
  
  // Clamp between 0 and 100
  emotional_readiness = Math.max(0, Math.min(100, emotional_readiness));

  return {
    professional_alignment,
    lifestyle_sync,
    emotional_readiness,
    updated_at: new Date().toISOString()
  };
};
