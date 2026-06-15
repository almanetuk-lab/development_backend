import { pool } from '../config/db.js';
import { SENTIMENT_STATES, setSentimentState } from '../config/sentimentConfig.js';

/**
 * verifySentimentSchema
 * Runs at startup to ensure the required DB columns exist.
 * Disables the feature gracefully if missing, without crashing the server.
 */
export const verifySentimentSchema = async () => {
  console.log("🔍 [SENTIMENT_SCHEMA_VALIDATION] Checking DB schema requirements...");

  // If already disabled by env, just return
  if (process.env.ENABLE_SENTIMENT_AUDIT !== "true") {
    setSentimentState(SENTIMENT_STATES.DISABLED_BY_ENV, false);
    return false;
  }

  try {
    // Check if the sentiment_audit column exists in the profiles table
    const result = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='profiles' AND column_name='sentiment_audit'
    `);

    if (result.rows.length > 0) {
      console.log("✅ [SENTIMENT_SCHEMA_VALIDATION] Schema valid.");
      setSentimentState(SENTIMENT_STATES.ENABLED, true);
      return true;
    } else {
      console.error("❌ [SENTIMENT_SCHEMA_VALIDATION] Schema missing 'sentiment_audit' column. Disabling sentiment feature to prevent crashes.");
      setSentimentState(SENTIMENT_STATES.DISABLED_MISSING_SCHEMA, false);
      return false;
    }
  } catch (err) {
    console.error("❌ [SENTIMENT_HEALTHCHECK_FAILED] Error validating schema:", err.message);
    setSentimentState(SENTIMENT_STATES.DISABLED_VALIDATION_FAILURE, false);
    return false;
  }
};
