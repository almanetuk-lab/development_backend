import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

dotenv.config();

let pc = null;
let pineconeIndex = null;

const NAMESPACE = process.env.PINECONE_NAMESPACE || "intentional-connection";
const EXPECTED_DIMENSION = 768;

/**
 * Initializes and returns the Pinecone Index instance.
 * Resolves configuration using PINECONE_HOST or PINECONE_INDEX.
 */
export const connectPinecone = () => {
  if (pineconeIndex) return pineconeIndex;

  try {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      console.warn("⚠️ connectPinecone: PINECONE_API_KEY environment variable is not set.");
      return null;
    }

    if (!pc) {
      pc = new Pinecone({ apiKey });
    }

    const host = process.env.PINECONE_HOST;
    const indexName = process.env.PINECONE_INDEX;

    if (host) {
      console.log(`🌲 [Pinecone] Connecting directly via Host: ${host}`);
      pineconeIndex = pc.index({ host });
    } else if (indexName) {
      console.log(`🌲 [Pinecone] Connecting via Index Name: ${indexName}`);
      pineconeIndex = pc.index(indexName);
    } else {
      console.warn("⚠️ connectPinecone: Neither PINECONE_HOST nor PINECONE_INDEX environment variables are set.");
      return null;
    }

    console.log("🌲 [Pinecone] Connected to Pinecone Index successfully.");
    return pineconeIndex;
  } catch (error) {
    console.error("❌ [Pinecone] Failed to connect to Pinecone:", error.message);
    return null;
  }
};

/**
 * Helper to validate vector dimensions before upsert operations.
 */
const isValidVector = (vector) => {
  if (!vector || !Array.isArray(vector)) {
    console.error("❌ [Pinecone] Validation failed: Vector must be a valid array.");
    return false;
  }
  if (vector.length !== EXPECTED_DIMENSION) {
    console.error(`❌ [Pinecone] Validation failed: Expected vector dimension to be ${EXPECTED_DIMENSION}, but got ${vector.length}.`);
    return false;
  }
  return true;
};

/**
 * Upserts a user's vector and metadata to the Pinecone index.
 */
export const upsertUserVector = async (userId, vector, metadata = {}) => {
  try {
    const index = connectPinecone();
    if (!index) {
      console.warn("⚠️ [Pinecone] Operation skipped: Pinecone index connection is not available.");
      return false;
    }

    if (!isValidVector(vector)) {
      return false;
    }

    // Format metadata fields as requested: userId, profession, city, ambition_level, social_preference, stress_cycle, intent_tags, updated_at
    const intentTagsObj = metadata.intent_tags || {};
    const intentTagsString = typeof intentTagsObj === "string" 
      ? intentTagsObj 
      : JSON.stringify(intentTagsObj);

    const parsedTags = typeof intentTagsObj === "string"
      ? (() => { try { return JSON.parse(intentTagsObj); } catch { return {}; } })()
      : intentTagsObj;

    const pineconeMetadata = {
      userId: String(userId),
      profession: metadata.profession || "",
      city: metadata.city || "",
      ambition_level: parsedTags?.ambition_level || metadata.ambition_level || "",
      social_preference: parsedTags?.social_preference || metadata.social_preference || "",
      stress_cycle: parsedTags?.stress_cycle || metadata.stress_cycle || "",
      intent_tags: intentTagsString,
      updated_at: new Date().toISOString()
    };

    console.log(`🌲 [Pinecone] Upserting user ${userId} in namespace "${NAMESPACE}"...`);
    await index.namespace(NAMESPACE).upsert({
      records: [
        {
          id: String(userId),
          values: vector,
          metadata: pineconeMetadata
        }
      ]
    });
    console.log(`✅ [Pinecone] User ${userId} vector upserted successfully.`);
    return true;
  } catch (error) {
    console.error(`❌ [Pinecone] Error upserting vector for user ${userId}:`, error.message);
    return false;
  }
};

/**
 * Updates a user's vector and metadata in Pinecone. Fallback to upsert if not found.
 */
export const updateUserVector = async (userId, vector, metadata = {}) => {
  try {
    const index = connectPinecone();
    if (!index) {
      console.warn("⚠️ [Pinecone] Operation skipped: Pinecone index connection is not available.");
      return false;
    }

    if (vector && !isValidVector(vector)) {
      return false;
    }

    const intentTagsObj = metadata.intent_tags || {};
    const intentTagsString = typeof intentTagsObj === "string"
      ? intentTagsObj
      : JSON.stringify(intentTagsObj);

    const parsedTags = typeof intentTagsObj === "string"
      ? (() => { try { return JSON.parse(intentTagsObj); } catch { return {}; } })()
      : intentTagsObj;

    const pineconeMetadata = {
      userId: String(userId),
      profession: metadata.profession || "",
      city: metadata.city || "",
      ambition_level: parsedTags?.ambition_level || metadata.ambition_level || "",
      social_preference: parsedTags?.social_preference || metadata.social_preference || "",
      stress_cycle: parsedTags?.stress_cycle || metadata.stress_cycle || "",
      intent_tags: intentTagsString,
      updated_at: new Date().toISOString()
    };

    console.log(`🌲 [Pinecone] Updating user ${userId} in namespace "${NAMESPACE}"...`);
    await index.namespace(NAMESPACE).update({
      id: String(userId),
      values: vector || undefined,
      setMetadata: pineconeMetadata
    });
    console.log(`✅ [Pinecone] User ${userId} vector updated successfully.`);
    return true;
  } catch (error) {
    console.warn(`⚠️ [Pinecone] Update failed for user ${userId}: ${error.message}. Falling back to upsert...`);
    if (vector) {
      return upsertUserVector(userId, vector, metadata);
    }
    return false;
  }
};

/**
 * Deletes a user's vector from Pinecone.
 */
export const deleteUserVector = async (userId) => {
  try {
    const index = connectPinecone();
    if (!index) {
      console.warn("⚠️ [Pinecone] Operation skipped: Pinecone index connection is not available.");
      return false;
    }

    console.log(`🌲 [Pinecone] Deleting user ${userId} from namespace "${NAMESPACE}"...`);
    await index.namespace(NAMESPACE).delete({
      ids: [String(userId)]
    });
    console.log(`✅ [Pinecone] User ${userId} vector deleted successfully.`);
    return true;
  } catch (error) {
    console.error(`❌ [Pinecone] Error deleting vector for user ${userId}:`, error.message);
    return false;
  }
};

/**
 * Searches similar profiles in Pinecone index.
 */
export const searchSimilarProfiles = async (vector, limit = 25) => {
  try {
    const index = connectPinecone();
    if (!index) {
      console.warn("⚠️ [Pinecone] Operation skipped: Pinecone index connection is not available.");
      return [];
    }

    if (!vector || !Array.isArray(vector)) {
      console.error("❌ [Pinecone] Search failed: Invalid query vector.");
      return [];
    }

    console.log(`🌲 [Pinecone] Querying namespace "${NAMESPACE}" for top ${limit} matches...`);
    const result = await index.namespace(NAMESPACE).query({
      vector,
      topK: limit,
      includeMetadata: true
    });

    return result.matches || [];
  } catch (error) {
    console.error("❌ [Pinecone] Error querying Pinecone:", error.message);
    return [];
  }
};
