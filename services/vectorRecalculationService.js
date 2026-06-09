/**
 * vectorRecalculationService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Point #9 — Real-Time Vector Recalculation for Intentional Connection
 * Platform: Intentional Connection
 *
 * Responsibilities:
 *   - Provide a shared deduplication lock (per-user) to prevent concurrent
 *     embedding generation for the same user (e.g., rapid profile saves).
 *   - Expose a standalone `recalculateUserVector(userId)` that runs the FULL
 *     AI pipeline and atomically saves results to DB. This is used by:
 *       • Background / admin backfill jobs
 *       • Any future endpoint that needs to trigger recalculation outside of
 *         the profile update flow.
 *   - `hasRecalculatableData(profileData)` — broadened trigger check used by
 *     profileController to decide whether to run the AI pipeline.
 *
 * The inline profile-update pipeline in profileController already handles the
 * "immediate response with fresh AI data" case. This service handles:
 *   1. Deduplication (shared lock across all callers)
 *   2. Standalone re-run from DB (for admin tools, backfill, etc.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { pool }                        from "../config/db.js";
import { extractIntentTags,
         enrichContextualMetadata }    from "./geminiService.js";
import { buildSemanticProfileText,
         generateEmbedding }           from "./embeddingService.js";
import { extractProfessionalEntities } from "./entityRecognitionService.js";
import { analyzeSentimentAndTone }     from "./sentimentAuditService.js";
import { isSentimentAuditEnabled }     from "../config/sentimentConfig.js";
import { generateSpiderGraphData }     from "./spiderGraphService.js";
import { upsertUserVector } from "./pineconeService.js";

// ── Deduplication Guard ──────────────────────────────────────────────────────
// Stores the user IDs that are currently mid-recalculation.
// If a second call arrives for the same user while one is in progress,
// it is skipped immediately with skipped=true (never rejected or errored).
const _activeRecalculations = new Set();

/**
 * Acquires the recalculation lock for a given userId.
 * Returns true if the lock was acquired, false if it was already held.
 *
 * @param {number|string} userId
 * @returns {boolean}
 */
export const acquireRecalcLock = (userId) => {
  const key = String(userId);
  if (_activeRecalculations.has(key)) {
    return false; // already locked
  }
  _activeRecalculations.add(key);
  return true;
};

/**
 * Releases the recalculation lock for a given userId.
 * Always safe to call even if the lock was not held.
 *
 * @param {number|string} userId
 */
export const releaseRecalcLock = (userId) => {
  _activeRecalculations.delete(String(userId));
};

/**
 * Returns whether a recalculation is currently in progress for a user.
 *
 * @param {number|string} userId
 * @returns {boolean}
 */
export const isRecalculationInProgress = (userId) =>
  _activeRecalculations.has(String(userId));

// ── Trigger Condition ────────────────────────────────────────────────────────

/**
 * Determines whether a given profile data snapshot has enough content
 * to warrant running the full AI recalculation pipeline.
 *
 * This is deliberately broad: any field that influences intent, lifestyle,
 * rhythm, social preference, stress cycle, sentiment, or profession
 * triggers recalculation.
 *
 * @param {object} profileData - Partial or full profile fields from the request
 * @returns {boolean}
 */
export const hasRecalculatableData = (profileData) => {
  if (!profileData || typeof profileData !== "object") return false;

  const {
    about_me,
    profession,
    prompts,
    relationship_goal,
    relationship_values,
    life_rhythms,
    work_environment,
    work_rhythm,
    health_activity_level,
    religious_belief,
    freetime_style,
    smoking,
    drinking,
    city,
    company,
    company_type,
    interested_in,
    relationship_pace,
    love_language_affection,
    self_expression,
    career_decision_style,
    work_demand_response,
  } = profileData;

  return !!(
    (about_me            && String(about_me).trim().length > 0)            ||
    (profession          && String(profession).trim().length > 0)          ||
    (prompts             && typeof prompts === "object" && Object.keys(prompts).length > 0) ||
    (relationship_goal   && String(relationship_goal).trim().length > 0)   ||
    (relationship_values && String(relationship_values).trim().length > 0) ||
    (life_rhythms        && typeof life_rhythms === "object" && Object.keys(life_rhythms).length > 0) ||
    (life_rhythms        && typeof life_rhythms === "string" && life_rhythms.trim().length > 2) ||
    (work_environment    && String(work_environment).trim().length > 0)    ||
    (work_rhythm         && String(work_rhythm).trim().length > 0)         ||
    (health_activity_level && String(health_activity_level).trim().length > 0) ||
    (religious_belief    && String(religious_belief).trim().length > 0)    ||
    (freetime_style      && String(freetime_style).trim().length > 0)      ||
    (smoking             && String(smoking).trim().length > 0)             ||
    (drinking            && String(drinking).trim().length > 0)            ||
    (city                && String(city).trim().length > 0)                ||
    (company             && String(company).trim().length > 0)             ||
    (company_type        && String(company_type).trim().length > 0)        ||
    (interested_in       && String(interested_in).trim().length > 0)       ||
    (relationship_pace   && String(relationship_pace).trim().length > 0)   ||
    (love_language_affection && String(love_language_affection).trim().length > 0) ||
    (self_expression     && String(self_expression).trim().length > 0)     ||
    (career_decision_style && String(career_decision_style).trim().length > 0) ||
    (work_demand_response  && String(work_demand_response).trim().length > 0)
  );
};

// ── DB Helpers ───────────────────────────────────────────────────────────────

/**
 * Fetches the full profile for a userId from the DB, including Q&A prompts.
 * Returns null if no profile is found.
 *
 * @param {number|string} userId
 * @returns {Promise<object|null>}
 */
const _fetchProfileForRecalculation = async (userId) => {
  const profileResult = await pool.query(
    `SELECT * FROM profiles WHERE user_id = $1`,
    [userId]
  );

  if (!profileResult.rows.length) {
    console.warn(`⚠️  [VectorRecalc] No profile found in DB for user_id ${userId}`);
    return null;
  }

  const profile = profileResult.rows[0];

  // Attach Q&A prompts
  const promptsResult = await pool.query(
    `SELECT question_key, answer FROM profile_prompts WHERE profile_id = $1`,
    [profile.id]
  );
  const prompts = {};
  for (const row of promptsResult.rows) {
    prompts[row.question_key] = row.answer;
  }
  profile.prompts = prompts;

  return profile;
};

// ── Main Recalculation Function ──────────────────────────────────────────────

/**
 * Runs the full AI vector recalculation pipeline for a given userId.
 *
 * Pipeline steps:
 *   1. Fetch profile + prompts from DB
 *   2. NER — normalized professional entities
 *   3. Intent tags + confidence score
 *   4. Contextual metadata enrichment
 *   5. Sentiment audit (if feature flag enabled)
 *   6. Semantic profile text → 768-dim embedding
 *   7. Atomic DB UPDATE of all AI fields
 *   8. Compatibility cache invalidation
 *
 * Deduplication: if a recalculation is already in progress for this user,
 * the call is skipped immediately (skipped: true) without error.
 *
 * Error handling: all AI steps are individually try/catched so a failure in
 * one step does NOT abort the others. Only a fatal DB error returns success=false.
 *
 * @param {number|string} userId        - Target user ID
 * @param {object} [inlineProfile]      - Optional in-memory profile (skip DB fetch)
 * @param {object} [inlinePrompts]      - Optional in-memory prompts (skip DB fetch)
 * @returns {Promise<{
 *   success: boolean,
 *   skipped: boolean,
 *   error:   string|null,
 *   stats:   object|null
 * }>}
 */
export const recalculateUserVector = async (
  userId,
  inlineProfile = null,
  inlinePrompts = null
) => {
  const uid = String(userId);

  // ── Deduplication Check ──────────────────────────────────────────────────
  if (!acquireRecalcLock(uid)) {
    console.log(
      `⏭️  [VectorRecalc] SKIPPED — recalculation already in progress for user ${uid}.`
    );
    return { success: false, skipped: true, error: null, stats: null };
  }

  const startTime = Date.now();
  console.log(`\n🔄 [VectorRecalc] ${"═".repeat(52)}`);
  console.log(`🔄 [VectorRecalc] Starting full pipeline for user ${uid}`);

  // Track what was successfully generated
  const stats = {
    normalized_entities: false,
    intent_tags:         false,
    contextual_tags:     false,
    sentiment_audit:     false,
    intent_embedding:    false,
    embedding_dimensions: 0,
    db_updated:          false,
    cache_invalidated:   false,
    cache_rows_deleted:  0,
    duration_ms:         0,
  };

  try {
    // ── Step 1: Fetch / validate profile ─────────────────────────────────────
    let profile = inlineProfile;
    let prompts = inlinePrompts || {};

    if (!profile) {
      console.log(`📥 [VectorRecalc] Step 1: Fetching profile from DB...`);
      profile = await _fetchProfileForRecalculation(userId);
      if (!profile) {
        return { success: false, skipped: false, error: "Profile not found in DB", stats };
      }
      prompts = profile.prompts || {};
    } else {
      console.log(`📥 [VectorRecalc] Step 1: Using inline profile data (skipping DB fetch)`);
    }

    // Build compact profile data object for all AI services
    const profileData = {
      about_me:             profile.about_me,
      profession:           profile.profession,
      company:              profile.company,
      company_type:         profile.company_type,
      city:                 profile.city,
      state:                profile.state,
      country:              profile.country,
      relationship_goal:    profile.relationship_goal,
      relationship_values:  profile.relationship_values,
      life_rhythms:         profile.life_rhythms,
      work_environment:     profile.work_environment,
      work_rhythm:          profile.work_rhythm,
      health_activity_level:profile.health_activity_level,
      religious_belief:     profile.religious_belief,
      freetime_style:       profile.freetime_style,
    };

    // ── Step 2: NER — Normalized Professional Entities ────────────────────────
    let normalized_entities = null;
    console.log(`🤖 [VectorRecalc] Step 2: Extracting NER entities...`);
    try {
      normalized_entities = await extractProfessionalEntities(profileData, prompts);
      stats.normalized_entities = true;
      console.log(`   ✓ NER: career_tier=${normalized_entities?.career_tier}, industry=${normalized_entities?.industry_cluster}`);
    } catch (nerErr) {
      console.error(`   ✗ NER extraction failed (non-fatal):`, nerErr.message);
    }

    // ── Step 3: Intent Tags + Confidence Score ────────────────────────────────
    let intent_tags      = null;
    let confidence_score = null;
    console.log(`🤖 [VectorRecalc] Step 3: Extracting intent tags...`);
    try {
      const geminiResult = await extractIntentTags(profileData, prompts);
      intent_tags      = geminiResult.intent_tags;
      confidence_score = geminiResult.confidence_score;
      stats.intent_tags = true;
      console.log(`   ✓ Intent tags: ${JSON.stringify(intent_tags)}`);
      console.log(`   ✓ Confidence score: ${confidence_score}`);
    } catch (intentErr) {
      console.error(`   ✗ Intent tag extraction failed (non-fatal):`, intentErr.message);
    }

    // ── Step 4: Contextual Metadata Enrichment ────────────────────────────────
    let contextual_tags = null;
    console.log(`🤖 [VectorRecalc] Step 4: Enriching contextual metadata...`);
    try {
      contextual_tags = await enrichContextualMetadata(profileData, prompts);
      stats.contextual_tags = true;
      console.log(`   ✓ Contextual: city_energy=${contextual_tags?.city_energy}, pressure=${contextual_tags?.career_pressure}`);
    } catch (ctxErr) {
      console.error(`   ✗ Contextual metadata failed (non-fatal):`, ctxErr.message);
    }

    // ── Step 5: Sentiment Audit (feature-flag gated) ──────────────────────────
    let sentiment_audit = null;
    if (isSentimentAuditEnabled()) {
      console.log(`🧠 [VectorRecalc] Step 5a: Running sentiment audit...`);
      try {
        sentiment_audit = await analyzeSentimentAndTone(profile, prompts);
        stats.sentiment_audit = true;
        console.log(`   ✓ Sentiment: tone=${sentiment_audit?.primary_tone}, stress=${sentiment_audit?.stress_level}, resilience=${sentiment_audit?.emotional_resilience}`);
        if (sentiment_audit?.is_default) {
          console.log(`   ⚠️  Sentiment returned DEFAULT values (Gemini fallback or empty input)`);
        }
      } catch (sentErr) {
        console.error(`   ✗ Sentiment audit failed (non-fatal):`, sentErr.message);
      }
    } else {
      console.log(`ℹ️  [VectorRecalc] Step 5a: Sentiment audit SKIPPED (ENABLE_SENTIMENT_AUDIT not true)`);
    }

    // ── Step 5b: Semantic Text + Embedding ───────────────────────────────────
    let intent_embedding = null;
    console.log(`🤖 [VectorRecalc] Step 5b: Building semantic text & embedding...`);
    try {
      const fullProfileForEmbedding = {
        ...profileData,
        contextual_tags_parsed:   contextual_tags,
        normalized_entities,
        relationship_pace:        profile.relationship_pace,
        love_language_affection:  profile.love_language_affection,
        children_preference:      profile.children_preference,
        interested_in:            profile.interested_in,
        health_activity_level:    profile.health_activity_level,
        religious_belief:         profile.religious_belief,
        freetime_style:           profile.freetime_style,
        interests_parsed:         typeof profile.interests === "object" ? profile.interests : null,
        hobbies_parsed:           typeof profile.hobbies   === "object" ? profile.hobbies   : null,
        prompts,
      };

      const semanticText = buildSemanticProfileText(fullProfileForEmbedding, intent_tags);
      console.log(`   📝 Semantic text length: ${semanticText?.length || 0} chars`);

      if (semanticText && semanticText.trim().length > 0) {
        intent_embedding = await generateEmbedding(semanticText);
        if (intent_embedding && Array.isArray(intent_embedding)) {
          stats.intent_embedding    = true;
          stats.embedding_dimensions = intent_embedding.length;
          console.log(`   ✓ Embedding generated: ${intent_embedding.length} dimensions`);
        } else {
          console.warn(`   ⚠️  Embedding returned null or invalid format`);
        }
      } else {
        console.warn(`   ⚠️  Semantic text empty — embedding skipped`);
      }
    } catch (embedErr) {
      console.error(`   ✗ Embedding generation failed:`, embedErr.message);
    }

    // ── Step 5c: Generate Spider Graph Data (Point #10) ───────────────────────
    let spider_graph_data = null;
    console.log(`🕸️  [VectorRecalc] Step 5c: Generating Spider Graph Data...`);
    try {
      spider_graph_data = generateSpiderGraphData(
        intent_tags,
        contextual_tags,
        sentiment_audit,
        normalized_entities
      );
      stats.spider_graph_data = true;
      console.log(`   ✓ Spider Graph: Professional=${spider_graph_data.professional_alignment}, Lifestyle=${spider_graph_data.lifestyle_sync}, Emotional=${spider_graph_data.emotional_readiness}`);
    } catch (spiderErr) {
      console.error(`   ✗ Spider graph generation failed (non-fatal):`, spiderErr.message);
    }

    // ── Step 6: Atomic DB Update ──────────────────────────────────────────────
    console.log(`💾 [VectorRecalc] Step 6: Saving all AI fields to DB...`);

    const updateQuery = `
      UPDATE profiles
      SET
        intent_tags         = COALESCE($1::jsonb,   intent_tags),
        confidence_score    = COALESCE($2::float8,  confidence_score),
        contextual_tags     = COALESCE($3::jsonb,   contextual_tags),
        normalized_entities = COALESCE($4::jsonb,   normalized_entities),
        intent_embedding    = COALESCE($5::vector,  intent_embedding),
        sentiment_audit     = COALESCE($6::jsonb,   sentiment_audit),
        spider_graph_data   = COALESCE($8::jsonb,   spider_graph_data),
        updated_at          = NOW()
      WHERE user_id = $7
      RETURNING id, user_id, updated_at;
    `;

    const updateValues = [
      intent_tags        ? JSON.stringify(intent_tags)        : null, // $1
      (confidence_score !== null && confidence_score !== undefined)
                         ? confidence_score                   : null, // $2
      contextual_tags    ? JSON.stringify(contextual_tags)    : null, // $3
      normalized_entities? JSON.stringify(normalized_entities): null, // $4
      intent_embedding   ? JSON.stringify(intent_embedding)   : null, // $5
      sentiment_audit    ? JSON.stringify(sentiment_audit)    : null, // $6
      userId,                                                          // $7
      spider_graph_data  ? JSON.stringify(spider_graph_data)  : null, // $8
    ];

    const updateResult = await pool.query(updateQuery, updateValues);

    // 🌲 Pinecone Integration: Dual Storage sync during vector recalculation
    if (intent_embedding) {
      try {
        console.log(`🌲 [Pinecone] Syncing recalculated vector for user ${userId}...`);
        await upsertUserVector(userId, intent_embedding, {
          profession: profileData.profession,
          city: profileData.city,
          intent_tags: intent_tags
        });
      } catch (pineconeErr) {
        console.error("❌ [Pinecone] Vector recalculation sync failed (non-blocking):", pineconeErr.message);
      }
    }

    if (!updateResult.rows.length) {
      console.error(`❌ [VectorRecalc] DB UPDATE returned no rows for user ${uid}`);
      return { success: false, skipped: false, error: "DB update failed — profile row not found", stats };
    }

    stats.db_updated = true;
    console.log(`   ✓ DB updated: profile_id=${updateResult.rows[0].id}, updated_at=${updateResult.rows[0].updated_at}`);

    // ── Step 7: Invalidate Compatibility Cache ────────────────────────────────
    console.log(`🗑️  [VectorRecalc] Step 7: Invalidating compatibility cache for user ${uid}...`);
    try {
      const delResult = await pool.query(
        `DELETE FROM profile_compatibilities WHERE user_a_id = $1 OR user_b_id = $1`,
        [userId]
      );
      stats.cache_invalidated  = true;
      stats.cache_rows_deleted = delResult.rowCount || 0;
      console.log(`   ✓ Deleted ${stats.cache_rows_deleted} stale compatibility record(s) for user ${uid}`);
    } catch (cacheErr) {
      console.error(`   ✗ Cache invalidation failed (non-fatal):`, cacheErr.message);
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    stats.duration_ms = Date.now() - startTime;
    console.log(`\n✅ [VectorRecalc] COMPLETE for user ${uid} in ${stats.duration_ms}ms`);
    console.log(`   → normalized_entities: ${stats.normalized_entities ? "✓" : "✗"}`);
    console.log(`   → intent_tags:         ${stats.intent_tags         ? "✓" : "✗"}`);
    console.log(`   → contextual_tags:     ${stats.contextual_tags     ? "✓" : "✗"}`);
    console.log(`   → sentiment_audit:     ${stats.sentiment_audit     ? "✓" : isSentimentAuditEnabled() ? "✗ (failed)" : "— (disabled)"}`);
    console.log(`   → spider_graph_data:   ${stats.spider_graph_data   ? "✓" : "✗"}`);
    console.log(`   → intent_embedding:    ${stats.intent_embedding    ? `✓ (${stats.embedding_dimensions}d)` : "✗ (failed)"}`);
    console.log(`   → cache_invalidated:   ${stats.cache_invalidated   ? `✓ (${stats.cache_rows_deleted} rows)` : "✗ (failed)"}`);
    console.log(`🔄 [VectorRecalc] ${"═".repeat(52)}\n`);

    return { success: true, skipped: false, error: null, stats };

  } catch (fatalErr) {
    stats.duration_ms = Date.now() - startTime;
    console.error(`💥 [VectorRecalc] FATAL ERROR for user ${uid} after ${stats.duration_ms}ms:`, fatalErr.message);
    console.error(fatalErr);
    return { success: false, skipped: false, error: fatalErr.message, stats };
  } finally {
    // Always release the deduplication lock — even on fatal errors
    releaseRecalcLock(uid);
    console.log(`🔓 [VectorRecalc] Deduplication lock released for user ${uid}`);
  }
};
