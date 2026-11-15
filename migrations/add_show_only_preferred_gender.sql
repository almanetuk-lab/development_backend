-- Gender preference filter switch.
-- Applied automatically on boot by testConnection() in config/db.js; kept here for the record.
-- When true, AI Suggestions / My Matches / Suggested Matches only show candidates whose
-- gender matches the viewer's interested_in (see utils/genderPreference.js).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS show_only_preferred_gender BOOLEAN NOT NULL DEFAULT true;
