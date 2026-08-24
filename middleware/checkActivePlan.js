import { pool } from "../config/db.js";

export const checkActivePlan = async (req, res, next) => {
  try {
    const userId = req.user.id; // comes from validateAccessToken

    const result = await pool.query(
      `
      SELECT expires_at
      FROM user_plans
      WHERE user_id = $1
        AND status = 'active'
      ORDER BY expires_at DESC
      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        code: "PLAN_EXPIRED",
        message: "Your plan has expired. Please upgrade.",
      });
    }

    const expiresAt = new Date(result.rows[0].expires_at);
    if (expiresAt < new Date()) {
      return res.status(403).json({
        code: "PLAN_EXPIRED",
        message: "Your plan has expired. Please upgrade.",
      });
    }

    next();
  } catch (err) {
    console.error("Plan check error:", err);
    res.status(500).json({ message: "Plan validation failed" });
  }
};

export const checkFeatureGuard = (featureKey) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized access" });
      }

      // Special exception for profile page: user can always view/edit their own profile
      if (featureKey === "profile" && req.params.userId) {
        if (String(req.params.userId) === String(userId)) {
          return next();
        }
      }

      // Check active plan and its allowed_features
      const result = await pool.query(
        `
        SELECT p.allowed_features, up.expires_at
        FROM user_plans up
        LEFT JOIN plans p ON up.plan_id = p.id
        WHERE up.user_id = $1
          AND up.status = 'active'
        ORDER BY up.expires_at DESC
        LIMIT 1
        `,
        [userId]
      );

      let allowedFeatures = null;
      let hasActivePlan = false;

      if (result.rows.length > 0) {
        const expiresAt = new Date(result.rows[0].expires_at);
        if (expiresAt >= new Date()) {
          hasActivePlan = true;
          allowedFeatures = result.rows[0].allowed_features;
        }
      }

      // Free tier (no active plan) default features
      if (!hasActivePlan) {
        const defaultFreeFeatures = {
          edit_profile: true,
          basic_search: true,
          dashboard: true,
        };
        if (defaultFreeFeatures[featureKey]) {
          return next();
        }
        return res.status(403).json({
          code: "PLAN_RESTRICTED",
          message: `Your current plan does not allow access to the '${featureKey}' feature. Please upgrade.`,
        });
      }

      // Check features
      let isAllowed = false;
      if (allowedFeatures === null || allowedFeatures === undefined) {
        // Legacy plan, allow all features by default
        isAllowed = true;
      } else if (Array.isArray(allowedFeatures)) {
        isAllowed = allowedFeatures.includes(featureKey);
      } else if (typeof allowedFeatures === 'object') {
        isAllowed = !!allowedFeatures[featureKey];
      }

      if (isAllowed) {
        return next();
      }

      return res.status(403).json({
        code: "PLAN_RESTRICTED",
        message: `Your current plan does not allow access to the '${featureKey}' feature. Please upgrade.`,
      });
    } catch (err) {
      console.error("Feature guard check error:", err);
      res.status(500).json({ message: "Feature validation failed" });
    }
  };
};

