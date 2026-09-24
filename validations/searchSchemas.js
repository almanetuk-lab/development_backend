import { z } from "zod";
import crypto from "crypto";
import { PROFILE_ENUMS } from "./profileSchemas.js";

/**
 * Query-parameter contract for GET /search.
 *
 * ⚠️ MIRROR: keep the constants below in sync with
 *    development_frontend/src/validations/searchSchemas.js
 * The two repos deploy separately and share no package, so the shape is
 * deliberately duplicated. Exactly one divergence is intentional: the frontend
 * copy uses .catch() so a hand-edited URL degrades to defaults, while this copy
 * rejects with a 400.
 *
 * NOTE ON ZOD VERSION: this repo runs zod 4, where the zod-3 `required_error`
 * option is silently ignored. Use `{ error: "..." }` instead. Several older
 * schemas in this folder still use `required_error` and their custom messages
 * are dead — do not copy that idiom.
 */

export const SEARCH_MODES = ["basic", "advanced", "nearme", "members"];

/**
 * The single source of truth for which filters belong to which mode. Used for
 * per-mode field stripping, the WHERE-builder dispatch, and the `filters` echo
 * returned to the client.
 *
 * `members` is deliberately a STRICT SUBSET of `advanced`. That is what stops
 * the cheaper browse_members entitlement from being used to smuggle paid
 * advanced-search capability past the paywall — see middleware/searchGuards.js.
 */
export const MODE_FIELDS = {
  basic: ["q", "profession", "city"],
  advanced: [
    "first_name", "last_name", "gender", "marital_status", "profession",
    "skills", "interests", "city", "state", "min_age", "max_age",
  ],
  nearme: ["radius", "city"],
  members: ["q", "gender", "city", "min_age", "max_age"],
};

export const LIMITS = {
  DEFAULT_LIMIT: 12,
  MAX_LIMIT: 50,
  MAX_PAGE: 10000,
  MAX_TEXT: 100,
  MIN_AGE: 18,
  MAX_AGE: 100,
  MIN_RADIUS: 1,
  MAX_RADIUS: 100,
  DEFAULT_RADIUS: 10,
};

export const SEARCH_DEFAULTS = {
  search_mode: "basic",
  page: 1,
  limit: LIMITS.DEFAULT_LIMIT,
  radius: LIMITS.DEFAULT_RADIUS,
};

/**
 * Legacy rows may hold "Man"/"Woman" where the enum says "Male"/"Female".
 * The query builder matches against these synonym lists so old data stays
 * findable after the one-off normalisation migration.
 */
export const GENDER_SYNONYMS = {
  Male: ["male", "man", "m"],
  Female: ["female", "woman", "f"],
  "Non-Binary": ["non-binary", "nonbinary", "nb"],
  Other: ["other"],
};

/* ── field helpers ────────────────────────────────────────────────────────── */

/**
 * Query strings hand us "" for an omitted-but-present param (`?city=`), and
 * z.coerce.number("") is 0 — which would silently become age 0 and would make
 * `?page=` fail .min(1). Every optional field therefore normalises blank to
 * undefined BEFORE the type check.
 */
const blankToUndefined = (v) => (v === "" || v === null ? undefined : v);

const optText = (label, max = LIMITS.MAX_TEXT) =>
  z.preprocess(
    blankToUndefined,
    z.string().trim().max(max, `${label} cannot exceed ${max} characters.`).optional()
  );

const optInt = (label, min, max) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: `${label} must be a number.` })
      .int(`${label} must be a whole number.`)
      .min(min, `${label} must be at least ${min}.`)
      .max(max, `${label} cannot exceed ${max}.`)
      .optional()
  );

const optEnum = (label, values) =>
  z.preprocess(
    blankToUndefined,
    z.enum(values, { error: `${label} must be one of: ${values.join(", ")}.` }).optional()
  );

const pickDefined = (source, keys) => {
  const out = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
};

/* ── the schema ───────────────────────────────────────────────────────────── */

export const searchQuerySchema = z
  .object({
    search_mode: z.preprocess(
      blankToUndefined,
      z.enum(SEARCH_MODES, { error: "Unknown search mode." }).default(SEARCH_DEFAULTS.search_mode)
    ),

    page: z.preprocess(
      blankToUndefined,
      z.coerce
        .number({ error: "Page must be a number." })
        .int("Page must be a whole number.")
        .min(1, "Page must be at least 1.")
        .max(LIMITS.MAX_PAGE, `Page cannot exceed ${LIMITS.MAX_PAGE}.`)
        .default(SEARCH_DEFAULTS.page)
    ),
    limit: z.preprocess(
      blankToUndefined,
      z.coerce
        .number({ error: "Limit must be a number." })
        .int("Limit must be a whole number.")
        .min(1, "Limit must be at least 1.")
        .max(LIMITS.MAX_LIMIT, `Limit cannot exceed ${LIMITS.MAX_LIMIT}.`)
        .default(SEARCH_DEFAULTS.limit)
    ),

    q: optText("Keyword"),
    first_name: optText("First name", 50),
    last_name: optText("Last name", 50),
    profession: optText("Profession"),
    city: optText("City", 80),
    state: optText("State", 80),
    skills: optText("Skills"),
    interests: optText("Interests"),
    gender: optEnum("Gender", PROFILE_ENUMS.gender),
    marital_status: optEnum("Marital status", PROFILE_ENUMS.marital_status),
    min_age: optInt("Minimum age", LIMITS.MIN_AGE, LIMITS.MAX_AGE),
    max_age: optInt("Maximum age", LIMITS.MIN_AGE, LIMITS.MAX_AGE),
    radius: optInt("Search radius", LIMITS.MIN_RADIUS, LIMITS.MAX_RADIUS),

    // Accepted for the first search after a geolocation prompt, before the
    // profile row has been updated. Never echoed back, never put in a URL.
    lat: z.preprocess(
      blankToUndefined,
      z.coerce.number({ error: "Latitude must be a number." }).min(-90).max(90).optional()
    ),
    lon: z.preprocess(
      blankToUndefined,
      z.coerce.number({ error: "Longitude must be a number." }).min(-180).max(180).optional()
    ),
  })
  .superRefine((v, ctx) => {
    if (v.min_age != null && v.max_age != null && v.min_age > v.max_age) {
      ctx.addIssue({
        code: "custom",
        path: ["min_age"],
        message: "Minimum age cannot be greater than maximum age.",
      });
    }
    if ((v.lat == null) !== (v.lon == null)) {
      ctx.addIssue({
        code: "custom",
        path: ["lat"],
        message: "Latitude and longitude must be provided together.",
      });
    }
  })
  .transform((v) => ({
    search_mode: v.search_mode,
    page: v.page,
    limit: v.limit,
    lat: v.search_mode === "nearme" ? v.lat : undefined,
    lon: v.search_mode === "nearme" ? v.lon : undefined,
    // The schema itself produces the object the server echoes back, so the
    // echo and the WHERE clause are built from the same value and cannot drift.
    filters: pickDefined(v, MODE_FIELDS[v.search_mode]),
  }));

/* ── quota signature ──────────────────────────────────────────────────────── */

/**
 * A stable fingerprint of the search criteria, used to decide whether a request
 * is a NEW search (charge the quota) or the same search seen again (free).
 *
 * `page` and `limit` are structurally absent from `filters`, so paging can never
 * be charged. `search_mode` is excluded so switching tabs with unchanged text
 * is free.
 */
export const filterSignature = (filters = {}) => {
  const canonical = Object.keys(filters)
    .filter((k) => k !== "search_mode")
    .sort()
    .map((k) => [k, filters[k]]);
  if (canonical.length === 0) return null; // an unfiltered listing is not a search
  return crypto.createHash("sha1").update(JSON.stringify(canonical)).digest("hex");
};
