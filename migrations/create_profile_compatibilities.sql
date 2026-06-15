-- ========================================================
-- PRODUCTION DATABASE SCHEMA MIGRATION: DYNAMIC COMPATIBILITY SYSTEM
-- PLATFORM: INTENTIONAL CONNECTION
-- ========================================================

-- 1. Create or Update `profile_compatibilities` Cache Schema
CREATE TABLE IF NOT EXISTS profile_compatibilities (
  id SERIAL PRIMARY KEY,
  user_a_id INT NOT NULL,
  user_b_id INT NOT NULL,
  compatibility_data JSONB NOT NULL,
  overall_score INT NOT NULL,
  ai_summary TEXT NOT NULL,
  compatibility_type VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_user_pair UNIQUE (user_a_id, user_b_id)
);

-- Indexing strategies for instant lookups on queries
CREATE INDEX IF NOT EXISTS idx_profile_compatibilities_user_a ON profile_compatibilities (user_a_id);
CREATE INDEX IF NOT EXISTS idx_profile_compatibilities_user_b ON profile_compatibilities (user_b_id);

-- 2. Add Permanent AI Psychological Insights Columns to `profiles`
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS confidence_score FLOAT8;

-- 3. Trigger Function to Automatically Update `updated_at` Timestamp on Modification
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update trigger to `profile_compatibilities`
DROP TRIGGER IF EXISTS update_profile_compatibilities_modtime ON profile_compatibilities;
CREATE TRIGGER update_profile_compatibilities_modtime
BEFORE UPDATE ON profile_compatibilities
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();
