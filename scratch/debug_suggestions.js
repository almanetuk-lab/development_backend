import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runDebug() {
  console.log("=== AI SUGGESTIONS DEBUGGER ===");
  try {
    // 1. Check overall embedding status
    const countRes = await pool.query(`
      SELECT 
        COUNT(*) AS total_profiles,
        COUNT(intent_embedding) AS with_embeddings,
        COUNT(*) FILTER (WHERE intent_embedding IS NULL AND is_submitted = true) AS missing_embeddings_but_submitted
      FROM profiles
    `);
    console.log("1. Embedding Status:", countRes.rows[0]);

    // 2. Pick a test user who has an embedding
    const testUserRes = await pool.query(`
      SELECT user_id, first_name, intent_embedding 
      FROM profiles 
      WHERE intent_embedding IS NOT NULL 
      LIMIT 1
    `);
    
    if (testUserRes.rows.length === 0) {
      console.log("❌ CRITICAL: No users with intent_embedding found in the entire database!");
      return;
    }

    const testUser = testUserRes.rows[0];
    console.log(`\n2. Selected Test User: ${testUser.first_name} (ID: ${testUser.user_id})`);
    console.log(`   Vector Dimensions: ${testUser.intent_embedding.length}`); // Should be string representation, but just to check it exists

    // 3. Test exact matching query from matchController WITHOUT threshold
    const matchQueryAll = `
      SELECT
          user_id,
          first_name,
          intent_embedding <=> $1 AS distance
      FROM profiles
      WHERE
          user_id != $2
          AND intent_embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT 5;
    `;
    
    console.log("\n3. Testing vector distance WITHOUT the < 0.15 threshold:");
    const matchResAll = await pool.query(matchQueryAll, [testUser.intent_embedding, testUser.user_id]);
    
    if (matchResAll.rows.length === 0) {
      console.log("   No other users with embeddings found to compare against.");
    } else {
      console.table(matchResAll.rows.map(r => ({
        user_id: r.user_id,
        first_name: r.first_name,
        raw_distance: r.distance,
        converted_score: Math.round((1 - r.distance) * 100) + '%'
      })));
      
      const minDistance = matchResAll.rows[0].distance;
      console.log(`\n   The CLOSEST match has a distance of ${minDistance.toFixed(4)}.`);
      if (minDistance >= 0.15) {
         console.log("   🚨 BINGO: The threshold < 0.15 is TOO STRICT! This is why suggestions are empty.");
      } else {
         console.log("   ✅ Some matches DO meet the < 0.15 threshold.");
      }
    }

  } catch (err) {
    console.error("Debug Error:", err);
  } finally {
    await pool.end();
  }
}

runDebug();
