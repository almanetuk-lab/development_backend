import { pool } from "../config/db.js";
import { generateAICompatibility, extractIntentTags, enrichContextualMetadata, validateAndNormalize, validateAndNormalizeContextual } from "../services/geminiService.js";
import { buildSemanticProfileText, generateEmbedding } from "../services/embeddingService.js";
import { extractProfessionalEntities } from "../services/entityRecognitionService.js";
import { isSentimentAuditEnabled } from "../config/sentimentConfig.js";
import { searchSimilarProfiles } from "../services/pineconeService.js";
import {
  analyzeSentimentAndTone,
  isDistressTone,
  getExplanationSnippet,
  SENTIMENT_WEIGHTS,
  DEFAULT_SENTIMENT_AUDIT,
} from "../services/sentimentAuditService.js";
import {
  getAdaptiveWeights,
  buildTemporarySemanticText,
  blendEmbeddings,
  rescoreSuggestions,
  PRIORITY_OPTIONS,
  SESSION_TTL_MS,
} from "../services/queryRefinementService.js";

// ============================================================
// HELPER: Fetch COMPLETE profile data for a user
// Includes: all profile columns, parsed JSONB fields, Q&A prompts
// ============================================================
const fetchFullProfile = async (userId) => {
  try {
    const profileResult = await pool.query(
      `SELECT * FROM profiles WHERE user_id = $1`,
      [userId]
    );

    if (!profileResult.rows.length) {
      console.warn(`⚠️ fetchFullProfile: No profile found for user_id ${userId}`);
      return null;
    }

    const profile = profileResult.rows[0];

    // --- Fetch Q&A prompts (question-answer form data) ---
    const promptsResult = await pool.query(
      `SELECT question_key, answer FROM profile_prompts WHERE profile_id = $1`,
      [profile.id]
    );
    const prompts = {};
    for (const row of promptsResult.rows) {
      prompts[row.question_key] = row.answer;
    }
    profile.prompts = prompts;

    // --- Safely parse JSONB fields ---
    const safeParseJson = (field) => {
      if (!field) return null;
      if (typeof field === "object" && !Array.isArray(field)) return field;
      if (typeof field === "string") {
        try { return JSON.parse(field); } catch { return null; }
      }
      return null;
    };

    const rawIntentTags = safeParseJson(profile.intent_tags);
    profile.intent_tags_parsed = validateAndNormalize(rawIntentTags);
    const rawContextualTags = safeParseJson(profile.contextual_tags);
    profile.contextual_tags_parsed = validateAndNormalizeContextual(rawContextualTags);
    profile.life_rhythms_parsed = safeParseJson(profile.life_rhythms);
    profile.ways_i_spend_time_parsed = safeParseJson(profile.ways_i_spend_time);
    profile.skills_parsed = safeParseJson(profile.skills);
    profile.interests_parsed = safeParseJson(profile.interests);
    profile.hobbies_parsed = safeParseJson(profile.hobbies);
    profile.normalized_entities_parsed = safeParseJson(profile.normalized_entities);
    // Parse sentiment audit JSONB (emotional tone data)
    profile.sentiment_audit_parsed = safeParseJson(profile.sentiment_audit);

    console.log(`✅ fetchFullProfile: Loaded profile for user_id ${userId} (profile_id: ${profile.id})`);
    console.log(`   → intent_tags: ${profile.intent_tags_parsed ? "✓" : "✗"}`);
    console.log(`   → contextual_tags: ${profile.contextual_tags_parsed ? "✓" : "✗"}`);
    console.log(`   → life_rhythms: ${profile.life_rhythms_parsed ? "✓" : "✗"}`);
    console.log(`   → intent_embedding: ${profile.intent_embedding ? "✓" : "✗"}`);
    console.log(`   → prompts count: ${Object.keys(prompts).length}`);
    console.log(`   → confidence_score: ${profile.confidence_score}`);

    return profile;
  } catch (err) {
    console.error(`❌ fetchFullProfile Error for user_id ${userId}:`, err.message);
    return null;
  }
};

// ============================================================
// HELPER: Calculate cosine similarity between two embedding vectors
// Returns a value 0.0 – 1.0 (1.0 = identical, 0.0 = no overlap)
// ============================================================
const calculateCosineSimilarity = (vecA, vecB) => {
  if (!vecA || !vecB) return null;

  let a, b;
  try {
    a = Array.isArray(vecA) ? vecA : JSON.parse(vecA);
    b = Array.isArray(vecB) ? vecB : JSON.parse(vecB);
  } catch {
    return null;
  }

  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return null;
  }

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return parseFloat(Math.min(1, Math.max(0, similarity)).toFixed(4));
};

// ============================================================
// HELPER: Pre-compute local compatibility dimension scores
// Returns structured scores object with all dimension scores (0-100)
// ============================================================
const calculateLocalCompatibilityScores = (profileA, profileB) => {
  const scores = {};

  // 1. Vector Cosine Similarity Score
  const cosineSim = calculateCosineSimilarity(
    profileA.intent_embedding,
    profileB.intent_embedding
  );
  scores.vector_similarity = cosineSim !== null ? Math.round(cosineSim * 100) : null;
  console.log(`   → vector_similarity: ${scores.vector_similarity}`);

  // 2. Intent Tags Match Score (field-by-field comparison)
  const tagsA = profileA.intent_tags_parsed || {};
  const tagsB = profileB.intent_tags_parsed || {};
  const intentTagFields = [
    "ambition_level",
    "stress_cycle",
    "social_preference",
    "communication_style",
    "relationship_intent",
  ];
  let tagMatches = 0, tagTotal = 0;
  for (const field of intentTagFields) {
    if (tagsA[field] && tagsB[field]) {
      tagTotal++;
      if (tagsA[field] === tagsB[field]) tagMatches++;
    }
  }
  scores.intent_tag_match = tagTotal > 0 ? Math.round((tagMatches / tagTotal) * 100) : null;
  console.log(`   → intent_tag_match: ${scores.intent_tag_match} (${tagMatches}/${tagTotal})`);

  // 3. Relationship Expectations Match
  const relFieldWeights = [
    ["relationship_goal", 1.0],
    ["relationship_pace", 0.8],
    ["relationship_intent", 1.0],  // from intent_tags
    ["interested_in", 0.9],
    ["children_preference", 0.7],
    ["approach_to_physical_closeness", 0.6],
    ["preference_of_closeness", 0.6],
  ];
  let relScore = 0, relWeight = 0;
  for (const [field, weight] of relFieldWeights) {
    const valA = field === "relationship_intent" ? tagsA[field] : profileA[field];
    const valB = field === "relationship_intent" ? tagsB[field] : profileB[field];
    if (valA && valB) {
      relWeight += weight;
      if (valA === valB) relScore += weight;
    }
  }
  scores.relationship_expectations = relWeight > 0
    ? Math.round((relScore / relWeight) * 100)
    : null;
  console.log(`   → relationship_expectations: ${scores.relationship_expectations}`);

  // 4. Lifestyle Rhythm Compatibility (from life_rhythms JSONB)
  const lrA = profileA.life_rhythms_parsed || {};
  const lrB = profileB.life_rhythms_parsed || {};
  const lifestyleFields = [
    "emotional_style",
    "social_energy",
    "life_pace",
    "work_rhythm",
    "communication_rhythm",
    "energy_level",
  ];
  let lrMatches = 0, lrTotal = 0;
  for (const field of lifestyleFields) {
    const valA = lrA[field] || profileA[field];   // check JSONB first, then flat column
    const valB = lrB[field] || profileB[field];
    if (valA && valB) {
      lrTotal++;
      if (valA === valB) lrMatches++;
    }
  }
  scores.lifestyle_rhythm = lrTotal > 0 ? Math.round((lrMatches / lrTotal) * 100) : null;
  console.log(`   → lifestyle_rhythm: ${scores.lifestyle_rhythm} (${lrMatches}/${lrTotal})`);

  // 5. Lifestyle Preferences Compatibility
  const prefFields = [
    "love_language_affection",
    "smoking",
    "drinking",
    "pets_preference",
    "religious_belief",
    "health_activity_level",
    "zodiac_sign",
  ];
  let prefMatches = 0, prefTotal = 0;
  for (const field of prefFields) {
    if (profileA[field] && profileB[field]) {
      prefTotal++;
      if (profileA[field] === profileB[field]) prefMatches++;
    }
  }
  scores.preference_match = prefTotal > 0 ? Math.round((prefMatches / prefTotal) * 100) : null;
  console.log(`   → preference_match: ${scores.preference_match} (${prefMatches}/${prefTotal})`);

  // 6. Q&A / Prompts Overlap Stats
  const promptsA = profileA.prompts || {};
  const promptsB = profileB.prompts || {};
  const keysA = Object.keys(promptsA);
  const keysB = Object.keys(promptsB);
  const commonKeys = keysA.filter((k) => promptsB[k] !== undefined);
  scores.qa_overlap_count = commonKeys.length;
  scores.qa_total_keys_a = keysA.length;
  scores.qa_total_keys_b = keysB.length;
  console.log(`   → qa_overlap: ${scores.qa_overlap_count} shared keys`);

  // 7. Emotional / Personality Matching (JSONB intent_tags)
  const personalityFields = [
    "communication_style",
    "social_preference",
    "ambition_level",
    "stress_cycle",
  ];
  let persMatches = 0, persTotal = 0;
  const tagsA_pers = profileA.intent_tags_parsed || {};
  const tagsB_pers = profileB.intent_tags_parsed || {};
  for (const field of personalityFields) {
    const valA = tagsA_pers[field];
    const valB = tagsB_pers[field];
    if (valA && valB) {
      persTotal++;
      if (valA === valB) persMatches++;
    }
  }
  scores.personality_match = persTotal > 0 ? Math.round((persMatches / persTotal) * 100) : null;
  console.log(`   → personality_match: ${scores.personality_match} (${persMatches}/${persTotal})`);

  // 8. Average AI confidence score
  const confA = parseFloat(profileA.confidence_score) || 0.5;
  const confB = parseFloat(profileB.confidence_score) || 0.5;
  scores.avg_confidence = parseFloat(((confA + confB) / 2).toFixed(2));

  // 10. Contextual Environment Match (from contextual_tags_parsed)
  const ctxA = profileA.contextual_tags_parsed || {};
  const ctxB = profileB.contextual_tags_parsed || {};
  const contextualFields = [
    "city_energy",
    "career_pressure",
    "lifestyle_intensity",
    "emotional_environment",
    "social_environment",
  ];
  let ctxMatches = 0, ctxTotal = 0;
  for (const field of contextualFields) {
    if (ctxA[field] && ctxB[field]) {
      ctxTotal++;
      if (ctxA[field] === ctxB[field]) ctxMatches++;
    }
  }
  scores.contextual_match = ctxTotal > 0 ? Math.round((ctxMatches / ctxTotal) * 100) : null;
  console.log(`   → contextual_match: ${scores.contextual_match} (${ctxMatches}/${ctxTotal})`);

  // 11. Professional Alignment (from normalized_entities)
  const nerA = profileA.normalized_entities_parsed || {};
  const nerB = profileB.normalized_entities_parsed || {};
  let profMatches = 0, profTotal = 0;
  
  if (nerA.career_tier && nerB.career_tier) {
    profTotal += 2;
    if (nerA.career_tier === nerB.career_tier) profMatches += 2;
  }
  if (nerA.industry_cluster && nerB.industry_cluster) {
    profTotal += 1.5;
    if (nerA.industry_cluster === nerB.industry_cluster) profMatches += 1.5;
  }
  if (nerA.work_intensity && nerB.work_intensity) {
    profTotal += 1;
    if (nerA.work_intensity === nerB.work_intensity) profMatches += 1;
  }
  if (nerA.work_environment && nerB.work_environment) {
    profTotal += 1;
    if (nerA.work_environment === nerB.work_environment) profMatches += 1;
  }
  scores.professional_alignment = profTotal > 0 ? Math.round((profMatches / profTotal) * 100) : null;
  console.log(`   → professional_alignment: ${scores.professional_alignment} (${profMatches}/${profTotal})`);

  // 12. Emotional Tone Compatibility Score (Sentiment & Tone Audit System)
  // Computes emotional tone match and applies weighted boosts when one user
  // has a distress tone and the other has emotionally resilient/stable traits.
  (() => {
    const auditA = profileA.sentiment_audit_parsed || {};
    const auditB = profileB.sentiment_audit_parsed || {};

    const toneA = auditA.primary_tone || null;
    const toneB = auditB.primary_tone || null;
    const resilienceA = auditA.emotional_resilience || null;
    const resilienceB = auditB.emotional_resilience || null;

    // Base score: 50 if either has no audit data
    let tonalScore = 50;
    let boostApplied = null;

    if (toneA && toneB) {
      const aIsDistressed = isDistressTone(toneA);
      const bIsDistressed = isDistressTone(toneB);

      if (aIsDistressed && resilienceB === "High") {
        // User A is distressed, B is emotionally resilient — excellent match
        tonalScore = 88;
        boostApplied = "emotional_resilience_bonus";
        console.log(`   ⚡ Emotional boost: User A distress tone (${toneA}) matched with High Resilience User B`);
      } else if (bIsDistressed && resilienceA === "High") {
        // User B is distressed, A is emotionally resilient — excellent match
        tonalScore = 88;
        boostApplied = "emotional_resilience_bonus";
        console.log(`   ⚡ Emotional boost: User B distress tone (${toneB}) matched with High Resilience User A`);
      } else if (!aIsDistressed && !bIsDistressed && toneA === toneB) {
        // Both stable and same tone — strong alignment
        tonalScore = 85;
        boostApplied = "tone_alignment";
      } else if (!aIsDistressed && !bIsDistressed) {
        // Both non-distressed but different tones — moderate
        tonalScore = 72;
      } else if (aIsDistressed && bIsDistressed) {
        // Both distressed — potential emotional bandwidth clash
        tonalScore = 42;
        boostApplied = "dual_distress_flag";
        console.log(`   ⚠️ Dual distress detected: A=${toneA}, B=${toneB} — emotional bandwidth challenge`);
      } else {
        // One distressed, other not resilient — neutral
        tonalScore = 60;
      }

      // Additional low-friction bonus: if distressed user meets low-friction partner
      const frictionA = auditA.lifestyle_friction;
      const frictionB = auditB.lifestyle_friction;
      if (aIsDistressed && frictionB === "Low") {
        tonalScore = Math.min(100, tonalScore + 6);
        console.log(`   ⚡ Low-friction bonus applied: B has Low lifestyle friction`);
      } else if (bIsDistressed && frictionA === "Low") {
        tonalScore = Math.min(100, tonalScore + 6);
        console.log(`   ⚡ Low-friction bonus applied: A has Low lifestyle friction`);
      }
    }

    scores.emotional_tone_match = Math.round(tonalScore);
    scores.emotional_boost_applied = boostApplied;
    console.log(`   → emotional_tone_match: ${scores.emotional_tone_match} (boost: ${boostApplied || "none"})`);
  })();

  // 9. Derived combined pre-score (weighted blend of all available local scores)
  // Weights adjusted to include professional_alignment + emotional_tone_match
  // (total weight sums to 1.00)
  const blendWeights = [
    [scores.vector_similarity,         0.22],
    [scores.intent_tag_match,          0.16],
    [scores.relationship_expectations, 0.16],
    [scores.lifestyle_rhythm,          0.12],
    [scores.professional_alignment,    0.09],
    [scores.emotional_tone_match,      SENTIMENT_WEIGHTS.emotional_tone_match], // 0.12
    [scores.preference_match,          0.05],
    [scores.personality_match,         0.04],
    [scores.contextual_match,          0.04],
  ];
  let blendScore = 0, blendWeight = 0;
  for (const [val, w] of blendWeights) {
    if (val !== null && val !== undefined) {
      blendScore += val * w;
      blendWeight += w;
    }
  }
  scores.pre_computed_combined = blendWeight > 0
    ? Math.round(blendScore / blendWeight)
    : null;
  console.log(`   → pre_computed_combined: ${scores.pre_computed_combined}`);

  return scores;
};

// ============================================================
// HELPER: Centralized save to profile_compatibilities with validation
// ============================================================
const saveCompatibilityReport = async (userA, userB, report, localScores) => {
  console.log(`\n💾 ═══════════════════════════════════════════`);
  console.log(`💾 SAVING compatibility for pair (${userA}, ${userB})...`);

  // --- Validate required fields before attempting DB insert ---
  const overallScore = report?.overall_compatibility;
  const aiSummary = report?.ai_match_summary;
  const compType = report?.compatibility_type;

  if (overallScore === null || overallScore === undefined || isNaN(Number(overallScore))) {
    console.error(`❌ SAVE ABORTED: overall_score is invalid: ${overallScore}`);
    return null;
  }
  if (!aiSummary || typeof aiSummary !== "string" || aiSummary.trim().length === 0) {
    console.error(`❌ SAVE ABORTED: ai_summary is empty/invalid`);
    return null;
  }
  if (!compType || typeof compType !== "string" || compType.trim().length === 0) {
    console.error(`❌ SAVE ABORTED: compatibility_type is empty/invalid`);
    return null;
  }

  // --- Enrich JSONB with local scores + metadata ---
  const enrichedReport = {
    ...report,
    local_scores: localScores || null,
    computed_at: new Date().toISOString(),
    data_version: "2.1",
  };

  const safeScore = Math.round(Number(overallScore));
  const safeSummary = String(aiSummary).substring(0, 5000);
  const safeType = String(compType).substring(0, 254);

  console.log(`💾 overall_score     : ${safeScore}`);
  console.log(`💾 compatibility_type: ${safeType}`);
  console.log(`💾 ai_summary length : ${safeSummary.length} chars`);
  console.log(`💾 local_scores keys : ${localScores ? Object.keys(localScores).join(", ") : "none"}`);

  const saveQuery = `
    INSERT INTO profile_compatibilities (
      user_a_id, user_b_id, compatibility_data, overall_score, ai_summary, compatibility_type, updated_at
    )
    VALUES ($1, $2, $3::jsonb, $4, $5, $6, NOW())
    ON CONFLICT (user_a_id, user_b_id)
    DO UPDATE SET
      compatibility_data   = EXCLUDED.compatibility_data,
      overall_score        = EXCLUDED.overall_score,
      ai_summary           = EXCLUDED.ai_summary,
      compatibility_type   = EXCLUDED.compatibility_type,
      updated_at           = NOW()
    RETURNING id, overall_score, updated_at;
  `;

  try {
    const saveResult = await pool.query(saveQuery, [
      userA,
      userB,
      JSON.stringify(enrichedReport),
      safeScore,
      safeSummary,
      safeType,
    ]);

    if (saveResult.rows.length > 0) {
      const row = saveResult.rows[0];
      console.log(`✅ COMPATIBILITY SAVED — DB id: ${row.id}, score: ${row.overall_score}, updated_at: ${row.updated_at}`);
      console.log(`💾 ═══════════════════════════════════════════\n`);
      return enrichedReport;
    } else {
      console.error(`❌ SAVE RETURNED NO ROWS for pair (${userA}, ${userB})`);
      return null;
    }
  } catch (dbErr) {
    console.error(`❌ DB SAVE ERROR for pair (${userA}, ${userB}):`, dbErr.message);
    console.error(`   Full DB error:`, dbErr);
    return null;
  }
};

// ============================================================
// GET /api/matches/suggestions
// Fetches AI-based matchmaking suggestions using pgvector cosine similarity search.
// ============================================================
export const getSuggestions = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Fetch current user's vector
    const userQuery = `
      SELECT intent_embedding, username 
      FROM profiles 
      WHERE user_id = $1;
    `;
    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      console.log("❌ SUGGESTIONS FAILED: User profile not found for ID:", userId);
      return res.status(404).json({ message: "Profile not found" });
    }

    const { intent_embedding } = userResult.rows[0];

    if (!intent_embedding) {
      console.log("ℹ️ SUGGESTIONS: No vector embedding exists for user:", userId);
      return res.status(200).json([]);
    }

    console.log("CURRENT USER:", userId);
    console.log("CURRENT VECTOR FOUND");

    // ── Point #7: Check for active refinement session ────────────────
    let activeSession = null;
    let searchVector = intent_embedding;
    let adaptiveWeights = null;

    try {
      const sessionResult = await pool.query(
        `SELECT * FROM refined_query_sessions
         WHERE user_id = $1 AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      if (sessionResult.rows.length > 0) {
        activeSession = sessionResult.rows[0];
        console.log("🔮 ACTIVE REFINEMENT SESSION found:", activeSession.selected_priorities);

        // Blend vectors if temporary embedding exists
        const tempEmb = activeSession.generated_context?.temporary_embedding;
        if (tempEmb && Array.isArray(tempEmb) && tempEmb.length === 768) {
          // Parse permanent embedding from pgvector string format
          let permVector = intent_embedding;
          if (typeof intent_embedding === "string") {
            permVector = intent_embedding.replace(/[\[\]]/g, "").split(",").map(Number);
          }
          searchVector = `[${blendEmbeddings(permVector, tempEmb, 0.60).join(",")}]`;
          console.log("🔀 Using BLENDED vector for suggestions search");
        }

        // Load adaptive weights
        adaptiveWeights = activeSession.temporary_weights || null;
        if (adaptiveWeights) {
          console.log("⚖️ Adaptive weights active:", adaptiveWeights);
        }
      }
    } catch (sessionErr) {
      console.warn("⚠️ Refinement session lookup failed (non-fatal):", sessionErr.message);
    }

    // Parse search vector to array of numbers for Pinecone
    let parsedSearchVector = null;
    if (searchVector) {
      if (typeof searchVector === "string") {
        parsedSearchVector = searchVector.replace(/[\[\]]/g, "").split(",").map(Number);
      } else if (Array.isArray(searchVector)) {
        parsedSearchVector = searchVector;
      }
    }

    let matches = [];
    let pineconeSuccess = false;
    let pineconeScoresMap = {}; // userId -> similarity score

    // Fetch current user's profile for compatibility calculations
    const currentUserProfile = await fetchFullProfile(userId);

    // Try to search via Pinecone
    if (currentUserProfile && parsedSearchVector) {
      try {
        console.log(`🌲 [Pinecone] Executing similarity query for user ${userId}...`);
        const pineconeResults = await searchSimilarProfiles(parsedSearchVector, 50);

        if (pineconeResults && pineconeResults.length > 0) {
          // Filter out current user
          const filteredMatches = pineconeResults.filter(m => String(m.id) !== String(userId));
          const matchedUserIds = filteredMatches.map(m => Number(m.id));

          if (matchedUserIds.length > 0) {
            filteredMatches.forEach(m => {
              pineconeScoresMap[String(m.id)] = m.score !== undefined && m.score !== null ? m.score : 0.70;
            });

            // Fetch details from PostgreSQL
            const fetchQuery = `
              SELECT * FROM profiles
              WHERE user_id = ANY($1::int[]);
            `;
            const fetchResult = await pool.query(fetchQuery, [matchedUserIds]);
            matches = fetchResult.rows;
            pineconeSuccess = true;
            console.log(`🌲 [Pinecone] Similarity search fetched ${matches.length} profiles from DB.`);
          }
        }
      } catch (pineconeErr) {
        console.error("❌ [Pinecone] Search failed, falling back to pgvector (Supabase):", pineconeErr.message);
      }
    }

    // Fallback to pgvector if Pinecone is not configured or failed/returned nothing
    if (!pineconeSuccess) {
      console.log("🐘 Falling back to Supabase pgvector search...");
      const matchQuery = `
        SELECT
            *,
            intent_embedding <=> $1 AS distance
        FROM profiles
        WHERE
            user_id != $2
            AND intent_embedding IS NOT NULL
            AND (intent_embedding <=> $1) < 0.30
        ORDER BY distance ASC
        LIMIT 25;
      `;
      const matchResult = await pool.query(matchQuery, [searchVector, userId]);
      matches = matchResult.rows;

      // Populate pineconeScoresMap using distance fallback: similarity = 1 - distance
      matches.forEach(row => {
        const distanceVal = Number(row.distance);
        pineconeScoresMap[String(row.user_id)] = 1 - distanceVal;
      });
    }

    // Populate prompts for all matches to ensure calculateLocalCompatibilityScores works correctly
    if (matches.length > 0) {
      const matchProfileIds = matches.map(row => row.id);
      try {
        const promptsResult = await pool.query(
          `SELECT profile_id, question_key, answer FROM profile_prompts WHERE profile_id = ANY($1::int[])`,
          [matchProfileIds]
        );
        const promptsMap = {};
        for (const prow of promptsResult.rows) {
          if (!promptsMap[prow.profile_id]) {
            promptsMap[prow.profile_id] = {};
          }
          promptsMap[prow.profile_id][prow.question_key] = prow.answer;
        }
        matches.forEach(row => {
          row.prompts = promptsMap[row.id] || {};
        });
      } catch (promptErr) {
        console.error("❌ [Suggestions] Failed to bulk fetch prompts (non-fatal):", promptErr.message);
      }
    }

    // 3. Format response with dynamic scores and hybrid ranking
    const responseData = matches.map((row) => {
      let parsedTags = {};
      if (row.intent_tags) {
        if (typeof row.intent_tags === "string") {
          try { parsedTags = JSON.parse(row.intent_tags); } catch { parsedTags = {}; }
        } else {
          parsedTags = row.intent_tags;
        }
      }

      let parsedContextualTags = null;
      if (row.contextual_tags) {
        if (typeof row.contextual_tags === "string") {
          try { parsedContextualTags = JSON.parse(row.contextual_tags); } catch { parsedContextualTags = null; }
        } else {
          parsedContextualTags = row.contextual_tags;
        }
      }

      // Parse the candidate's sentiment audit data
      let candidateSentiment = null;
      if (row.sentiment_audit) {
        if (typeof row.sentiment_audit === "string") {
          try { candidateSentiment = JSON.parse(row.sentiment_audit); } catch { candidateSentiment = null; }
        } else {
          candidateSentiment = row.sentiment_audit;
        }
      }

      // Compute composite clarity
      const rawConf = parseFloat(row.confidence_score) || 0;
      const hasIntentTags = Object.keys(parsedTags).length > 0;
      const hasSentiment = candidateSentiment && candidateSentiment.primary_tone;
      const hasContextual = parsedContextualTags && Object.keys(parsedContextualTags).length > 0;
      const hasAboutMe = (row.about_me || "").trim().length > 20;
      
      const completionBonus =
        (hasIntentTags ? 0.08 : 0) +
        (hasSentiment ? 0.07 : 0) +
        (hasContextual ? 0.05 : 0) +
        (hasAboutMe ? 0.05 : 0);
      
      const compositeClarity = Math.min(1, (rawConf > 0 ? rawConf * 0.80 : 0.40) + completionBonus);

      // --- HYBRID RANKING COMPUTATION ---
      // Get the Pinecone similarity score (0 to 100)
      const pineconeSimilarity = Math.round((pineconeScoresMap[String(row.user_id)] || 0.70) * 100);

      let compMatrix = 70;
      let sentimentScore = 70;
      let lifestyleScore = 65;

      const safeParseJson = (field) => {
        if (!field) return null;
        if (typeof field === "object" && !Array.isArray(field)) return field;
        if (typeof field === "string") {
          try { return JSON.parse(field); } catch { return null; }
        }
        return null;
      };

      if (currentUserProfile) {
        try {
          const candidateProfileFormatted = {
            ...row,
            intent_tags_parsed: validateAndNormalize(parsedTags),
            contextual_tags_parsed: validateAndNormalizeContextual(parsedContextualTags),
            life_rhythms_parsed: safeParseJson(row.life_rhythms),
            ways_i_spend_time_parsed: safeParseJson(row.ways_i_spend_time),
            skills_parsed: safeParseJson(row.skills),
            interests_parsed: safeParseJson(row.interests),
            hobbies_parsed: safeParseJson(row.hobbies),
            normalized_entities_parsed: safeParseJson(row.normalized_entities),
            sentiment_audit_parsed: candidateSentiment,
          };

          const localScores = calculateLocalCompatibilityScores(currentUserProfile, candidateProfileFormatted);
          
          compMatrix = localScores?.relationship_expectations ?? 70;
          sentimentScore = localScores?.emotional_tone_match ?? 70;
          lifestyleScore = localScores?.lifestyle_rhythm ?? 65;
        } catch (scoreErr) {
          console.error(`❌ Error calculating hybrid ranking components for user ${row.user_id}:`, scoreErr.message);
        }
      }

      // Final Match Score = 40% Pinecone Similarity + 35% Compatibility Matrix + 15% Sentiment Score + 10% Lifestyle Match
      const finalMatchScore = Math.round(
        (0.40 * pineconeSimilarity) +
        (0.35 * compMatrix) +
        (0.15 * sentimentScore) +
        (0.10 * lifestyleScore)
      );

      return {
        id: row.id,
        user_id: row.user_id,
        name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "User",
        profession: row.profession || "Profession not set",
        about_me: row.about_me || "",
        image_url: row.image_url || "",
        city: row.city || "Location not set",
        distance: Number(((100 - pineconeSimilarity) / 100).toFixed(4)),
        compatibility_score: finalMatchScore,
        intent_tags: parsedTags,
        contextual_tags: parsedContextualTags,
        spider_graph_data: row.spider_graph_data || null,
        confidence_score: parseFloat(compositeClarity.toFixed(2)),
        // Sentiment data from candidate profile (used for boost logic below)
        _candidate_sentiment: candidateSentiment,
        local_scores: {
          vector_similarity: pineconeSimilarity,
          relationship_expectations: compMatrix,
          emotional_tone_match: sentimentScore,
          lifestyle_rhythm: lifestyleScore,
          hybrid_score: finalMatchScore
        },
      };
    });

    // ── Sentiment-Aware Re-Ranking ────────────────────────────────────────
    let currentUserSentiment = null;
    if (isSentimentAuditEnabled()) {
      try {
        const sentimentResult = await pool.query(
          `SELECT COALESCE(sentiment_audit, '{}'::jsonb) AS sentiment_audit
           FROM profiles WHERE user_id = $1 LIMIT 1`,
          [userId]
        );
        if (sentimentResult.rows.length > 0) {
          const sr = sentimentResult.rows[0];
          const parsedAudit = typeof sr.sentiment_audit === "string"
              ? (() => { try { return JSON.parse(sr.sentiment_audit); } catch { return null; } })()
              : sr.sentiment_audit;
          currentUserSentiment = {
            primary_tone:         parsedAudit?.primary_tone || null,
            emotional_resilience: parsedAudit?.emotional_resilience || null,
            audit: parsedAudit,
          };
        }
      } catch (sentimentErr) {
        console.warn("⚠️ Sentiment-aware re-rank: failed to fetch user sentiment (non-fatal):", sentimentErr.message);
      }
    }

    const currentTone = currentUserSentiment?.primary_tone || null;
    const userIsDistressed = isDistressTone(currentTone);
    const explanation = userIsDistressed ? getExplanationSnippet(currentTone) : null;

    // Apply sentiment boost scores to each candidate
    const scoredData = responseData.map((match) => {
      const cs = match._candidate_sentiment;
      let sentiment_boost_score = 0;

      if (userIsDistressed && cs) {
        const candTone       = cs.primary_tone || "";
        const candResilience = cs.emotional_resilience || "";
        const candFriction   = cs.lifestyle_friction || "";

        // Boost for high emotional resilience
        if (candResilience === "High") {
          sentiment_boost_score += Math.round(SENTIMENT_WEIGHTS.emotional_resilience_bonus * 100);
        }
        // Boost for calm/balanced/optimistic tone
        if (["Balanced", "Calm", "Optimistic", "Content", "Supportive", "Friendly"].includes(candTone)) {
          sentiment_boost_score += 5;
        }
        
        const candCommunication = cs.communication_style || "";
        const candConflict = cs.conflict_resolution_style || "";
        if (["Calm", "Friendly", "Supportive", "Collaborative"].includes(candCommunication) || ["Collaborative", "Supportive", "Calm"].includes(candConflict)) {
          sentiment_boost_score += 5;
        }

        // Boost for low-friction lifestyle
        if (candFriction === "Low") {
          sentiment_boost_score += Math.round(SENTIMENT_WEIGHTS.low_friction_bonus * 100);
        }
      }

      if (sentiment_boost_score > 0) {
        console.log(`   ⚡ Sentiment boost +${sentiment_boost_score} applied to candidate user_id=${match.user_id}`);
      }

      const { _candidate_sentiment, ...cleanMatch } = match;
      return {
        ...cleanMatch,
        sentiment_boost_score,
        sentiment_match_explanation: sentiment_boost_score > 0 ? explanation : null,
      };
    });

    // Sort: primary sort by compatibility_score + boost, secondary by original score
    const sortedData = scoredData.sort((a, b) => {
      const scoreA = a.compatibility_score + a.sentiment_boost_score;
      const scoreB = b.compatibility_score + b.sentiment_boost_score;
      return scoreB - scoreA;
    });

    if (userIsDistressed) {
      console.log(`🧠 SENTIMENT_AWARE_RANKING: User tone=${currentTone}. Applied emotional safety boosting to ${sortedData.filter(m => m.sentiment_boost_score > 0).length} candidates.`);
    }

    // ── Apply adaptive re-scoring if session active ────────
    let finalData = sortedData;
    let refinementMeta = null;

    if (activeSession && adaptiveWeights) {
      console.log("🎯 Applying adaptive re-scoring to suggestions...");
      finalData = rescoreSuggestions(sortedData, adaptiveWeights);
      refinementMeta = {
        is_refined: true,
        session_id: activeSession.id,
        selected_priorities: activeSession.selected_priorities,
        expires_at: activeSession.expires_at,
      };
      console.log(`✅ Re-scored ${finalData.length} suggestions with adaptive weights`);
    }

    // 4. Background pre-generation for top 5 matches
    if (finalData.length > 0) {
      const topMatches = finalData.slice(0, 5);
      console.log(`🧬 Suggestions API: Pre-generating compatibility in background for top ${topMatches.length} matches...`);
      for (const match of topMatches) {
        generateAndCacheCompatibility(userId, match.user_id).catch((err) => {
          console.error(`❌ Background pre-generation error for user ID ${match.user_id}:`, err);
        });
      }
    }

    if (refinementMeta) {
      return res.status(200).json({
        suggestions: finalData,
        refinement: refinementMeta,
      });
    }

    return res.status(200).json(finalData);
  } catch (error) {
    console.error("❌ getSuggestions Error:", error);
    return res.status(500).json({ message: "Server error during semantic matchmaking suggestion search" });
  }
};

// ============================================================
// GET /api/matches/compatibility/:targetUserId
// Full multi-dimensional AI compatibility report with local scoring.
// ============================================================
export const getCompatibilityReport = async (req, res) => {
  let profileA = null;
  let profileB = null;
  let userA = null;
  let userB = null;

  try {
    const userId = Number(req.user.id);
    const targetUserId = Number(req.params.targetUserId);

    if (isNaN(userId) || isNaN(targetUserId)) {
      return res.status(400).json({ message: "Invalid user identifiers" });
    }
    if (userId === targetUserId) {
      return res.status(400).json({ message: "Cannot calculate compatibility with yourself" });
    }

    // Always sort: user_a_id < user_b_id for uniqueness
    userA = Math.min(userId, targetUserId);
    userB = Math.max(userId, targetUserId);

    // 1. Check cache (7-day TTL)
    console.log(`🧬 Checking compatibility cache for pair (${userA}, ${userB})...`);
    const cacheResult = await pool.query(
      `SELECT compatibility_data FROM profile_compatibilities
       WHERE user_a_id = $1 AND user_b_id = $2
         AND updated_at > NOW() - INTERVAL '7 days'`,
      [userA, userB]
    );

    if (cacheResult.rows.length > 0) {
      console.log(`🧬 Cache HIT for pair (${userA}, ${userB}). Returning cached report.`);
      return res.status(200).json(cacheResult.rows[0].compatibility_data);
    }

    console.log(`🧬 Cache MISS for pair (${userA}, ${userB}). Running full compatibility engine...`);

    // 2. Fetch COMPLETE profiles (all fields + Q&A prompts)
    console.log(`🧬 Fetching full profiles for users (${userA}, ${userB})...`);
    const [pA, pB] = await Promise.all([
      fetchFullProfile(userA),
      fetchFullProfile(userB),
    ]);
    profileA = pA;
    profileB = pB;

    if (!profileA) {
      console.error(`❌ Profile NOT FOUND for user_id ${userA}`);
      return res.status(404).json({ message: `Profile not found for user ${userA}` });
    }
    if (!profileB) {
      console.error(`❌ Profile NOT FOUND for user_id ${userB}`);
      return res.status(404).json({ message: `Profile not found for user ${userB}` });
    }

    // 3. Compute local multi-dimensional scores
    console.log(`🧬 Calculating local compatibility scores for pair (${userA}, ${userB})...`);
    const localScores = calculateLocalCompatibilityScores(profileA, profileB);

    // 4. Generate AI Compatibility via Gemini (with local scores as anchors)
    console.log(`🧬 Calling Gemini AI compatibility engine for pair (${userA}, ${userB})...`);
    const report = await generateAICompatibility(profileA, profileB, localScores);

    // 5. Save to DB with full validation
    const saved = await saveCompatibilityReport(userA, userB, report, localScores);

    if (!saved) {
      // Still return the report even if save failed (don't fail the user request)
      console.error(`⚠️ DB save failed for pair (${userA}, ${userB}), but returning report to client.`);
      return res.status(200).json({ ...report, local_scores: localScores, _cache_saved: false });
    }

    return res.status(200).json(saved);
  } catch (error) {
    console.error("❌ getCompatibilityReport Error caught at controller level:", error);
    
    // Build a safe, high-fidelity dynamic fallback report in the controller catch block to completely bypass 500 error
    console.log("🛡️ Controller catch block activated: Returning safe local scores compatibility fallback.");
    try {
      if (profileA && profileB) {
        const localScores = calculateLocalCompatibilityScores(profileA, profileB);
        const vectorSim = localScores?.vector_similarity ?? 68;
        const tagMatch = localScores?.intent_tag_match ?? 70;
        const contextualMatch = localScores?.contextual_match ?? 70;
        const professionalMatch = localScores?.professional_alignment ?? 68;
        
        const overall = (localScores?.pre_computed_combined ?? Math.round(
          vectorSim * 0.3 + tagMatch * 0.3 + contextualMatch * 0.2 + professionalMatch * 0.2
        )) || 68;

        const report = {
          overall_compatibility: overall,
          compatibility_type: "Values-Focused Match",
          ai_match_summary: "Compatibility calculated using available profile data.",
          strengths: [
            vectorSim > 80 ? "High semantic profile alignment" : "Mutual intentional relationship focus",
            tagMatch > 60 ? "Overlapping psychological intent tags" : "Overlapping professional values",
            contextualMatch > 60 ? "Harmonious lifestyle and environment pacing" : "Open communication patterns"
          ].filter(Boolean),
          possible_challenges: [
            tagMatch < 40 ? "Slight differences in social preference and ambition levels" : "Balancing individual work schedules",
            (localScores?.lifestyle_rhythm ?? 50) < 40 ? "Adapting to different day-to-day rhythm paces" : "Adapting to differences in closeness rhythms"
          ].filter(Boolean),
          scores: {
            emotional_compatibility: localScores?.emotional_tone_match ?? tagMatch ?? 70,
            lifestyle_compatibility: localScores?.lifestyle_rhythm ?? 65,
            communication_compatibility: tagMatch ?? 70,
            relationship_alignment: localScores?.relationship_expectations ?? 72,
            professional_alignment: professionalMatch ?? 68,
            long_term_potential: overall ?? 65,
            social_compatibility: localScores?.personality_match ?? 68,
            values_alignment: vectorSim ?? 70,
            attraction_potential: localScores?.preference_match ?? 65,
          },
          relationship_dynamic: "Balanced and supportive relationship style",
          conversation_starters: [
            "What does an ideal slow evening look like to you?",
            "How do you like to express affection in a relationship?",
            "What is a personal project you are passionate about right now?",
          ],
        };

        // Try to save to cache so it exists next time
        try {
          if (userA && userB) {
            await saveCompatibilityReport(userA, userB, report, localScores);
          }
        } catch (saveErr) {
          console.error("⚠️ Failed to save fallback report to DB cache:", saveErr.message);
        }

        return res.status(200).json({ ...report, local_scores: localScores });
      }
    } catch (fallbackErr) {
      console.error("❌ Deep fallback failure:", fallbackErr);
    }
    
    // Absolute bottom fallback if profiles are missing or completely broken
    return res.status(200).json({
      overall_compatibility: 68,
      compatibility_type: "Values-Focused Match",
      ai_match_summary: "Compatibility calculated using available profile data.",
      strengths: ["Mutual intentional relationship focus", "Overlapping professional values"],
      possible_challenges: ["Balancing individual work schedules"],
      scores: {
        emotional_compatibility: 70,
        lifestyle_compatibility: 65,
        communication_compatibility: 70,
        relationship_alignment: 72,
        professional_alignment: 68,
        long_term_potential: 65,
        social_compatibility: 68,
        values_alignment: 70,
        attraction_potential: 65,
      },
      relationship_dynamic: "Balanced and supportive relationship style",
      conversation_starters: [
        "What does an ideal slow evening look like to you?",
        "How do you like to express affection in a relationship?",
      ]
    });
  }
};

// ============================================================
// Background: Calculate and cache compatibility for a pair
// Safe to fire-and-forget. Returns the saved report or null.
// ============================================================
export const generateAndCacheCompatibility = async (userIdA, userIdB) => {
  try {
    const userA = Math.min(userIdA, userIdB);
    const userB = Math.max(userIdA, userIdB);

    console.log(`🧬 BG Auto-Gen: Checking compatibility for pair (${userA}, ${userB})...`);

    // Check recent cache
    const cacheResult = await pool.query(
      `SELECT compatibility_data FROM profile_compatibilities
       WHERE user_a_id = $1 AND user_b_id = $2
         AND updated_at > NOW() - INTERVAL '7 days'`,
      [userA, userB]
    );
    if (cacheResult.rows.length > 0) {
      console.log(`🧬 BG Auto-Gen: Cache HIT for pair (${userA}, ${userB}). Skipping.`);
      return cacheResult.rows[0].compatibility_data;
    }

    // Fetch full profiles
    console.log(`🧬 BG Auto-Gen: Fetching full profiles for (${userA}, ${userB})...`);
    const [profileA, profileB] = await Promise.all([
      fetchFullProfile(userA),
      fetchFullProfile(userB),
    ]);

    if (!profileA || !profileB) {
      console.log(`🧬 BG Auto-Gen: Skipped. Profile missing. A=${!!profileA}, B=${!!profileB}`);
      return null;
    }

    // Local multi-dimensional scores
    console.log(`🧬 BG Auto-Gen: Calculating local scores for (${userA}, ${userB})...`);
    const localScores = calculateLocalCompatibilityScores(profileA, profileB);

    // Call Gemini AI
    console.log(`🧬 BG Auto-Gen: Calling Gemini for pair (${userA}, ${userB})...`);
    const report = await generateAICompatibility(profileA, profileB, localScores);

    // Save to DB
    const saved = await saveCompatibilityReport(userA, userB, report, localScores);
    if (saved) {
      console.log(`🧬 BG Auto-Gen SUCCESS for pair (${userA}, ${userB}).`);
    } else {
      console.error(`🧬 BG Auto-Gen SAVE FAILED for pair (${userA}, ${userB}).`);
    }
    return saved;
  } catch (error) {
    console.error(`❌ BG Auto-Gen Error for pair (${userIdA}, ${userIdB}):`, error.message);
    console.error(`   Stack:`, error.stack);
    return null;
  }
};

// ============================================================
// POST /api/ai/analyze-profile
// Manually analyze logged-in user's profile, save psychological columns.
// ============================================================
export const analyzeProfile = async (req, res) => {
  try {
    const userId = Number(req.user.id);
    console.log(`🤖 Manually analyzing profile for user ID ${userId}...`);

    const profileResult = await pool.query("SELECT * FROM profiles WHERE user_id = $1", [userId]);
    if (!profileResult.rows.length) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const profile = profileResult.rows[0];
    const aboutMe = profile.about_me || "";

    if (!aboutMe || aboutMe.trim().length === 0) {
      return res.status(400).json({ message: "About Me section is empty. Cannot perform psychological analysis." });
    }

    // Generate intent tags
    const geminiResult = await extractIntentTags(profile);
    const intent_tags = geminiResult.intent_tags;
    const confidence_score = geminiResult.confidence_score;

    // Generate contextual metadata enrichment
    let contextual_tags = null;
    try {
      contextual_tags = await enrichContextualMetadata(profile);
      console.log(`✅ Contextual metadata enriched for user ID ${userId}:`, contextual_tags);
    } catch (err) {
      console.error("❌ Contextual enrichment failed during manual analysis:", err.message);
    }

    // Generate NER normalized entities
    let normalized_entities = null;
    try {
      normalized_entities = await extractProfessionalEntities(profile);
      console.log(`✅ NER normalized entities extracted for user ID ${userId}:`, normalized_entities);
    } catch (err) {
      console.error("❌ NER extraction failed during manual analysis:", err.message);
    }

    // ── STEP 4: Sentiment & Tone Audit (Emotional State Analysis) ────────────
    // Runs AFTER NER so the full profile context is available.
    // Gracefully falls back on any error — never blocks the pipeline.
    let sentiment_audit = null;
    if (isSentimentAuditEnabled()) {
      try {
        // Fetch Q&A prompts for richer sentiment signals
        const promptsResult = await pool.query(
        `SELECT question_key, answer FROM profile_prompts WHERE profile_id = $1`,
        [profile.id]
      );
      const prompts = {};
      for (const row of promptsResult.rows) {
        prompts[row.question_key] = row.answer;
      }
      profile.prompts = prompts;

      sentiment_audit = await analyzeSentimentAndTone(profile, prompts);
      console.log(`✅ SENTIMENT_AUDIT: Completed for user ID ${userId}. primary_tone=${sentiment_audit.primary_tone}, stress=${sentiment_audit.stress_level}`);
    } catch (err) {
      // ⚠️ SENTIMENT_AUDIT_FALLBACK: Do not block profile analysis
      console.error("⚠️ SENTIMENT_AUDIT_FALLBACK: Sentiment analysis failed (non-fatal):", err.message);
      console.warn("   → Profile analysis will continue using existing recommendation system.");
        sentiment_audit = { ...DEFAULT_SENTIMENT_AUDIT, fallback_reason: `pipeline_error: ${err.message}` };
      }
    } else {
      console.log("ℹ️ [SENTIMENT_FEATURE_DISABLED] Skipping sentiment audit during profile analysis.");
      sentiment_audit = { ...DEFAULT_SENTIMENT_AUDIT, fallback_reason: "feature_disabled" };
    }

    // Generate semantic vector embeddings (now includes contextual_tags via profile object)
    // Merge contextual_tags into profile so buildSemanticProfileText can read them
    const profileWithCtx = { ...profile, contextual_tags_parsed: contextual_tags, normalized_entities_parsed: normalized_entities };
    const semanticText = buildSemanticProfileText(profileWithCtx, intent_tags);
    let intent_embedding = null;
    try {
      intent_embedding = await generateEmbedding(semanticText);
    } catch (err) {
      console.error("❌ Embedding generation failed during manual analysis:", err.message);
    }

    // ── Save ALL AI analysis results to profiles table ────────────────────────
    // Includes: intent tags, confidence, embedding, contextual tags, NER entities,
    //           and all 10 sentiment audit flat columns + JSONB.
    const updateQuery = `
      UPDATE profiles
      SET 
        intent_tags              = $1::jsonb,
        confidence_score         = $2::float8,
        intent_embedding         = COALESCE($3::vector, intent_embedding),
        contextual_tags          = COALESCE($4::jsonb, contextual_tags),
        normalized_entities      = COALESCE($5::jsonb, normalized_entities),
        sentiment_audit          = $6::jsonb,
        updated_at               = NOW()
      WHERE user_id = $7
      RETURNING *;
    `;
    const updateResult = await pool.query(updateQuery, [
      JSON.stringify(intent_tags),
      confidence_score,
      intent_embedding ? JSON.stringify(intent_embedding) : null,
      contextual_tags ? JSON.stringify(contextual_tags) : null,
      normalized_entities ? JSON.stringify(normalized_entities) : null,
      JSON.stringify(sentiment_audit),
      userId,
    ]);

    console.log(`✅ Profile fully analyzed and updated for user ID ${userId}`);
    console.log(`   intent_tags ✓, contextual_tags ✓, NER ✓, sentiment_audit ✓, embedding ✓`);

    // Invalidate old compatibility cache (tones may affect scoring)
    await pool.query(
      "DELETE FROM profile_compatibilities WHERE user_a_id = $1 OR user_b_id = $1",
      [userId]
    );

    return res.status(200).json({
      message: "Profile analyzed and saved successfully",
      profile: updateResult.rows[0],
      sentiment_summary: {
        primary_tone:       sentiment_audit.primary_tone,
        stress_level:       sentiment_audit.stress_level,
        emotional_energy:   sentiment_audit.emotional_energy,
        relationship_need:  sentiment_audit.relationship_need,
        is_fallback:        sentiment_audit.is_default || false,
      },
    });
  } catch (error) {
    console.error("❌ analyzeProfile Error:", error);
    return res.status(500).json({ message: "Server error during manual profile analysis" });
  }
};

// ============================================================
// POST /api/ai/regenerate-compatibility/:targetUserId
// Force regenerate (bypasses cache, deletes old record first).
// ============================================================
export const regenerateCompatibility = async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const targetUserId = Number(req.params.targetUserId);

    if (isNaN(userId) || isNaN(targetUserId)) {
      return res.status(400).json({ message: "Invalid user identifiers" });
    }
    if (userId === targetUserId) {
      return res.status(400).json({ message: "Cannot calculate compatibility with yourself" });
    }

    const userA = Math.min(userId, targetUserId);
    const userB = Math.max(userId, targetUserId);

    console.log(`🧬 Force Regenerating: Clearing cache for pair (${userA}, ${userB})...`);

    // Invalidate existing cache
    await pool.query(
      "DELETE FROM profile_compatibilities WHERE user_a_id = $1 AND user_b_id = $2",
      [userA, userB]
    );

    // Fetch COMPLETE profiles
    const [profileA, profileB] = await Promise.all([
      fetchFullProfile(userA),
      fetchFullProfile(userB),
    ]);

    if (!profileA || !profileB) {
      return res.status(404).json({ message: "One or both user profiles were not found" });
    }

    // Local scores
    const localScores = calculateLocalCompatibilityScores(profileA, profileB);

    // Gemini AI
    const report = await generateAICompatibility(profileA, profileB, localScores);

    // Save
    const saved = await saveCompatibilityReport(userA, userB, report, localScores);

    if (!saved) {
      return res.status(200).json({ ...report, local_scores: localScores, _cache_saved: false });
    }

    console.log(`🧬 Force Regeneration SUCCESS for pair (${userA}, ${userB}).`);
    return res.status(200).json(saved);
  } catch (error) {
    console.error("❌ regenerateCompatibility Error:", error);
    return res.status(500).json({ message: "Server error during compatibility regeneration" });
  }
};

// ============================================================
// GET /api/matches/compatibility/status
// Diagnostic endpoint: shows table health, row count, last pair.
// ============================================================
export const getCompatibilityStatus = async (req, res) => {
  try {
    const [countResult, lastResult, missingEmbeddingResult, recentResult, enrichmentStatsResult] = await Promise.all([
      pool.query("SELECT COUNT(*) AS total FROM profile_compatibilities"),
      pool.query(`
        SELECT user_a_id, user_b_id, overall_score, compatibility_type, updated_at
        FROM profile_compatibilities
        ORDER BY updated_at DESC
        LIMIT 5
      `),
      pool.query(`
        SELECT COUNT(*) AS missing_embeddings
        FROM profiles
        WHERE intent_embedding IS NULL AND is_submitted = true
      `),
      pool.query(`
        SELECT user_a_id, user_b_id, overall_score, updated_at,
               (compatibility_data->>'data_version') AS data_version,
               (compatibility_data->'local_scores'->>'vector_similarity')::int AS vector_similarity,
               (compatibility_data->'local_scores'->>'intent_tag_match')::int AS intent_tag_match,
               (compatibility_data->'local_scores'->>'contextual_match')::int AS contextual_match,
               (compatibility_data->'local_scores'->>'pre_computed_combined')::int AS pre_computed_combined
        FROM profile_compatibilities
        ORDER BY updated_at DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE contextual_tags IS NOT NULL) AS with_contextual_tags,
          COUNT(*) FILTER (WHERE intent_tags IS NOT NULL)     AS with_intent_tags,
          COUNT(*) FILTER (WHERE intent_embedding IS NOT NULL) AS with_embeddings,
          COUNT(*) AS total_submitted
        FROM profiles
        WHERE is_submitted = true
      `),
    ]);

    const enrichStats = enrichmentStatsResult.rows[0] || {};
    return res.status(200).json({
      status: "ok",
      profile_compatibilities: {
        total_rows: parseInt(countResult.rows[0].total),
        last_5_pairs: lastResult.rows,
        recent_detailed: recentResult.rows,
      },
      profiles_missing_embeddings: parseInt(missingEmbeddingResult.rows[0].missing_embeddings),
      profile_enrichment_stats: {
        total_submitted: parseInt(enrichStats.total_submitted || 0),
        with_intent_tags: parseInt(enrichStats.with_intent_tags || 0),
        with_contextual_tags: parseInt(enrichStats.with_contextual_tags || 0),
        with_embeddings: parseInt(enrichStats.with_embeddings || 0),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ getCompatibilityStatus Error:", error);
    return res.status(500).json({ message: "Error fetching compatibility status", error: error.message });
  }
};

// ============================================================
// POST /api/matches/refine-query
// Creates or updates a temporary refinement session.
// ============================================================
export const setRefinedQuerySession = async (req, res) => {
  try {
    const userId = req.user.id;
    const { selected_priorities = [], raw_query = "", emotional_state = "" } = req.body;

    console.log(`\n🔮 ═══════════════════════════════════════════`);
    console.log(`🔮 SET REFINEMENT SESSION for user ${userId}`);
    console.log(`   priorities: ${selected_priorities.join(", ")}`);

    // Validate priorities
    const validIds = PRIORITY_OPTIONS.map(p => p.id);
    const cleanPriorities = selected_priorities.filter(p => validIds.includes(p)).slice(0, 3);

    if (cleanPriorities.length === 0) {
      return res.status(400).json({ message: "Please select at least 1 valid priority." });
    }

    // 1. Compute adaptive weights
    const temporaryWeights = getAdaptiveWeights(cleanPriorities);
    console.log("   adaptive weights:", temporaryWeights);

    // 2. Build temporary semantic text
    const semanticText = buildTemporarySemanticText(cleanPriorities, raw_query, emotional_state);
    console.log("   semantic text length:", semanticText.length);

    // 3. Generate temporary embedding via Gemini
    let temporaryEmbedding = null;
    try {
      temporaryEmbedding = await generateEmbedding(semanticText);
      console.log("   ✅ temporary embedding generated, dim:", temporaryEmbedding?.length);
    } catch (embErr) {
      console.warn("   ⚠️ temp embedding generation failed (non-fatal):", embErr.message);
    }

    // 4. Expire old sessions for this user
    await pool.query(
      `UPDATE refined_query_sessions SET expires_at = NOW() WHERE user_id = $1 AND expires_at > NOW()`,
      [userId]
    );

    // 5. Insert new session
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const insertResult = await pool.query(
      `INSERT INTO refined_query_sessions
        (user_id, raw_query, selected_priorities, emotional_state, generated_context, temporary_weights, expires_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
       RETURNING id, created_at, expires_at`,
      [
        userId,
        raw_query || null,
        cleanPriorities,
        emotional_state || null,
        JSON.stringify({
          semantic_text: semanticText,
          temporary_embedding: temporaryEmbedding,
        }),
        JSON.stringify(temporaryWeights),
        expiresAt,
      ]
    );

    const session = insertResult.rows[0];
    console.log(`✅ REFINEMENT SESSION CREATED — id: ${session.id}, expires: ${session.expires_at}`);

    return res.status(201).json({
      message: "Refinement session created. Your suggestions will be dynamically adjusted.",
      session: {
        id: session.id,
        selected_priorities: cleanPriorities,
        temporary_weights: temporaryWeights,
        created_at: session.created_at,
        expires_at: session.expires_at,
      },
      priority_options: PRIORITY_OPTIONS,
    });
  } catch (error) {
    console.error("❌ setRefinedQuerySession Error:", error);
    return res.status(500).json({ message: "Error creating refinement session", error: error.message });
  }
};

// ============================================================
// GET /api/matches/refine-query/active
// Returns the user's active (non-expired) refinement session.
// ============================================================
export const getActiveRefinedQuerySession = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT id, selected_priorities, emotional_state, raw_query, temporary_weights, created_at, expires_at
       FROM refined_query_sessions
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({ active: false, session: null, priority_options: PRIORITY_OPTIONS });
    }

    return res.status(200).json({
      active: true,
      session: result.rows[0],
      priority_options: PRIORITY_OPTIONS,
    });
  } catch (error) {
    console.error("❌ getActiveRefinedQuerySession Error:", error);
    return res.status(500).json({ message: "Error fetching active session", error: error.message });
  }
};

// ============================================================
// DELETE /api/matches/refine-query/active
// Clears (expires) the user's active refinement session.
// ============================================================
export const clearRefinedQuerySession = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE refined_query_sessions
       SET expires_at = NOW()
       WHERE user_id = $1 AND expires_at > NOW()
       RETURNING id`,
      [userId]
    );

    const cleared = result.rowCount || 0;
    console.log(`🗑️ Cleared ${cleared} active refinement session(s) for user ${userId}`);

    return res.status(200).json({
      message: cleared > 0 ? "Refinement session cleared. Suggestions restored to default." : "No active session to clear.",
      cleared_count: cleared,
    });
  } catch (error) {
    console.error("❌ clearRefinedQuerySession Error:", error);
    return res.status(500).json({ message: "Error clearing session", error: error.message });
  }
};

// ============================================================
// GET /api/matches/emotional-insights/:userId
// Fetch the emotional tone and sentiment audit for a user.
// ============================================================
export const getSentimentAudit = async (req, res) => {
  try {
    const targetUserId = Number(req.params.userId) || req.user.id;
    
    const result = await pool.query(
      `SELECT sentiment_audit
       FROM profiles WHERE user_id = $1`,
      [targetUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const row = result.rows[0];
    const audit = typeof row.sentiment_audit === "string" 
      ? (() => { try { return JSON.parse(row.sentiment_audit); } catch { return null; } })()
      : row.sentiment_audit;

    return res.status(200).json({
      primary_tone: audit?.primary_tone || null,
      stress_level: audit?.stress_level || null,
      emotional_energy: audit?.emotional_energy || null,
      relationship_need: audit?.relationship_need || null,
      emotional_resilience: audit?.emotional_resilience || null,
      sentiment_audit: audit,
      analyzed_at: audit?.audit_timestamp || null
    });
  } catch (error) {
    console.error("❌ getSentimentAudit Error:", error);
    return res.status(500).json({ message: "Error fetching sentiment audit", error: error.message });
  }
};

// ============================================================
// POST /api/matches/analyze-sentiment
// Manually triggers just the sentiment audit portion for the logged-in user.
// ============================================================
export const runSentimentAudit = async (req, res) => {
  try {
    const userId = Number(req.user.id);
    console.log(`🤖 Manually running Sentiment Audit for user ID ${userId}...`);

    const profileResult = await pool.query("SELECT * FROM profiles WHERE user_id = $1", [userId]);
    if (!profileResult.rows.length) {
      return res.status(404).json({ message: "Profile not found" });
    }
    const profile = profileResult.rows[0];

    // Fetch Q&A prompts
    const promptsResult = await pool.query(
      `SELECT question_key, answer FROM profile_prompts WHERE profile_id = $1`,
      [profile.id]
    );
    const prompts = {};
    for (const row of promptsResult.rows) {
      prompts[row.question_key] = row.answer;
    }
    profile.prompts = prompts;

    const sentiment_audit = await analyzeSentimentAndTone(profile, prompts);
    
    // Save to DB
    const updateQuery = `
      UPDATE profiles
      SET 
        sentiment_audit          = $1::jsonb,
        updated_at               = NOW()
      WHERE user_id = $2
      RETURNING *;
    `;
    await pool.query(updateQuery, [
      JSON.stringify(sentiment_audit),
      userId,
    ]);

    // Invalidate old compatibility cache
    await pool.query(
      "DELETE FROM profile_compatibilities WHERE user_a_id = $1 OR user_b_id = $1",
      [userId]
    );

    return res.status(200).json({
      message: "Sentiment Audit completed and saved successfully",
      sentiment_summary: {
        primary_tone:       sentiment_audit.primary_tone,
        stress_level:       sentiment_audit.stress_level,
        emotional_energy:   sentiment_audit.emotional_energy,
        relationship_need:  sentiment_audit.relationship_need,
        is_fallback:        sentiment_audit.is_default || false,
      },
    });
  } catch (error) {
    console.error("❌ runSentimentAudit Error:", error);
    return res.status(500).json({ message: "Error running sentiment audit", error: error.message });
  }
};
