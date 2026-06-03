import { DEFAULT_SENTIMENT_AUDIT, validateAndNormalizeSentiment, isDistressTone, getExplanationSnippet, analyzeSentimentAndTone, SENTIMENT_WEIGHTS } from '../services/sentimentAuditService.js';
import { getAdaptiveWeights, buildTemporarySemanticText, rescoreSuggestions } from '../services/queryRefinementService.js';
// Import removed for test isolation

console.log("=== SENTIMENT & TONE AUDIT VALIDATION SUITE ===");

// 1. Stress-Test Gemini Failure Handling
console.log("\n[1] Testing Failure Handling");
const emptyResult = validateAndNormalizeSentiment({});
console.log("Empty JSON fallback safe:", emptyResult.is_default && emptyResult.primary_tone === "Balanced");
const nullResult = validateAndNormalizeSentiment(null);
console.log("Null response fallback safe:", nullResult.is_default && nullResult.primary_tone === "Balanced");
const invalidResult = validateAndNormalizeSentiment({ primary_tone: "Screaming", stress_level: "Super High" });
console.log("Invalid fields fallback safe:", invalidResult.primary_tone === "Balanced" && invalidResult.stress_level === "Moderate");

// 2. Validate Score Balance
console.log("\n[2] Testing Score Balance");

// Mock calculating function from matchController logic
function mockScore(toneA, toneB, resB, frictionB) {
  const auditA = { primary_tone: toneA, emotional_resilience: "Moderate", lifestyle_friction: "Moderate" };
  const auditB = { primary_tone: toneB, emotional_resilience: resB, lifestyle_friction: frictionB };
  
  let tonalScore = 50;
  let boostApplied = null;
  const aIsDistressed = isDistressTone(toneA);
  const bIsDistressed = isDistressTone(toneB);

  if (aIsDistressed && resB === "High") {
    tonalScore = 88; boostApplied = "emotional_resilience_bonus";
  } else if (!aIsDistressed && !bIsDistressed && toneA === toneB) {
    tonalScore = 85; boostApplied = "tone_alignment";
  } else if (!aIsDistressed && !bIsDistressed) {
    tonalScore = 72;
  } else if (aIsDistressed && bIsDistressed) {
    tonalScore = 42; boostApplied = "dual_distress_flag";
  } else {
    tonalScore = 60;
  }

  if (aIsDistressed && frictionB === "Low") {
    tonalScore = Math.min(100, tonalScore + 6);
  }

  return { score: tonalScore, boost: boostApplied };
}

console.log("Normal vs Normal (Balanced):", mockScore("Balanced", "Balanced", "Moderate", "Moderate").score);
console.log("Burned Out vs Calm (High Res, Low Fric):", mockScore("Burned Out", "Calm", "High", "Low").score);
console.log("Anxious vs Stressed (Dual Distress):", mockScore("Anxious", "Stressed", "Moderate", "High").score);
console.log("Anxious vs Energetic (Moderate Res):", mockScore("Anxious", "Energetic", "Moderate", "Moderate").score);

// 3. Verify Explanation Consistency
console.log("\n[3] Testing Explanation Consistency");
console.log("Burned Out:", getExplanationSnippet("Burned Out"));
console.log("Frustrated:", getExplanationSnippet("Frustrated"));
console.log("Overwhelmed:", getExplanationSnippet("Overwhelmed"));
console.log("Optimistic (Default):", getExplanationSnippet("Optimistic"));

// 4. Confirm Query Refinement Behavior
console.log("\n[4] Testing Query Refinement");
const defaultWeights = getAdaptiveWeights([]);
const safetyWeights = getAdaptiveWeights(["emotional_safety"]);
console.log("Base emotional weight:", defaultWeights.emotional_tone_match);
console.log("Safety emotional weight:", safetyWeights.emotional_tone_match);
console.log("Weight difference:", (safetyWeights.emotional_tone_match - defaultWeights.emotional_tone_match).toFixed(2));

// Rescoring Test
const mockSuggestions = [
  { id: 1, compatibility_score: 80, local_scores: { vector_similarity: 80, emotional_tone_match: 60 } },
  { id: 2, compatibility_score: 75, local_scores: { vector_similarity: 70, emotional_tone_match: 95 } }
];
const rescored = rescoreSuggestions(mockSuggestions, safetyWeights);
console.log("Rescored order (User 2 should win due to high tone match):");
rescored.forEach(s => console.log(` User ${s.id} -> Score: ${s.compatibility_score} (was ${s.original_compatibility_score})`));

console.log("\n=== VALIDATION COMPLETE ===");
