import { getSentimentHealthStats } from '../config/sentimentConfig.js';

/**
 * GET /api/health/sentiment
 * Returns the operational status and observability metrics 
 * of the Sentiment & Tone Audit feature.
 */
export const getSentimentHealth = (req, res) => {
  try {
    const stats = getSentimentHealthStats();
    return res.status(200).json(stats);
  } catch (err) {
    console.error("❌ [SENTIMENT_HEALTHCHECK_FAILED] Error in health endpoint:", err);
    return res.status(500).json({ status: "error", message: "Health check failed." });
  }
};
