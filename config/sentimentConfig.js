/**
 * sentimentConfig.js
 * Centralized feature flag and runtime state management for the Sentiment Audit feature.
 */

// Possible runtime states
export const SENTIMENT_STATES = {
  ENABLED: "ENABLED",
  DISABLED_BY_ENV: "DISABLED_BY_ENV",
  DISABLED_MISSING_SCHEMA: "DISABLED_MISSING_SCHEMA",
  DISABLED_VALIDATION_FAILURE: "DISABLED_VALIDATION_FAILURE",
};

let currentState = process.env.ENABLE_SENTIMENT_AUDIT === "true" 
  ? SENTIMENT_STATES.ENABLED 
  : SENTIMENT_STATES.DISABLED_BY_ENV;

let lastValidationAt = null;
let schemaValid = false;
let geminiAvailable = !!process.env.GEMINI_API_KEY;

export const setSentimentState = (newState, isValidSchema = false) => {
  currentState = newState;
  schemaValid = isValidSchema;
  lastValidationAt = new Date().toISOString();
  
  if (newState === SENTIMENT_STATES.ENABLED) {
    console.log("🟢 [SENTIMENT_FEATURE] State: ENABLED");
  } else {
    console.log(`🟡 [SENTIMENT_FEATURE_DISABLED] State: ${newState}`);
  }
};

export const isSentimentAuditEnabled = () => {
  return currentState === SENTIMENT_STATES.ENABLED;
};

export const getSentimentHealthStats = () => {
  return {
    enabled: isSentimentAuditEnabled(),
    schema_valid: schemaValid,
    gemini_available: geminiAvailable,
    fallback_mode: !isSentimentAuditEnabled(),
    last_validation_at: lastValidationAt,
    status: isSentimentAuditEnabled() ? "healthy" : "degraded (fallback active)"
  };
};
