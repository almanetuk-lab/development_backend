/**
 * Central Gemini text-generation configuration.
 *
 * Model names come from the environment so they can be changed without a
 * code change or redeploy of new code:
 *
 *   GEMINI_MODEL=gemini-flash-lite-latest      (tried first)
 *   GEMINI_FALLBACK_MODEL=gemini-2.5-flash     (tried if the first one fails)
 *
 * All text generation should go through `generateContentWithFallback` instead
 * of calling `genAI.getGenerativeModel({ model: "..." })` with a hardcoded name.
 *
 *   GEMINI_EMBEDDING_MODEL=gemini-embedding-2  (profile vectors)
 *
 * The embedding model has no fallback on purpose: vectors from two different
 * embedding models live in different spaces, so mixing them silently breaks
 * cosine-similarity matching. Changing it means re-embedding every profile
 * (recalculateUserVector) so all stored vectors come from the same model.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

// Load .env here too: ESM evaluates this module before the importing
// service's own dotenv.config() call runs.
dotenv.config();

const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";
const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";

export const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/** Primary model, then fallback model, de-duplicated. Read at call time. */
export const getGeminiModelChain = () => {
  const primary = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const fallback = process.env.GEMINI_FALLBACK_MODEL?.trim() || DEFAULT_GEMINI_FALLBACK_MODEL;
  return primary === fallback ? [primary] : [primary, fallback];
};

/** Embedding model for profiles.intent_embedding. Read at call time. */
export const getGeminiEmbeddingModel = () =>
  process.env.GEMINI_EMBEDDING_MODEL?.trim() || DEFAULT_GEMINI_EMBEDDING_MODEL;

/**
 * Calls generateContent on GEMINI_MODEL, retrying once on GEMINI_FALLBACK_MODEL
 * if the first call throws.
 *
 * @param {string|object} request - Same argument model.generateContent accepts.
 * @param {object} [options]
 * @param {string} [options.label]           - Log prefix, e.g. "HandshakeService".
 * @param {object} [options.generationConfig]
 * @returns {Promise<{ result: object, text: string, modelName: string }>}
 * @throws {Error} with `.errors` = [{ modelName, error }] when every model fails.
 */
export const generateContentWithFallback = async (request, { label = "Gemini", generationConfig } = {}) => {
  const failures = [];

  for (const modelName of getGeminiModelChain()) {
    try {
      const model = genAI.getGenerativeModel(
        generationConfig ? { model: modelName, generationConfig } : { model: modelName }
      );
      const result = await model.generateContent(request);
      const text = result.response.text();
      if (failures.length) {
        console.log(`✅ [${label}] Succeeded on fallback model ${modelName}`);
      }
      return { result, text, modelName };
    } catch (error) {
      failures.push({ modelName, error });
      console.warn(`⚠️ [${label}] Gemini model ${modelName} failed (status ${error?.status ?? "n/a"}):`, error.message);
    }
  }

  const err = new Error(
    `All Gemini models failed (${failures.map((f) => f.modelName).join(", ")}): ${failures.at(-1)?.error?.message}`
  );
  err.errors = failures;
  err.status = failures.at(-1)?.error?.status;
  throw err;
};
