import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { analyzeSentimentAndTone } from '../services/sentimentAuditService.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runBackfill() {
  console.log("=== STARTING BATCH SENTIMENT AUDIT BACKFILL ===");
  try {
    // Select submitted profiles that haven't been audited yet
    const res = await pool.query(`
      SELECT *
      FROM profiles 
      WHERE is_submitted = true 
        AND sentiment_analyzed_at IS NULL
    `);
    
    const profilesToFix = res.rows;
    console.log(`Found ${profilesToFix.length} profiles needing a sentiment audit.`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < profilesToFix.length; i++) {
      const p = profilesToFix[i];
      console.log(`[${i+1}/${profilesToFix.length}] Processing user_id: ${p.user_id} (${p.first_name || 'Unknown'})`);
      
      try {
        // Skip if no basic text available at all
        if (!p.about_me && !p.profession && !p.life_rhythms) {
           console.log(`   ⏭️ Skipping user ${p.user_id} - insufficient profile text.`);
           failCount++;
           continue;
        }

        // Fetch Prompts
        const promptsResult = await pool.query(
          `SELECT question_key, answer FROM profile_prompts WHERE profile_id = $1`,
          [p.id]
        );
        const prompts = {};
        for (const row of promptsResult.rows) {
          prompts[row.question_key] = row.answer;
        }
        
        // 1. Run AI Audit
        const sentiment_audit = await analyzeSentimentAndTone(p, prompts);

        // 2. Save
        const updateQuery = `
          UPDATE profiles
          SET 
            sentiment_audit          = $1::jsonb,
            primary_tone             = $2,
            stress_level             = $3,
            emotional_energy         = $4,
            social_capacity          = $5,
            relationship_need        = $6,
            emotional_resilience     = $7,
            lifestyle_friction       = $8,
            conflict_style           = $9,
            stress_recovery_style    = $10,
            communication_pressure   = $11,
            sentiment_analyzed_at    = NOW(),
            updated_at               = NOW()
          WHERE user_id = $12
        `;
        
        await pool.query(updateQuery, [
          JSON.stringify(sentiment_audit),
          sentiment_audit.primary_tone           || null,
          sentiment_audit.stress_level           || null,
          sentiment_audit.emotional_energy       || null,
          sentiment_audit.social_capacity        || null,
          sentiment_audit.relationship_need      || null,
          sentiment_audit.emotional_resilience   || null,
          sentiment_audit.lifestyle_friction     || null,
          sentiment_audit.conflict_style         || null,
          sentiment_audit.stress_recovery_style  || null,
          sentiment_audit.communication_pressure || null,
          p.user_id
        ]);

        console.log(`   ✅ Success! Saved sentiment audit for user ${p.user_id} (Tone: ${sentiment_audit.primary_tone})`);
        successCount++;

        // Sleep to avoid hitting Gemini rate limits (2.5 seconds)
        await new Promise(r => setTimeout(r, 2500));
      } catch (err) {
        console.log(`   ❌ Error on user ${p.user_id}: ${err.message}`);
        failCount++;
      }
    }

    console.log(`\n=== BACKFILL COMPLETE ===`);
    console.log(`Successfully generated: ${successCount}`);
    console.log(`Failed / Skipped: ${failCount}`);

  } catch (err) {
    console.error("Backfill Script Error:", err);
  } finally {
    await pool.end();
  }
}

runBackfill();
