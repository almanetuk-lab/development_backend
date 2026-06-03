import { pool } from "../config/db.js";
import { extractIntentTags } from "../services/geminiService.js";
import { buildSemanticProfileText, generateEmbedding } from "../services/embeddingService.js";

async function runPipelineForUser(userId, profession, aboutMe) {
  console.log(`\n--- RUNNING PIPELINE FOR USER ID ${userId} ---`);
  console.log(`Profession: ${profession}`);
  console.log(`About Me: "${aboutMe}"`);

  let intent_tags = null;
  let confidence_score = null;
  let intent_embedding = null;
  let semanticText = null;

  // 1. Gemini parsing and confidence score
  try {
    const geminiResult = await extractIntentTags(aboutMe);
    intent_tags = geminiResult.intent_tags;
    confidence_score = geminiResult.confidence_score;
    console.log("✅ extractIntentTags returned successfully.");
  } catch (error) {
    console.error("❌ Gemini parsing failed:", error.message);
    intent_tags = {
      ambition_level: "Moderate",
      stress_cycle: "Balanced",
      social_preference: "Moderate",
      communication_style: "Friendly",
      relationship_intent: "Meaningful",
    };
    confidence_score = 0.50;
  }

  // 2. Semantic Profile Text
  semanticText = buildSemanticProfileText(profession, aboutMe, intent_tags);
  console.log(`Semantic profile text: "${semanticText}"`);

  // 3. Generate Embedding
  try {
    intent_embedding = await generateEmbedding(semanticText);
  } catch (error) {
    console.error("❌ Generating embedding failed:", error.message);
  }

  // 4. Save to PostgreSQL (simulating profileController UPDATE query)
  const updateQuery = `
    UPDATE profiles
    SET 
      profession = $1,
      about_me = COALESCE($2, about_me),
      intent_tags = COALESCE($3::jsonb, intent_tags),
      intent_embedding = COALESCE($5::vector, intent_embedding),
      confidence_score = COALESCE($6::float8, confidence_score)
    WHERE user_id = $4
    RETURNING id, user_id, profession, about_me, intent_tags, confidence_score, (intent_embedding IS NOT NULL) AS has_embedding;
  `;

  const values = [
    profession,
    aboutMe,
    intent_tags ? JSON.stringify(intent_tags) : null,
    userId,
    intent_embedding ? JSON.stringify(intent_embedding) : null,
    confidence_score,
  ];

  // LOGS REQUIRED BY USER
  console.log("=========================================");
  console.log("🤖 PROFILE UPDATE PIPELINE PIPELINE LOGS");
  console.log("USER ID:", userId);
  console.log("ABOUT ME RECEIVED:", aboutMe);
  console.log("GENERATED INTENT TAGS:", intent_tags ? JSON.stringify(intent_tags) : "null");
  console.log("GENERATED CONFIDENCE SCORE:", confidence_score);
  console.log("SEMANTIC TEXT:", semanticText);
  console.log("EMBEDDING DIMENSIONS COUNT:", intent_embedding ? intent_embedding.length : 0);
  console.log("=========================================");

  try {
    const res = await pool.query(updateQuery, values);
    if (res.rows.length > 0) {
      const row = res.rows[0];
      console.log("==================================================");
      console.log("✅ PROFILE UPDATED SUCCESSFULLY IN DB");
      console.log("PROFILE ID:", row.id);
      console.log("SAVED ABOUT ME:", row.about_me);
      console.log("SAVED INTENT TAGS:", JSON.stringify(row.intent_tags));
      console.log("SAVED CONFIDENCE SCORE:", row.confidence_score);
      console.log("HAS VECTOR EMBEDDING:", row.has_embedding);
      console.log("DB SAVE SUCCESS: true");
      console.log("==================================================");
    } else {
      console.log("❌ PROFILE UPDATE FAILED: No row returned");
    }
  } catch (dbError) {
    console.error("❌ PostgreSQL Database save failed:", dbError.message);
  }
}

async function main() {
  try {
    // Test Case 1: Structured bio
    const bio1 = "I work long hours but value deep emotional connection";
    await runPipelineForUser(105, "Software Engineer", bio1);

    // Test Case 2: Vague bio
    const bio2 = "I want partner";
    await runPipelineForUser(190, "Freelancer", bio2);

    process.exit(0);
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exit(1);
  }
}

main();
