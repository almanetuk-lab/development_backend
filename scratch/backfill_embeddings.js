import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { extractIntentTags, enrichContextualMetadata } from '../services/geminiService.js';
import { buildSemanticProfileText, generateEmbedding } from '../services/embeddingService.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runBackfill() {
  console.log("=== STARTING BATCH EMBEDDING BACKFILL ===");
  try {
    const res = await pool.query(`
      SELECT user_id, first_name, about_me, profession, relationship_goal, 
             company, company_type, city, state, country, relationship_values, 
             life_rhythms, id
      FROM profiles 
      WHERE is_submitted = true 
        AND intent_embedding IS NULL
    `);
    
    const profilesToFix = res.rows;
    console.log(`Found ${profilesToFix.length} profiles missing embeddings.`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < profilesToFix.length; i++) {
      const p = profilesToFix[i];
      console.log(`[${i+1}/${profilesToFix.length}] Processing user_id: ${p.user_id} (${p.first_name || 'Unknown'})`);
      
      try {
        // Skip if no basic text available at all
        if (!p.about_me && !p.profession) {
           console.log(`   ⏭️ Skipping user ${p.user_id} - no about_me or profession.`);
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
        p.prompts = prompts;

        // 1. Tags
        const { intent_tags, confidence_score } = await extractIntentTags(p, p.prompts);
        
        // 2. Contextual
        const contextual_tags = await enrichContextualMetadata(p, p.prompts);
        
        // 3. Embedding
        const fullProfile = {
          ...p,
          contextual_tags_parsed: contextual_tags,
          prompts: p.prompts
        };
        const semanticText = buildSemanticProfileText(fullProfile, intent_tags);
        const intent_embedding = await generateEmbedding(semanticText);

        if (!intent_embedding) {
          console.log(`   ❌ Failed to generate embedding for ${p.user_id}`);
          failCount++;
          continue;
        }

        // 4. Save
        await pool.query(`
          UPDATE profiles
          SET 
            intent_tags = $1::jsonb,
            confidence_score = $2::float8,
            intent_embedding = $3::vector,
            contextual_tags = $4::jsonb,
            updated_at = NOW()
          WHERE user_id = $5
        `, [
          JSON.stringify(intent_tags),
          confidence_score,
          JSON.stringify(intent_embedding),
          JSON.stringify(contextual_tags),
          p.user_id
        ]);

        console.log(`   ✅ Success! Saved vector + tags for user ${p.user_id}`);
        successCount++;

        // Sleep to avoid hitting Gemini rate limits
        await new Promise(r => setTimeout(r, 2000));
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
