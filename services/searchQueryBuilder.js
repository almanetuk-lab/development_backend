import { LIMITS, GENDER_SYNONYMS } from "../validations/searchSchemas.js";

/**
 * Builds the WHERE clause for GET /search, once, for both the COUNT query and
 * the page query.
 *
 * The previous implementation tracked placeholder positions by hand
 * (`idx += 5`) across three branches, which is why the same keyword was bound
 * five separate times. Here a "param bag" owns the numbering: `bag.add(value)`
 * pushes the value and hands back the placeholder string, so an index can never
 * drift out of step with the values array.
 */

const createParamBag = () => {
  const values = [];
  return {
    values,
    add(v) {
      values.push(v);
      return `$${values.length}`;
    },
  };
};

/**
 * Columns returned to the client.
 *
 * Explicitly listed rather than `pr.*` on purpose: the profiles table also
 * holds `phone`, `dob`, `latitude`, `longitude`, `intent_embedding` (a 768-dim
 * vector), `sentiment_audit`, `normalized_entities` and `spider_graph_data`.
 * `pr.*` shipped every one of those to the browser for every result — a
 * privacy leak and a large wasted payload. Proximity is communicated through
 * `distance_meters` only, never raw coordinates.
 */
export const SEARCH_RESULT_COLUMNS = [
  "pr.id",
  "pr.user_id",
  "pr.first_name",
  "pr.last_name",
  "pr.username",
  "pr.age",
  "pr.gender",
  "pr.marital_status",
  "pr.city",
  "pr.state",
  "pr.country",
  "pr.profession",
  "pr.company",
  "pr.experience",
  "pr.headline",
  "pr.about",
  "pr.skills",
  "pr.interests",
  "pr.image_url",
].join(",\n         ");

const LAT_COL = "pr.latitude";
const LON_COL = "pr.longitude";

/* ── predicate helpers ────────────────────────────────────────────────────── */

const likeText = (column, value, bag) => `LOWER(${column}) LIKE LOWER(${bag.add(`%${value}%`)})`;

/**
 * `skills` and `interests` are json columns that may hold either an array of
 * strings or a bare string, so both shapes have to be probed.
 *
 * The parentheses around each AND-pair are explicit. The original relied on
 * SQL's AND-binds-tighter-than-OR precedence, which gave the right answer but
 * was one edit away from silently becoming wrong.
 */
const likeJsonColumn = (column, value, bag) => {
  const placeholder = bag.add(`%${value}%`);
  return `(
      (jsonb_typeof(${column}::jsonb) = 'array'
        AND EXISTS (
          SELECT 1 FROM json_array_elements_text(${column}) elem
          WHERE LOWER(elem) LIKE LOWER(${placeholder})
        ))
      OR
      (jsonb_typeof(${column}::jsonb) = 'string'
        AND LOWER(${column}::text) LIKE LOWER(${placeholder}))
    )`;
};

/**
 * Matches the canonical enum value plus its legacy spellings, so rows written
 * before the gender normalisation (e.g. "Man") stay findable.
 */
const matchGender = (value, bag) => {
  const synonyms = GENDER_SYNONYMS[value] || [String(value).toLowerCase()];
  return `LOWER(pr.gender::text) = ANY(${bag.add(synonyms)})`;
};

/** Free-text keyword fanned out across the fields a person would expect to match. */
const matchKeyword = (value, bag) => {
  const placeholder = bag.add(`%${value}%`);
  const like = (col) => `LOWER(${col}) LIKE LOWER(${placeholder})`;
  return `(
      ${like("pr.first_name")}
      OR ${like("pr.last_name")}
      OR ${like("pr.profession")}
      OR ${like("pr.city")}
      OR (jsonb_typeof(pr.skills::jsonb) = 'array'
          AND EXISTS (SELECT 1 FROM json_array_elements_text(pr.skills) s
                      WHERE LOWER(s) LIKE LOWER(${placeholder})))
      OR (jsonb_typeof(pr.skills::jsonb) = 'string'
          AND LOWER(pr.skills::text) LIKE LOWER(${placeholder}))
      OR (jsonb_typeof(pr.interests::jsonb) = 'array'
          AND EXISTS (SELECT 1 FROM json_array_elements_text(pr.interests) i
                      WHERE LOWER(i) LIKE LOWER(${placeholder})))
      OR (jsonb_typeof(pr.interests::jsonb) = 'string'
          AND LOWER(pr.interests::text) LIKE LOWER(${placeholder}))
    )`;
};

const applyAgeRange = (filters, where, bag) => {
  const { min_age, max_age } = filters;
  if (min_age != null && max_age != null) {
    where.push(`pr.age BETWEEN ${bag.add(min_age)} AND ${bag.add(max_age)}`);
  } else if (min_age != null) {
    where.push(`pr.age >= ${bag.add(min_age)}`);
  } else if (max_age != null) {
    where.push(`pr.age <= ${bag.add(max_age)}`);
  }
};

/* ── the builder ──────────────────────────────────────────────────────────── */

/**
 * @param {object}  args
 * @param {string}  args.search_mode   basic | advanced | nearme | members
 * @param {object}  args.filters       validated, mode-stripped filter values
 * @param {object?} args.coords        { lat, lon } — required for nearme
 * @param {number?} args.excludeUserId the searcher, excluded from their own results
 * @returns {{ whereSql: string, params: any[], distanceKmExpr: string|null }}
 *   `params` is complete and must not be mutated; callers append LIMIT/OFFSET
 *   placeholders after `params.length`.
 */
export function buildSearchQuery({ search_mode, filters = {}, coords = null, excludeUserId = null }) {
  const bag = createParamBag();
  const where = ["1=1"];
  let distanceKmExpr = null;

  if (search_mode === "basic") {
    if (filters.q) where.push(matchKeyword(filters.q, bag));
    if (filters.profession) where.push(likeText("pr.profession", filters.profession, bag));
    if (filters.city) where.push(likeText("pr.city", filters.city, bag));
  }

  if (search_mode === "members") {
    if (filters.q) where.push(matchKeyword(filters.q, bag));
    if (filters.gender) where.push(matchGender(filters.gender, bag));
    if (filters.city) where.push(likeText("pr.city", filters.city, bag));
    applyAgeRange(filters, where, bag);
  }

  if (search_mode === "advanced") {
    const textColumns = {
      first_name: "pr.first_name",
      last_name: "pr.last_name",
      profession: "pr.profession",
      city: "pr.city",
      state: "pr.state",
    };
    for (const [key, column] of Object.entries(textColumns)) {
      if (filters[key]) where.push(likeText(column, filters[key], bag));
    }
    if (filters.gender) where.push(matchGender(filters.gender, bag));
    if (filters.marital_status) {
      where.push(`LOWER(pr.marital_status::text) = LOWER(${bag.add(filters.marital_status)})`);
    }
    if (filters.skills) where.push(likeJsonColumn("pr.skills", filters.skills, bag));
    if (filters.interests) where.push(likeJsonColumn("pr.interests", filters.interests, bag));
    applyAgeRange(filters, where, bag);
  }

  if (search_mode === "nearme") {
    if (!coords) throw new Error("buildSearchQuery: nearme requires resolved coordinates.");
    const radiusKm = filters.radius ?? LIMITS.DEFAULT_RADIUS;
    const latPh = bag.add(coords.lat);
    const lonPh = bag.add(coords.lon);
    const radiusPh = bag.add(radiusKm);

    distanceKmExpr = `6371.0 * acos(LEAST(1.0, GREATEST(-1.0,
        cos(radians(${latPh})) * cos(radians(${LAT_COL})) *
        cos(radians(${LON_COL}) - radians(${lonPh})) +
        sin(radians(${latPh})) * sin(radians(${LAT_COL}))
      )))`;

    where.push(`${LAT_COL} IS NOT NULL`);
    where.push(`${LON_COL} IS NOT NULL`);
    where.push(`${distanceKmExpr} <= ${radiusPh}`);

    if (filters.city) where.push(likeText("pr.city", filters.city, bag));
  }

  if (excludeUserId) where.push(`pr.user_id <> ${bag.add(excludeUserId)}`);

  return {
    whereSql: `WHERE ${where.join("\n        AND ")}`,
    params: bag.values,
    distanceKmExpr,
  };
}
