import { pool } from "../config/db.js";
import { extractIntentTags, enrichContextualMetadata } from "../services/geminiService.js";
import { buildSemanticProfileText, generateEmbedding } from "../services/embeddingService.js";
import { extractProfessionalEntities } from "../services/entityRecognitionService.js";
// Point #9: Sentiment audit + feature flag
import { analyzeSentimentAndTone } from "../services/sentimentAuditService.js";
import { isSentimentAuditEnabled } from "../config/sentimentConfig.js";
// Point #9: Deduplication guard + broadened trigger condition
import {
  acquireRecalcLock,
  releaseRecalcLock,
  hasRecalculatableData,
} from "../services/vectorRecalculationService.js";
import { generateSpiderGraphData } from "../services/spiderGraphService.js";

// 🟢 Update Profile 
export const updateProfile = async (req, res) => {
  try {
    const {
      email,
      first_name,
      last_name,
      headline,
      phone,
      dob,
      age,
      education,
      company,
      experience,
      gender,
      marital_status,
      address,
      profession,
      skills,
      interests,
      about,
      city,
      state,
      country,
      pincode,
      company_type,
      position,
      hobbies,
      professional_identity,
      interested_in,
      relationship_goal,
      children_preference,
      education_institution_name,
      languages_spoken,
      zodiac_sign,
      self_expression,
      freetime_style,
      health_activity_level,
      pets_preference,
      religious_belief,
      smoking,
      drinking,
      work_environment,
      interaction_style,
      work_rhythm,
      career_decision_style,
      work_demand_response,
      love_language_affection,
      preference_of_closeness,
      approach_to_physical_closeness,
      relationship_values,
      values_in_others,
      relationship_pace,
      height_ft,
      height_in,
      life_rhythms,
      ways_i_spend_time,
      prompts,
      about_me,
    } = req.body;

    if (!email || !first_name || !last_name || !dob || age === undefined || age === null) {
      return res.status(400).json({
        message: "Email, First name, Last name, DOB and Age are required",
      });
    }

    const userId = req.user.id
    console.log("ABOUT ME:", about_me);
    const imageUrl = req.file ? req.file.path : null;

    // HEIGHT LOGIC (ONLY ONE COLUMN)
    // =========================
    let height;

    if (height_ft !== undefined || height_in !== undefined) {
      if (height_ft === undefined || height_in === undefined) {
        return res.status(400).json({
          message: "Both height_ft and height_in are required",
        });
      }

      const ft = Number(height_ft);
      const inch = Number(height_in);

      if (Number.isNaN(ft) || Number.isNaN(inch) || inch < 0 || inch > 11) {
        return res.status(400).json({ message: "Invalid height" });
      }

      height = ft * 12 + inch;
    }

    // --- DEEP LOGGING INITIATED ---
    console.log("==================================================");
    console.log("🛠️  PROFILE UPDATE PIPELINE INITIATED");
    console.log("USER ID (from token):", userId);
    console.log("ABOUT ME RECEIVED:", about_me);
    console.log("==================================================");

    // --- Gemini Intent & Contextual Enrichment Pipeline ---
    let intent_tags = null;
    let confidence_score = null;
    let contextual_tags = null;
    let intent_embedding = null;
    let semanticText = null;
    let normalized_entities = null;
    let sentiment_audit = null; // Point #9: Sentiment & tone audit result
    let spider_graph_data = null; // Point #10: Spider Graph Data

    // Point #9: Broadened trigger — fires on ANY field that influences intent,
    // lifestyle, rhythm, stress cycle, social preference, sentiment, or profession.
    const hasData = hasRecalculatableData({
      about_me, profession, prompts,
      relationship_goal, relationship_values, life_rhythms,
      work_environment, work_rhythm, health_activity_level,
      religious_belief, freetime_style, smoking, drinking,
      city, company, company_type, interested_in,
      relationship_pace, love_language_affection,
      self_expression, career_decision_style, work_demand_response,
    });

    if (hasData) {
      // ── Point #9: Deduplication guard ────────────────────────────────────────
      // Prevents concurrent embedding regeneration for the same user.
      // If a recalculation is already running (e.g., rapid duplicate saves),
      // skip the AI pipeline this time — the existing DB values are preserved.
      const lockAcquired = acquireRecalcLock(userId);
      if (!lockAcquired) {
        console.log(`⏭️  [ProfileUpdate] Recalculation already in progress for user ${userId} — AI pipeline skipped this call.`);
      } else {
        try {
          const profileData = {
            about_me,
            profession,
            company,
            company_type,
            city,
            state,
            country,
            relationship_goal,
            relationship_values,
            life_rhythms,
            work_environment,
            work_rhythm,
            health_activity_level,
            religious_belief,
            freetime_style,
          };

          // Step 1: NER — Normalized Professional Entities
          console.log("🤖 [ProfileUpdate] Step 1: Generating normalized entities...");
          try {
            normalized_entities = await extractProfessionalEntities(profileData, prompts);
            console.log("🤖 GENERATED normalized_entities:", normalized_entities);
          } catch (nerError) {
            console.error("❌ NER extraction failed:", nerError.message);
            normalized_entities = null;
          }

          // Step 2: Intent Tags + Confidence Score
          console.log("🤖 [ProfileUpdate] Step 2: Generating intent tags and confidence score...");
          try {
            const geminiResult = await extractIntentTags(profileData, prompts);
            intent_tags = geminiResult.intent_tags;
            confidence_score = geminiResult.confidence_score;
            console.log("🤖 GENERATED intent_tags:", intent_tags);
            console.log("🤖 GENERATED confidence_score:", confidence_score);
          } catch (geminiError) {
            console.error("❌ Gemini intent tag extraction failed:", geminiError.message);
            intent_tags = {
              ambition_level: "Moderate",
              stress_cycle: "Balanced",
              social_preference: "Moderate",
              communication_style: "Friendly",
              relationship_intent: "Meaningful",
            };
            confidence_score = 0.50;
          }

          // Step 3: Contextual Metadata Enrichment
          console.log("🤖 [ProfileUpdate] Step 3: Generating contextual metadata tags...");
          try {
            contextual_tags = await enrichContextualMetadata(profileData, prompts);
            console.log("🤖 GENERATED contextual_tags:", contextual_tags);
          } catch (contextError) {
            console.error("❌ Gemini contextual metadata enrichment failed:", contextError.message);
            contextual_tags = {
              city_energy: "Moderate",
              cost_of_living: "Moderate",
              career_pressure: "Moderate",
              commute_stress: "Moderate",
              social_environment: "Balanced",
              emotional_environment: "Balanced",
              lifestyle_intensity: "Balanced"
            };
          }

          // Step 4: Sentiment Audit (Point #9 — feature-flag gated)
          if (isSentimentAuditEnabled()) {
            console.log("🧠 [ProfileUpdate] Step 4: Running sentiment audit...");
            try {
              const sentimentProfile = {
                about_me,
                profession,
                work_environment,
                work_rhythm,
                relationship_goal,
                relationship_values,
                life_rhythms,
                freetime_style,
                health_activity_level,
              };
              sentiment_audit = await analyzeSentimentAndTone(sentimentProfile, prompts);
              console.log(`🧠 [ProfileUpdate] Sentiment: tone=${sentiment_audit?.primary_tone}, stress=${sentiment_audit?.stress_level}, resilience=${sentiment_audit?.emotional_resilience}`);
            } catch (sentimentError) {
              console.error("❌ Sentiment audit failed (non-fatal):", sentimentError.message);
              sentiment_audit = null;
            }
          } else {
            console.log("ℹ️  [ProfileUpdate] Step 4: Sentiment audit SKIPPED (ENABLE_SENTIMENT_AUDIT=false).");
          }

          // Step 4.5: Spider Graph Data Generation (Point #10)
          console.log("🕸️  [ProfileUpdate] Step 4.5: Generating spider graph data...");
          try {
            spider_graph_data = generateSpiderGraphData(
              intent_tags,
              contextual_tags,
              sentiment_audit,
              normalized_entities
            );
            console.log(`🕸️ [ProfileUpdate] Spider Graph: Professional=${spider_graph_data.professional_alignment}, Lifestyle=${spider_graph_data.lifestyle_sync}, Emotional=${spider_graph_data.emotional_readiness}`);
          } catch (spiderError) {
            console.error("❌ Spider graph generation failed:", spiderError.message);
            spider_graph_data = null;
          }

          // Step 5: Semantic Profile Text + Embedding
          console.log("🤖 [ProfileUpdate] Step 5: Generating semantic profile text + embedding...");
          const fullProfileForEmbedding = {
            ...profileData,
            contextual_tags_parsed: contextual_tags,
            normalized_entities,
            relationship_pace,
            love_language_affection,
            children_preference,
            interested_in,
            work_environment,
            health_activity_level,
            religious_belief,
            freetime_style,
            interests_parsed: typeof interests === "object" ? interests : null,
            hobbies_parsed: typeof hobbies === "object" ? hobbies : null,
            prompts,
          };
          semanticText = buildSemanticProfileText(fullProfileForEmbedding, intent_tags);
          console.log("🤖 Semantic Profile Text:", semanticText);

          console.log("🤖 Generating intent embedding vector...");
          try {
            intent_embedding = await generateEmbedding(semanticText);
            console.log(`✅ Embedding generated: ${intent_embedding ? intent_embedding.length + "d" : "null (failed)"}`);
          } catch (embedError) {
            console.error("❌ Generating embedding failed:", embedError.message);
          }

        } finally {
          // Always release the deduplication lock — even if an error occurs
          releaseRecalcLock(userId);
          console.log(`🔓 [ProfileUpdate] Recalculation lock released for user ${userId}`);
        }
      }
    } else {
      console.log("ℹ️ No significant profile data provided — AI tags and embeddings will not be updated.");
    }

    const updateProfileQuery = `
      UPDATE profiles
      SET 
        first_name = $1,
        last_name = $2,
        phone = $3,
        gender = $4,
        marital_status = $5,
        address = $6,
        profession = $7,
        skills = $8,
        interests = $9,
        about = $10,
        city = $11,
        state = $12,
        country = $13,
        pincode = $14,
        headline = $15,
        dob = $16,
        age = $17,
        education = $18,
        company = $19,
        company_type = $20,
        experience = $21,
        position = $22,
        hobbies = $23,
        professional_identity = $24,
        interested_in = $25,
        relationship_goal = $26,
        children_preference = $27,
        education_institution_name = $28,
        languages_spoken = $29,
        zodiac_sign = $30,
        self_expression = $31,
        freetime_style = $32,
        health_activity_level = $33,
        pets_preference = $34,
        religious_belief = $35,
        smoking = $36,
        drinking = $37,
        work_environment = $38,
        interaction_style = $39,
        work_rhythm = $40,
        career_decision_style = $41,
        work_demand_response = $42,
        love_language_affection = $43,
        preference_of_closeness = $44,
        approach_to_physical_closeness = $45,
        relationship_values = $46,
        values_in_others = $47,
        relationship_pace = $48,
        height = $49,
        life_rhythms = $50,
        about_me = COALESCE($51, about_me),
        ways_i_spend_time = $52,
        image_url = COALESCE($53, image_url),
        intent_tags = COALESCE($54::jsonb, intent_tags),
        contextual_tags = COALESCE($58::jsonb, contextual_tags),
        normalized_entities = COALESCE($59::jsonb, normalized_entities),
        sentiment_audit     = COALESCE($60::jsonb, sentiment_audit),
        spider_graph_data   = COALESCE($61::jsonb, spider_graph_data),
        updated_at = NOW(),
        is_submitted = true,
        intent_embedding = COALESCE($56::vector, intent_embedding),
        confidence_score = COALESCE($57::float8, confidence_score)
      WHERE user_id = $55
      RETURNING *;
    `;

    const profileValues = [
      first_name,
      last_name,
      phone,
      gender,
      marital_status,
      address,
      profession,
      JSON.stringify(skills || {}),
      JSON.stringify(interests || {}),
      about,
      city,
      state,
      country,
      pincode,
      headline,
      dob,
      age,
      education,
      company,
      company_type,
      experience,
      position,
      JSON.stringify(hobbies || {}),
      professional_identity,
      interested_in,
      relationship_goal,
      children_preference,
      education_institution_name,
      languages_spoken, // text[] — pass as array
      zodiac_sign,
      self_expression,
      freetime_style,
      health_activity_level,
      pets_preference,
      religious_belief,
      smoking,
      drinking,
      work_environment,
      interaction_style,
      work_rhythm,
      career_decision_style,
      work_demand_response,
      love_language_affection, // enum — pass as enum string
      preference_of_closeness,
      approach_to_physical_closeness,
      relationship_values,
      values_in_others,
      relationship_pace,
      height,
      JSON.stringify(life_rhythms || {}),
      about_me,
      JSON.stringify(ways_i_spend_time || {}),
      imageUrl,
      intent_tags ? JSON.stringify(intent_tags) : null, // null → COALESCE keeps existing DB value
      userId,
      intent_embedding ? JSON.stringify(intent_embedding) : null, // $56
      confidence_score !== null && confidence_score !== undefined ? confidence_score : null, // $57
      contextual_tags ? JSON.stringify(contextual_tags) : null, // $58
      normalized_entities ? JSON.stringify(normalized_entities) : null, // $59
      sentiment_audit ? JSON.stringify(sentiment_audit) : null, // $60 — Point #9
      spider_graph_data ? JSON.stringify(spider_graph_data) : null, // $61 — Point #10
    ];
    console.log("=========================================");
    console.log("🤖 PROFILE UPDATE PIPELINE PIPELINE LOGS");
    console.log("USER ID:", req.user.id);
    console.log("ABOUT ME RECEIVED:", about_me);
    console.log("GENERATED INTENT TAGS:", intent_tags ? JSON.stringify(intent_tags) : "null");
    console.log("GENERATED CONFIDENCE SCORE:", confidence_score);
    console.log("SEMANTIC TEXT:", semanticText);
    console.log("EMBEDDING DIMENSIONS COUNT:", intent_embedding ? intent_embedding.length : 0);
    console.log("FINAL SQL PARAMS:", profileValues);
    console.log("=========================================");

    const profileResult = await pool.query(updateProfileQuery, profileValues);

    // Invalidate compatibility cache for this updated profile
    console.log(`🧬 Profile updated. Invalidating compatibility cache for user ID ${userId}...`);
    try {
      await pool.query("DELETE FROM profile_compatibilities WHERE user_a_id = $1 OR user_b_id = $1", [userId]);
      console.log(`🧬 Successfully deleted cached compatibilities containing user ID ${userId}.`);
    } catch (cacheErr) {
      console.error("❌ Failed to clear compatibility cache on profile update:", cacheErr.message);
    }

    console.log("==================================================");
    if (profileResult.rows.length > 0) {
      console.log("✅ PROFILE UPDATED SUCCESSFULLY IN DB");
      console.log("PROFILE ID:", profileResult.rows[0].id);
      console.log("SAVED ABOUT ME:", profileResult.rows[0].about_me);
      console.log("SAVED INTENT TAGS:", profileResult.rows[0].intent_tags ? "Present" : "Null");
      console.log("SAVED CONFIDENCE SCORE:", profileResult.rows[0].confidence_score);
      console.log("DB SAVE SUCCESS: true");
    } else {
      console.log("❌ PROFILE UPDATE FAILED: No row returned");
    }
    console.log("==================================================");

    if (!profileResult.rows.length) {
      return res.status(404).json({ message: "Profile not found" });
    }

    let savedPrompts = [];
    if (
      prompts &&
      typeof prompts === "object" &&
      Object.keys(prompts).length > 0
    ) {
      savedPrompts = await saveOrUpdateProfilePrompts(
        profileResult.rows[0].id,
        prompts,
      );
    }

    const updateUserQuery = `
      UPDATE users
      SET email = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, email;
    `;
    const userResult = await pool.query(updateUserQuery, [email, userId]);

    if (!userResult.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    // Optionally remove sensitive or unwanted fields from response
    const {
      dob: removedDob,
      age: removedAge,
      ...safeProfile
    } = profileResult.rows[0];

    const profileWithPrompts = {
      ...safeProfile,
      prompts: savedPrompts.reduce((acc, cur) => {
        acc[cur.question_key] = cur.answer;
        return acc;
      }, {}),
    };

    return res.status(200).json({
      message: "Profile and email updated successfully",
      user: userResult.rows[0],
      profile: profileWithPrompts,
      // prompts: savedPrompts, // Uncomment if you want to return saved prompts
    });
  } catch (error) {
    console.error("Error updating profile and email:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// 🟢 Get Profile
export const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const userQuery = `
      SELECT id, email
      FROM users
      WHERE id = $1
    `;
    const userResult = await pool.query(userQuery, [userId]);

    if (!userResult.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    const profileQuery = `
      SELECT 
        id,
        first_name,
        last_name,
        phone,
        gender,
        marital_status,
        address,
        profession,
        skills,
        interests,
        hobbies,
        about,
        city,
        state,
        country,
        pincode,
        headline,
        dob,
        age,
        education,
        company,
        company_type,
        experience,
        position,
        professional_identity,
        interested_in,
        relationship_goal,
        children_preference,
        education_institution_name,
        languages_spoken,
        zodiac_sign,
        self_expression,
        freetime_style,
        health_activity_level,
        pets_preference,
        religious_belief,
        smoking,
        drinking,
        work_environment,
        interaction_style,
        work_rhythm,
        career_decision_style,
        work_demand_response,
        love_language_affection,
        preference_of_closeness,
        approach_to_physical_closeness,
        relationship_values,
        values_in_others,
        relationship_pace,
        height,
        life_rhythms,
        username,
        about_me,
        ways_i_spend_time,
        image_url,
        intent_tags,
        contextual_tags,
        confidence_score,
        sentiment_audit,
        spider_graph_data,
        is_submitted,
        updated_at
      FROM profiles
      WHERE user_id = $1
    `;

    const profileResult = await pool.query(profileQuery, [userId]);

    const user = userResult.rows[0];
    const profile = profileResult.rows.length ? profileResult.rows[0] : {};

    // pull profile prompts (questions and answers)
    let prompts = {};

    if (profile && profile.id) {
      const promptsQuery = `
        SELECT question_key, answer
        FROM profile_prompts
        WHERE profile_id = $1
      `;

      const promptsResult = await pool.query(promptsQuery, [profile.id]);

      for (const row of promptsResult.rows) {
        prompts[row.question_key] = row.answer;
      }
    }

    const combinedData = {
      id: profile.id,
      user_id: user.id,
      email: user.email,
      first_name: profile.first_name || null,
      last_name: profile.last_name || null,
      profession: profile.profession || null,
      phone: profile.phone || null,
      gender: profile.gender || null,
      marital_status: profile.marital_status || null,
      address: profile.address || null,
      city: profile.city || null,
      state: profile.state || null,
      country: profile.country || null,
      pincode: profile.pincode || null,
      skills: profile.skills || null,
      interests: profile.interests || null,
      hobbies: profile.hobbies || null,
      about: profile.about || null,
      headline: profile.headline || null,
      dob: profile.dob || null,
      age: profile.age || null,
      education: profile.education || null,
      company: profile.company || null,
      company_type: profile.company_type || null,
      experience: profile.experience || null,
      position: profile.position || null,
      professional_identity: profile.professional_identity || null,
      interested_in: profile.interested_in || null,
      relationship_goal: profile.relationship_goal || null,
      children_preference: profile.children_preference || null,
      education_institution_name: profile.education_institution_name || null,
      languages_spoken: profile.languages_spoken || null,
      zodiac_sign: profile.zodiac_sign || null,
      self_expression: profile.self_expression || null,
      freetime_style: profile.freetime_style || null,
      health_activity_level: profile.health_activity_level || null,
      pets_preference: profile.pets_preference || null,
      religious_belief: profile.religious_belief || null,
      smoking: profile.smoking || null,
      drinking: profile.drinking || null,
      work_environment: profile.work_environment || null,
      interaction_style: profile.interaction_style || null,
      work_rhythm: profile.work_rhythm || null,
      career_decision_style: profile.career_decision_style || null,
      work_demand_response: profile.work_demand_response || null,
      love_language_affection: profile.love_language_affection || null,
      preference_of_closeness: profile.preference_of_closeness || null,
      approach_to_physical_closeness:
        profile.approach_to_physical_closeness || null,
      relationship_values: profile.relationship_values || null,
      values_in_others: profile.values_in_others || null,
      relationship_pace: profile.relationship_pace || null,
      height: profile.height || null,
      life_rhythms: profile.life_rhythms || null,
      ways_i_spend_time: profile.ways_i_spend_time || null,
      username: profile.username || null,
      about_me: profile.about_me || null,
      intent_tags: profile.intent_tags || null,
      contextual_tags: profile.contextual_tags || null,
      confidence_score: profile.confidence_score !== null && profile.confidence_score !== undefined ? profile.confidence_score : null,
      image_url: profile.image_url || null,
      is_submitted: profile.is_submitted || false,
      updated_at: profile.updated_at || null,
    };
    console.log("my profile data:", combinedData);
    res.status(200).json({
      message: "Profile fetched successfully",
      data: combinedData,
      prompts: prompts,
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
// Helper function to save or update profile prompts
//   return results;
const saveOrUpdateProfilePrompts = async (profileId, prompts) => {
  if (!prompts || typeof prompts !== "object") return [];

  const query = `
    INSERT INTO profile_prompts (profile_id, question_key, answer)
    VALUES ($1, $2, $3)
    ON CONFLICT (profile_id, question_key)
    DO UPDATE SET 
      answer = EXCLUDED.answer,
      updated_at = NOW()
    RETURNING profile_id, question_key, answer;
  `;

  const results = [];

  for (const [question_key, answer] of Object.entries(prompts)) {
    const { rows } = await pool.query(query, [profileId, question_key, answer]);
    results.push(rows[0]);
  }

  return results;
};

/* Example of prompts object:

"little_about_you": {
    "question-key" : {
         "small_habit": "I journal daily",
         "life_goal": "Build a peaceful life",
         "home_moment": "Sunday mornings with family"
    }
  }  */
