// Keeps profiles.is_match_eligible in sync with the rules in utils/profileCompleteness.js.
// Call refreshMatchEligibility(userId) after anything that changes a rule's input
// (profile save, prompts, photo).

import { pool } from "../config/db.js";
import { evaluateProfileCompleteness } from "../utils/profileCompleteness.js";

/** Loads a profile row plus its prompts as { question_key: answer }. Returns null if no profile. */
export const loadProfileWithPrompts = async (userId, db = pool) => {
  const { rows } = await db.query(`SELECT * FROM profiles WHERE user_id = $1`, [userId]);
  if (!rows.length) return null;
  const profile = rows[0];

  const promptRows = await db.query(
    `SELECT question_key, answer FROM profile_prompts WHERE profile_id = $1`,
    [profile.id]
  );
  const prompts = {};
  for (const r of promptRows.rows) prompts[r.question_key] = r.answer;
  return { profile, prompts };
};

/**
 * Re-evaluates a user's profile and stores the result in profiles.is_match_eligible.
 * Returns the completeness object, or null if the user has no profile.
 */
export const refreshMatchEligibility = async (userId, db = pool) => {
  const loaded = await loadProfileWithPrompts(userId, db);
  if (!loaded) return null;

  const completeness = evaluateProfileCompleteness(loaded.profile, loaded.prompts);
  if (loaded.profile.is_match_eligible !== completeness.isReady) {
    await db.query(`UPDATE profiles SET is_match_eligible = $1 WHERE user_id = $2`, [
      completeness.isReady,
      userId,
    ]);
    console.log(`🧩 [Completeness] user ${userId} is_match_eligible → ${completeness.isReady} (${completeness.percent}%)`);
  }
  return completeness;
};
