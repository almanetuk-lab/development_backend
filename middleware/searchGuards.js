import { pool } from "../config/db.js";
import { checkFeatureGuard } from "./checkActivePlan.js";
import { filterSignature } from "../validations/searchSchemas.js";

/**
 * Plan gating and search-quota handling for GET /search.
 *
 * Replaces ~110 lines that were hand-rolled inside searchController.js and had
 * drifted from the shared `checkFeatureGuard` implementation.
 */

export const SEARCH_MODE_FEATURE = {
  basic: "basic_search",
  advanced: "advance_search",
  nearme: "near_me",
  // Browse Members gets its own mode so that moving it to server-side filtering
  // does not push it behind the advance_search paywall. Its filter set is a
  // strict subset of `advanced` (see MODE_FIELDS), so it cannot be used to
  // obtain paid advanced-search capability.
  members: "browse_members",
};

/** Maps the requested search_mode to a plan feature and delegates to the shared guard. */
export const checkSearchFeature = (req, res, next) => {
  const mode = req.validatedQuery?.search_mode || "basic";
  const featureKey = SEARCH_MODE_FEATURE[mode];
  if (!featureKey) {
    return res.status(400).json({ message: "Unknown search mode." });
  }
  return checkFeatureGuard(featureKey)(req, res, next);
};

/* ── the global check_search_limit toggle ─────────────────────────────────── */

let configCache = { value: null, expiresAt: 0 };

/**
 * `configurations.check_search_limit` was previously read twice per search
 * request. It changes approximately never, so it is cached briefly.
 */
const isSearchLimitEnforced = async () => {
  if (Date.now() < configCache.expiresAt && configCache.value !== null) {
    return configCache.value;
  }
  try {
    const { rows } = await pool.query("SELECT check_search_limit FROM configurations LIMIT 1");
    configCache = {
      value: (rows[0]?.check_search_limit ?? 1) === 1,
      expiresAt: Date.now() + 60_000,
    };
  } catch (err) {
    console.warn("Could not read check_search_limit, assuming enforced:", err.message);
    return true;
  }
  return configCache.value;
};

/* ── quota: check (every request) vs charge (new criteria only) ───────────── */

/**
 * Read-only quota check. Runs on every request, including pagination, so a user
 * who is over their limit cannot keep paging through results.
 */
export const checkSearchQuota = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return next();

    const { rows } = await pool.query(
      `
      SELECT up.people_search_used, p.people_search_limit
      FROM user_plans up
      JOIN plans p ON p.id = up.plan_id
      WHERE up.user_id = $1
        AND up.status = 'active'
        AND p.is_active = 1
        AND up.expires_at > NOW()
      `,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(403).json({ code: "NO_ACTIVE_PLAN", message: "No active plan found" });
    }

    const { people_search_used: used, people_search_limit: limit } = rows[0];
    if (limit !== -1 && used >= limit && (await isSearchLimitEnforced())) {
      return res.status(403).json({
        code: "SEARCH_LIMIT_EXCEEDED",
        message: "Your people search limit is over",
      });
    }

    return next();
  } catch (err) {
    console.error("Search quota check error:", err);
    return res.status(500).json({ message: "Plan validation failed" });
  }
};

/** How long the same criteria stay "already paid for". */
const REPEAT_SEARCH_WINDOW = "30 minutes";

/**
 * Charges one search against the plan quota, but only when the criteria differ
 * from the user's last search.
 *
 * Search is reactive now (no Search button), so without this a single typed
 * word plus a couple of page clicks would burn several searches. Paging is free
 * by construction: `page` and `limit` are not part of `filters`, so they cannot
 * change the signature. An unfiltered listing — opening Browse Members, or
 * clearing every filter — is browsing rather than searching and is never
 * charged (filterSignature returns null).
 *
 * Written as one conditional UPDATE so there is no read-then-write race.
 * rowCount === 0 means "same criteria as last time, not charged".
 */
export const chargeSearchIfNewCriteria = async (userId, filters) => {
  if (!userId) return false;

  const signature = filterSignature(filters);
  if (signature === null) return false;

  try {
    if (!(await isSearchLimitEnforced())) return false;

    const { rowCount } = await pool.query(
      `
      UPDATE user_plans
         SET people_search_used    = people_search_used + 1,
             last_search_signature = $2,
             last_search_at        = NOW(),
             updated_at            = NOW()
       WHERE user_id = $1
         AND status = 'active'
         AND (last_search_signature IS DISTINCT FROM $2
              OR last_search_at IS NULL
              OR last_search_at < NOW() - INTERVAL '${REPEAT_SEARCH_WINDOW}')
      `,
      [userId, signature]
    );
    return rowCount > 0;
  } catch (err) {
    // Never fail a search because the meter could not be written.
    console.error("Search quota charge error:", err.message);
    return false;
  }
};
