/**
 * genderPreference.test.js
 * Unit tests for utils/genderPreference.js. Pure functions — no database.
 *
 * Run:  node tests/genderPreference.test.js
 */

import { resolvePreferredGender, genderFilterSql } from "../utils/genderPreference.js";

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✅ PASS  ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL  ${label}  [expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}]`);
    failed++;
  }
}

console.log("\n📦 resolvePreferredGender");
assertEqual(resolvePreferredGender({ interested_in: "Man", show_only_preferred_gender: true }), "Male", "Man → Male");
assertEqual(resolvePreferredGender({ interested_in: "Woman", show_only_preferred_gender: true }), "Female", "Woman → Female");
assertEqual(resolvePreferredGender({ interested_in: "Non-Binary", show_only_preferred_gender: true }), "Non-Binary", "Non-Binary → Non-Binary");
assertEqual(resolvePreferredGender({ interested_in: "Everyone", show_only_preferred_gender: true }), null, "Everyone → no filter");
assertEqual(resolvePreferredGender({ interested_in: "", show_only_preferred_gender: true }), null, "empty → no filter");
assertEqual(resolvePreferredGender({ interested_in: null, show_only_preferred_gender: true }), null, "null → no filter");
assertEqual(resolvePreferredGender({ interested_in: "Woman", show_only_preferred_gender: false }), null, "switch off → no filter");
assertEqual(resolvePreferredGender({ interested_in: "Woman" }), "Female", "switch undefined → defaults ON");
assertEqual(resolvePreferredGender({ interested_in: "Woman", show_only_preferred_gender: null }), "Female", "switch null → defaults ON");
assertEqual(resolvePreferredGender({ interested_in: "  woman " }), "Female", "casing/whitespace tolerated");
assertEqual(resolvePreferredGender({ interested_in: "Martian" }), null, "unknown value → no filter");
assertEqual(resolvePreferredGender(null), null, "no viewer → no filter");

console.log("\n📦 genderFilterSql");
assertEqual(
  genderFilterSql({ interested_in: "Woman" }, "profiles", 3),
  { sql: " AND LOWER(TRIM(profiles.gender::text)) = LOWER($3)", params: ["Female"], gender: "Female" },
  "builds fragment with requested placeholder index"
);
assertEqual(
  genderFilterSql({ interested_in: "Man" }, "p", 2).sql,
  " AND LOWER(TRIM(p.gender::text)) = LOWER($2)",
  "uses the given table alias"
);
assertEqual(
  genderFilterSql({ interested_in: "Everyone" }, "profiles", 3),
  { sql: "", params: [], gender: null },
  "no filter → empty fragment, no params"
);
assertEqual(
  genderFilterSql({ interested_in: "Woman", show_only_preferred_gender: false }, "profiles", 2),
  { sql: "", params: [], gender: null },
  "switch off → empty fragment, no params"
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
