import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { extractProfessionalEntities } from '../services/entityRecognitionService.js';
import { buildSemanticProfileText, generateEmbedding } from '../services/embeddingService.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runBackfill() {
  console.log("=== STARTING NER BACKFILL ===");
  try {
    // Select profiles that have been submitted but are missing normalized_entities
    const res = await pool.query(`
      SELECT p.*
      FROM profiles p
      WHERE p.is_submitted = true 
        AND p.normalized_entities IS NULL
    `);
    
    const profilesToFix = res.rows;
    console.log(`Found ${profilesToFix.length} profiles missing NER data.`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < profilesToFix.length; i++) {
      const p = profilesToFix[i];
      console.log(`[${i+1}/${profilesToFix.length}] Processing user_id: ${p.user_id} (${p.first_name || 'Unknown'})`);
      
      try {
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

        // 1. NER Extraction
        console.log(`   🤖 Extracting NER...`);
        const normalized_entities = await extractProfessionalEntities(p, prompts);
        
        // 2. Re-generate Embedding with new NER data
        console.log(`   🤖 Re-generating Embedding...`);
        const safeParseJson = (f) => {
          if (!f) return null;
          if (typeof f === "object" && !Array.isArray(f)) return f;
          try { return JSON.parse(f); } catch { return null; }
        };
        const profileForEmbedding = {
          ...p,
          contextual_tags_parsed: safeParseJson(p.contextual_tags),
          normalized_entities_parsed: normalized_entities,
        };
        
        const semanticText = buildSemanticProfileText(profileForEmbedding, safeParseJson(p.intent_tags));
        const intent_embedding = await generateEmbedding(semanticText);

        if (!intent_embedding) {
          console.log(`   ❌ Failed to generate embedding for ${p.user_id}`);
          failCount++;
          continue;
        }

        // 3. Save
        await pool.query(`
          UPDATE profiles
          SET 
            normalized_entities = $1::jsonb,
            intent_embedding = $2::vector,
            updated_at = NOW()
          WHERE user_id = $3
        `, [
          JSON.stringify(normalized_entities),
          JSON.stringify(intent_embedding),
          p.user_id
        ]);

        console.log(`   ✅ Success! Saved NER + updated vector for user ${p.user_id}`);
        successCount++;

        // Sleep to avoid hitting Gemini rate limits (Wait 4.5 seconds = 13 RPM)
        await new Promise(r => setTimeout(r, 4500));
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
