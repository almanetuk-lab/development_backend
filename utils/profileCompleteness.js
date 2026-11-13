// Profile completeness rules: decides when a profile is "ready" to appear in
// AI suggestions (and to get AI suggestions of its own).
//
// Pure module, no imports on purpose (same style as banRules.js) so it is safe to use
// from tests, scripts and services.
//
// The frontend mirrors these rules in development_frontend/src/utils/profileCompleteness.js
// for the live progress bar. KEEP THE TWO FILES IN SYNC.
//
// Ready = every must-have filled + at least EXTRAS_REQUIRED extras answered.
// Progress = (must-haves done + min(extras done, EXTRAS_REQUIRED)) / (must-haves + EXTRAS_REQUIRED).

export const ABOUT_ME_MIN = 50;
export const MIN_AGE = 18;
export const MIN_INTERESTS = 3;
export const EXTRAS_REQUIRED = 3;
// Photo is not required for now. Flip to true to add it as a must-have.
export const REQUIRE_PHOTO = false;

export const PROFILE_INCOMPLETE_CODE = "PROFILE_INCOMPLETE";

// ─── Value helpers ───────────────────────────────────────────────────────────

const parseMaybeJson = (val) => {
  if (typeof val !== "string") return val;
  const s = val.trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return val;
  try {
    return JSON.parse(s);
  } catch {
    return val;
  }
};

/** True when a value holds real content: non-blank text, or an array/object with any filled value. */
export const isFilled = (val) => {
  const v = parseMaybeJson(val);
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return !Number.isNaN(v);
  if (typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.some(isFilled);
  if (typeof v === "object") return Object.values(v).some(isFilled);
  return false;
};

/** Flattens an interests-like value (array, comma string, or {category: [items]}) into filled items. */
const collectItems = (val) => {
  const v = parseMaybeJson(val);
  if (v === null || v === undefined) return [];
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(v)) return v.flatMap(collectItems);
  if (typeof v === "object") return Object.values(v).flatMap(collectItems);
  return isFilled(v) ? [String(v)] : [];
};

/** Interests are stored in two places: `interests` (simple list) and `ways_i_spend_time` (by category). */
export const countInterests = (profile) =>
  new Set([...collectItems(profile.interests), ...collectItems(profile.ways_i_spend_time)].map((s) => s.toLowerCase())).size;

const ageFrom = (profile, now) => {
  if (profile.dob) {
    const d = new Date(profile.dob);
    if (!Number.isNaN(d.getTime())) {
      let age = now.getFullYear() - d.getFullYear();
      const m = now.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
      return age;
    }
  }
  const n = Number(profile.age);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const hasPhoto = (p) => isFilled(p.image_url) || isFilled(p.profile_image);

// ─── Rules ───────────────────────────────────────────────────────────────────
// `key` is stable (used by the frontend to jump to the field), `label` is user-facing.

export const MUST_HAVES = [
  { key: "first_name", label: "First name", test: (p) => isFilled(p.first_name) },
  { key: "age", label: "Date of birth (18+)", test: (p, now) => (ageFrom(p, now) ?? 0) >= MIN_AGE },
  { key: "gender", label: "Gender", test: (p) => isFilled(p.gender) },
  { key: "interested_in", label: "Interested in", test: (p) => isFilled(p.interested_in) },
  { key: "city", label: "City", test: (p) => isFilled(p.city) },
  { key: "relationship_goal", label: "Relationship goal", test: (p) => isFilled(p.relationship_goal) },
  {
    key: "about_me",
    label: `About me (at least ${ABOUT_ME_MIN} characters)`,
    test: (p) => typeof p.about_me === "string" && p.about_me.trim().length >= ABOUT_ME_MIN,
  },
  ...(REQUIRE_PHOTO ? [{ key: "photo", label: "Profile photo", test: hasPhoto }] : []),
];

export const EXTRAS = [
  { key: "relationship_values", label: "Relationship values", test: (p) => isFilled(p.relationship_values) },
  { key: "relationship_pace", label: "Relationship pace", test: (p) => isFilled(p.relationship_pace) },
  { key: "children_preference", label: "Children preference", test: (p) => isFilled(p.children_preference) },
  { key: "life_rhythms", label: "Life rhythms", test: (p) => isFilled(p.life_rhythms) },
  { key: "interests", label: `Interests (at least ${MIN_INTERESTS})`, test: (p) => countInterests(p) >= MIN_INTERESTS },
  { key: "prompts", label: "One profile prompt", test: (p, _now, prompts) => isFilled(prompts) },
  { key: "religious_belief", label: "Religious belief", test: (p) => isFilled(p.religious_belief) },
  {
    key: "smoking_drinking",
    label: "Smoking & drinking",
    test: (p) => isFilled(p.smoking) && isFilled(p.drinking),
  },
];

/**
 * Evaluates a profile against the readiness rules.
 *
 * @param {object} profile  profiles row (or the same shape from a request body)
 * @param {object} [prompts] { question_key: answer } — defaults to profile.prompts
 * @returns {{
 *   isReady: boolean,
 *   percent: number,                       // 0-100, integer
 *   mustHaves: { done: number, total: number, missing: {key,label}[] },
 *   extras:    { done: number, required: number, missing: {key,label}[] },
 * }}
 */
export const evaluateProfileCompleteness = (profile, prompts, now = new Date()) => {
  const p = profile || {};
  const pr = prompts ?? p.prompts ?? {};

  const mustMissing = MUST_HAVES.filter((r) => !r.test(p, now, pr)).map(({ key, label }) => ({ key, label }));
  const extrasMissing = EXTRAS.filter((r) => !r.test(p, now, pr)).map(({ key, label }) => ({ key, label }));

  const mustDone = MUST_HAVES.length - mustMissing.length;
  const extrasDone = EXTRAS.length - extrasMissing.length;
  const slots = MUST_HAVES.length + EXTRAS_REQUIRED;
  const percent = Math.round(((mustDone + Math.min(extrasDone, EXTRAS_REQUIRED)) / slots) * 100);

  return {
    isReady: mustMissing.length === 0 && extrasDone >= EXTRAS_REQUIRED,
    percent,
    mustHaves: { done: mustDone, total: MUST_HAVES.length, missing: mustMissing },
    extras: { done: extrasDone, required: EXTRAS_REQUIRED, missing: extrasMissing },
  };
};

/**
 * SQL condition that is TRUE when the user id expression belongs to a ready profile.
 * Used by the AI suggestions candidate query (controller/matchController.js).
 */
export const matchEligibleSql = (userIdExpr) =>
  `EXISTS (SELECT 1 FROM profiles mep WHERE mep.user_id = ${userIdExpr} AND mep.is_match_eligible = true)`;
