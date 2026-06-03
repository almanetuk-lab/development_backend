/**
 * backfill_spider.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Backfills spider_graph_data for ALL profiles in the database that currently
 * have null spider_graph_data, by computing real scores from their existing
 * NLP data (intent_tags, contextual_tags, sentiment_audit, normalized_entities).
 *
 * No new Gemini calls are made. Reuses data already stored in the DB.
 * ─────────────────────────────────────────────────────────────────────────────
 * Run: node backfill_spider.js
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

async function backfill() {
  console.log("🕸️  Spider Graph Backfill — Starting...\n");

  try {
    // Fetch all profiles (target only those missing spider_graph_data)
    const { rows: profiles } = await pool.query(`
      SELECT
        user_id,
        intent_tags,
        contextual_tags,
        sentiment_audit,
        normalized_entities
      FROM profiles
      WHERE spider_graph_data IS NULL
        OR spider_graph_data::text = 'null'
      ORDER BY user_id ASC
    `);

    console.log(`📊 Found ${profiles.length} profile(s) needing spider graph data.\n`);

    if (profiles.length === 0) {
      console.log("✅ All profiles already have spider_graph_data. Nothing to do.");
      process.exit(0);
    }

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const profile of profiles) {
      const userId = profile.user_id;

      try {
        const intent_tags        = safeParseJson(profile.intent_tags)        || {};
        const contextual_tags    = safeParseJson(profile.contextual_tags)    || {};
        const sentiment_audit    = safeParseJson(profile.sentiment_audit)    || {};
        const normalized_entities= safeParseJson(profile.normalized_entities)|| {};

        // Check if we have any real data to compute from
        const hasData =
          Object.keys(intent_tags).length > 0 ||
          Object.keys(contextual_tags).length > 0 ||
          Object.keys(sentiment_audit).length > 0 ||
          Object.keys(normalized_entities).length > 0;

        if (!hasData) {
          console.log(`⏭️  user_id=${userId}: No NLP data found — skipping (will use default 60/60/60 fallback).`);
          // Still set a default fallback so UI shows something
          const fallback = { professional_alignment: 60, lifestyle_sync: 60, emotional_readiness: 60, updated_at: new Date().toISOString() };
          await pool.query(
            `UPDATE profiles SET spider_graph_data = $1::jsonb WHERE user_id = $2`,
            [JSON.stringify(fallback), userId]
          );
          skipCount++;
          continue;
        }

        // Generate real scores using existing NLP data
        const spider_graph_data = generateSpiderGraphData(
          intent_tags,
          contextual_tags,
          sentiment_audit,
          normalized_entities
        );

        // Save to DB
        await pool.query(
          `UPDATE profiles SET spider_graph_data = $1::jsonb WHERE user_id = $2`,
          [JSON.stringify(spider_graph_data), userId]
        );

        console.log(`✅ user_id=${userId}: Professional=${spider_graph_data.professional_alignment}, Lifestyle=${spider_graph_data.lifestyle_sync}, Emotional=${spider_graph_data.emotional_readiness}`);
        successCount++;

      } catch (err) {
        console.error(`❌ user_id=${userId}: Error — ${err.message}`);
        errorCount++;
      }
    }

    console.log(`\n${"═".repeat(50)}`);
    console.log(`🕸️  Backfill Complete:`);
    console.log(`   ✅ Computed & saved : ${successCount}`);
    console.log(`   ⏭️  Fallback defaults : ${skipCount}`);
    console.log(`   ❌ Errors           : ${errorCount}`);
    console.log(`${"═".repeat(50)}\n`);

  } catch (err) {
    console.error("💥 Fatal backfill error:", err.message);
    console.error(err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

backfill();
