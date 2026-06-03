/**
 * backfill_spider_real.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Recomputes spider_graph_data for ALL profiles (overwrites placeholders too)
 * using their actual NLP data already stored in the DB.
 * No new Gemini calls. Zero API cost.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import "dotenv/config";
import { pool } from "./config/db.js";
import { generateSpiderGraphData } from "./services/spiderGraphService.js";

const safeParseJson = (field) => {
  if (!field) return null;
  if (typeof field === "object" && !Array.isArray(field)) return field;
  if (typeof field === "string") {
    try { return JSON.parse(field); } catch { return null; }
  }
  return null;
};

// Detect placeholder values set by old backfill (85/60/90)
const isPlaceholder = (sgd) => {
  if (!sgd) return true;
  const obj = safeParseJson(sgd);
  if (!obj) return true;
  return (
    obj.professional_alignment === 85 &&
    obj.lifestyle_sync === 60 &&
    obj.emotional_readiness === 90 &&
    !obj.updated_at
  );
};

async function backfill() {
  console.log("🕸️  Real Spider Graph Backfill — Starting...\n");

  try {
    const { rows: profiles } = await pool.query(`
      SELECT
        user_id,
        intent_tags,
        contextual_tags,
        sentiment_audit,
        normalized_entities,
        spider_graph_data
      FROM profiles
      ORDER BY user_id ASC
    `);

    console.log(`📊 Total profiles found: ${profiles.length}\n`);

    let successCount = 0;
    let skippedCount = 0;
    let errorCount   = 0;

    for (const profile of profiles) {
      const userId = profile.user_id;

      // Skip profiles that already have real computed data
      if (!isPlaceholder(profile.spider_graph_data)) {
        console.log(`⏭️  user_id=${userId}: Already has real spider graph data — skipping.`);
        skippedCount++;
        continue;
      }

      try {
        const intent_tags         = safeParseJson(profile.intent_tags)         || {};
        const contextual_tags     = safeParseJson(profile.contextual_tags)     || {};
        const sentiment_audit     = safeParseJson(profile.sentiment_audit)     || {};
        const normalized_entities = safeParseJson(profile.normalized_entities) || {};

        const hasAnyData =
          Object.keys(intent_tags).length > 0 ||
          Object.keys(contextual_tags).length > 0 ||
          Object.keys(sentiment_audit).length > 0 ||
          Object.keys(normalized_entities).length > 0;

        let spider_graph_data;

        if (hasAnyData) {
          spider_graph_data = generateSpiderGraphData(
            intent_tags,
            contextual_tags,
            sentiment_audit,
            normalized_entities
          );
          console.log(`✅ user_id=${userId}: Professional=${spider_graph_data.professional_alignment}, Lifestyle=${spider_graph_data.lifestyle_sync}, Emotional=${spider_graph_data.emotional_readiness}`);
        } else {
          // No NLP data at all — use neutral fallback
          spider_graph_data = {
            professional_alignment: 60,
            lifestyle_sync:         60,
            emotional_readiness:    60,
            updated_at: new Date().toISOString(),
          };
          console.log(`⚠️  user_id=${userId}: No NLP data — set neutral fallback 60/60/60`);
        }

        await pool.query(
          `UPDATE profiles SET spider_graph_data = $1::jsonb WHERE user_id = $2`,
          [JSON.stringify(spider_graph_data), userId]
        );

        successCount++;
      } catch (err) {
        console.error(`❌ user_id=${userId}: ${err.message}`);
        errorCount++;
      }
    }

    console.log(`\n${"═".repeat(52)}`);
    console.log(`🕸️  Backfill Complete:`);
    console.log(`   ✅ Recomputed & saved  : ${successCount}`);
    console.log(`   ⏭️  Already real data   : ${skippedCount}`);
    console.log(`   ❌ Errors              : ${errorCount}`);
    console.log(`${"═".repeat(52)}\n`);

  } catch (err) {
    console.error("💥 Fatal error:", err.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

backfill();
