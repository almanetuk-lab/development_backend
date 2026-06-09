import { pool } from "../config/db.js";
import { upsertUserVector, connectPinecone } from "../services/pineconeService.js";
import dotenv from "dotenv";

dotenv.config();

const runReindex = async () => {
  console.log("🚀 Starting Pinecone Reindexing Migration Script...");
  
  try {
    // 1. Check Pinecone connection
    const index = connectPinecone();
    if (!index) {
      console.error("❌ Pinecone connection failed. Exiting.");
      process.exit(1);
    }

    // 2. Fetch all profiles with valid embeddings from Supabase
    console.log("📥 Fetching profiles with embeddings from PostgreSQL...");
    const query = `
      SELECT user_id, intent_embedding, profession, city, intent_tags
      FROM profiles
      WHERE intent_embedding IS NOT NULL;
    `;
    const result = await pool.query(query);
    const profiles = result.rows;

    console.log(`📊 Found ${profiles.length} profiles to reindex.`);

    let successCount = 0;
    let failureCount = 0;
    let validationFailCount = 0;

    for (const profile of profiles) {
      const { user_id, intent_embedding, profession, city, intent_tags } = profile;

      // Parse pgvector representation if it is a string
      let vectorArray = null;
      if (typeof intent_embedding === "string") {
        vectorArray = intent_embedding.replace(/[\[\]]/g, "").split(",").map(Number);
      } else if (Array.isArray(intent_embedding)) {
        vectorArray = intent_embedding;
      }

      if (!vectorArray || vectorArray.length !== 768) {
        console.warn(`⚠️ Profile user_id=${user_id} has invalid vector dimensions (length: ${vectorArray ? vectorArray.length : 0}). Skipping.`);
        validationFailCount++;
        continue;
      }

      const parsedTags = typeof intent_tags === "string"
        ? (() => { try { return JSON.parse(intent_tags); } catch { return {}; } })()
        : intent_tags;

      // Upsert into Pinecone
      console.log(`🔄 Syncing user ${user_id} to Pinecone...`);
      const success = await upsertUserVector(user_id, vectorArray, {
        profession,
        city,
        intent_tags: parsedTags
      });

      if (success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    console.log("\n=========================================");
    console.log("🏁 Pinecone Reindexing Complete!");
    console.log(`✅ Success Sync Count   : ${successCount}`);
    console.log(`❌ Failure Sync Count   : ${failureCount}`);
    console.log(`⚠️ Validation Failures : ${validationFailCount}`);
    console.log("=========================================");

  } catch (error) {
    console.error("💥 Fatal error during reindexing:", error.message);
  } finally {
    try {
      await pool.end();
      console.log("🔌 Database connection pool closed.");
    } catch (dbCloseErr) {
      console.error("Error closing database pool:", dbCloseErr.message);
    }
  }
};

runReindex();
