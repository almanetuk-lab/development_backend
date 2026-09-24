import { pool } from "../config/db.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import { buildSearchQuery, SEARCH_RESULT_COLUMNS } from "../services/searchQueryBuilder.js";
import { buildListEnvelope } from "../utils/pagination.js";
import { chargeSearchIfNewCriteria } from "../middleware/searchGuards.js";

/**
 * GET /search
 *
 * Plan gating and the quota check run as middleware (see middleware/searchGuards.js);
 * query params arrive already validated on `req.validatedQuery` (validations/searchSchemas.js).
 *
 * Responds with { data, pagination, filters } on every path, including the
 * Near Me no-coordinates case — which previously returned a bare array.
 */

/**
 * Near Me needs a point to measure from. The client no longer sends coordinates
 * on the normal path (they are deliberately kept out of shareable URLs), so the
 * stored profile location is the usual source; query lat/lon only covers the
 * first search after a geolocation prompt, before the profile has been updated.
 */
const resolveSearchCoords = async ({ lat, lon, userId }) => {
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  if (!userId) return null;

  try {
    const { rows } = await pool.query(
      `SELECT latitude, longitude FROM profiles WHERE user_id = $1`,
      [userId]
    );
    const profileLat = Number(rows[0]?.latitude);
    const profileLon = Number(rows[0]?.longitude);
    if (Number.isFinite(profileLat) && Number.isFinite(profileLon)) {
      return { lat: profileLat, lon: profileLon };
    }
  } catch (err) {
    console.warn("Could not resolve searcher location for nearme:", err.message);
  }
  return null;
};

export const searchProfiles = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { search_mode, page, limit, filters, lat, lon } = req.validatedQuery;

    let coords = null;
    if (search_mode === "nearme") {
      coords = await resolveSearchCoords({ lat, lon, userId });
      if (!coords) {
        // No point to measure from. The client tells this apart from "no matches"
        // using its own geolocation state.
        return res.json(buildListEnvelope({ rows: [], page, limit, totalCount: 0, filters }));
      }
    }

    const { whereSql, params, distanceKmExpr } = buildSearchQuery({
      search_mode,
      filters,
      coords,
      excludeUserId: userId,
    });

    // LIMIT/OFFSET placeholders are appended after the builder's highest index,
    // so both queries share one params array without rebinding anything.
    const limitPlaceholder = `$${params.length + 1}`;
    const offsetPlaceholder = `$${params.length + 2}`;

    const countSql = `SELECT COUNT(*)::int AS total FROM profiles pr ${whereSql}`;
    const pageSql = `
      SELECT ${SEARCH_RESULT_COLUMNS},
             ${distanceKmExpr ? `(${distanceKmExpr} * 1000.0)` : "NULL"} AS distance_meters
      FROM profiles pr
      ${whereSql}
      ORDER BY ${distanceKmExpr ? "distance_meters ASC, " : ""}pr.user_id ASC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `;

    const [countResult, pageResult] = await Promise.all([
      pool.query(countSql, params),
      pool.query(pageSql, [...params, limit, (page - 1) * limit]),
    ]);

    const totalCount = countResult.rows[0].total;

    if (userId) {
      logAuditEvent(
        userId,
        `SEARCH_${search_mode.toUpperCase()}`,
        { filters, page, results_count: pageResult.rows.length, total: totalCount },
        req
      );
      await chargeSearchIfNewCriteria(userId, filters);
    }

    return res.json(
      buildListEnvelope({ rows: pageResult.rows, page, limit, totalCount, filters })
    );
  } catch (err) {
    console.error("Search API Error:", err);
    // Deliberately generic: the previous handler returned err.message, which
    // leaked SQL errors to the client.
    return res.status(500).json({ message: "Search failed. Please try again." });
  }
};
