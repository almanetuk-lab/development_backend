import { recalculateUserVector } from "../services/vectorRecalculationService.js";
import { pool } from "../config/db.js";

async function testPoint9() {
  const userId = 9;
  console.log("=== Testing Point 9: Real-Time Vector Recalculation ===");
  try {
    const result = await recalculateUserVector(userId);
    console.log("Result:", JSON.stringify(result, null, 2));

    const check = await pool.query(
      `SELECT intent_tags, contextual_tags, normalized_entities, sentiment_audit FROM profiles WHERE user_id = $1`,
      [userId]
    );
    console.log("DB Updated Values:", check.rows[0]);
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    process.exit(0);
  }
}

testPoint9();
