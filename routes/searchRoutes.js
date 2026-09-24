import express from "express";
import { searchProfiles } from "../controller/searchController.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";
import { validateQuery } from "../validations/validate.js";
import { searchQuerySchema } from "../validations/searchSchemas.js";
import { checkSearchFeature, checkSearchQuota } from "../middleware/searchGuards.js";

const router = express.Router();

// validateQuery (not validate(..., "query")) — req.query is getter-only on Express 5.
// checkSearchFeature must run after validation: it reads req.validatedQuery.search_mode.
router.get(
  "/search",
  validateAccessToken,
  validateQuery(searchQuerySchema),
  checkSearchFeature,
  checkSearchQuota,
  searchProfiles
);

export default router;
