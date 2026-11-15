// Gender preference filter shared by every match list endpoint
// (AI Suggestions, My Matches, Suggested Matches card).
//
// One-way: a candidate is shown when their `gender` matches the viewer's
// `interested_in`. The candidate's own preference is not considered.

// interested_in (lowercased) → profiles.gender value
export const INTEREST_TO_GENDER = {
  man: "Male",
  woman: "Female",
  "non-binary": "Non-Binary",
};

/**
 * Gender value the viewer's match lists should be restricted to, or null when no
 * filter applies (switch off, or interested_in is Everyone / empty / unknown).
 * A missing switch value counts as ON, matching the column default.
 */
export function resolvePreferredGender(viewer) {
  if (!viewer) return null;
  if (viewer.show_only_preferred_gender === false) return null;
  const key = String(viewer.interested_in ?? "").trim().toLowerCase();
  return INTEREST_TO_GENDER[key] || null;
}

/**
 * WHERE fragment (prefixed with " AND ") restricting `${tableAlias}.gender` to the
 * viewer's preferred gender, using placeholder $nextIndex. Returns an empty
 * fragment and no params when no filter applies. Candidates with NULL gender
 * never match, so they are excluded while the filter is active.
 */
export function genderFilterSql(viewer, tableAlias, nextIndex) {
  const gender = resolvePreferredGender(viewer);
  if (!gender) return { sql: "", params: [], gender: null };
  return {
    sql: ` AND LOWER(TRIM(${tableAlias}.gender::text)) = LOWER($${nextIndex})`,
    params: [gender],
    gender,
  };
}
