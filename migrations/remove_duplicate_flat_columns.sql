-- ========================================================
-- PRODUCTION DATABASE SCHEMA MIGRATION: REMOVE DUPLICATE FLAT COLUMNS
-- PLATFORM: INTENTIONAL CONNECTION
-- ========================================================

-- 1. Drop Indexes associated with the flat columns
DROP INDEX IF EXISTS idx_profiles_ambition_level;
DROP INDEX IF EXISTS idx_profiles_relationship_intent;

-- 2. Drop the duplicate flat columns from the profiles table
-- Centralizes psychological metadata entirely in intent_tags JSONB
ALTER TABLE profiles 
DROP COLUMN IF EXISTS communication_style,
DROP COLUMN IF EXISTS social_preference,
DROP COLUMN IF EXISTS ambition_level,
DROP COLUMN IF EXISTS stress_cycle,
DROP COLUMN IF EXISTS relationship_intent;
