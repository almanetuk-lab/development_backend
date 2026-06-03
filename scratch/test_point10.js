import { recalculateUserVector } from "../services/vectorRecalculationService.js";
import { pool } from "../config/db.js";

async function testPoint10() {
  const userId = 9; // Same test user
  console.log("=== Testing Point 10: Spider Graph Data Generation ===");
  try {
    // We will clear the existing spider_graph_data first to prove it generates
    await pool.query("UPDATE profiles SET spider_graph_data = NULL WHERE user_id = $1", [userId]);
    console.log("Cleared old spider_graph_data.");

    const result = await recalculateUserVector(userId);
    console.log("Recalculation Pipeline Result:");
    console.log(`- Spider Graph Generated: ${result.stats.spider_graph_data}`);
    
    const check = await pool.query(
      `SELECT spider_graph_data FROM profiles WHERE user_id = $1`,
      [userId]
    );
    console.log("DB Updated spider_graph_data:");
    console.dir(check.rows[0].spider_graph_data, { depth: null });
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    process.exit(0);
  }
}

testPoint10();
