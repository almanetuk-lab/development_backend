import { pool } from '../config/db.js';
import { getSuggestions } from '../controller/matchController.js';

async function testSentimentRefactor() {
  console.log("🚀 Testing Sentiment & Tone Audit Refactor...");
  try {
    // 1. Verify that 'primary_tone' flat column is completely gone
    const columnsCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='profiles' AND column_name IN ('primary_tone', 'stress_level', 'lifestyle_friction')
    `);
    
    if (columnsCheck.rows.length === 0) {
      console.log("✅ Verified: All flat sentiment columns are dropped from profiles table.");
    } else {
      console.error("❌ Flat columns still exist!", columnsCheck.rows);
      process.exit(1);
    }

    // 2. Mock a request to test getSuggestions logic
    const testUserIdResult = await pool.query(`
      SELECT user_id FROM profiles WHERE intent_embedding IS NOT NULL AND is_submitted = true LIMIT 1
    `);

    if (testUserIdResult.rows.length > 0) {
      const testUserId = testUserIdResult.rows[0].user_id;
      console.log(`\nTesting getSuggestions for user_id: ${testUserId}`);
      
      const req = { user: { id: testUserId } };
      const res = {
        status: (code) => ({
          json: (data) => {
            console.log(`\n✅ getSuggestions Response (Status ${code}):`);
            if (Array.isArray(data)) {
              console.log(`Returned ${data.length} matches.`);
              if (data.length > 0) {
                console.log("Top Match Example:", {
                  name: data[0].name,
                  compatibility_score: data[0].compatibility_score,
                  sentiment_boost_score: data[0].sentiment_boost_score,
                  sentiment_match_explanation: data[0].sentiment_match_explanation
                });
              }
            } else {
              console.log("Data:", data);
            }
          }
        })
      };

      await getSuggestions(req, res);
    } else {
      console.log("⚠️ No active users found with embeddings to test suggestions.");
    }

  } catch (err) {
    console.error("❌ Refactor Test Failed:", err);
  } finally {
    await pool.end();
  }
}

testSentimentRefactor();
