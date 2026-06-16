-- =========================================================================
-- MIGRATION: Consolidated Sentiment & Tone Audit JSONB Migration
-- PLATFORM:  Intentional Connection
-- PURPOSE:   Consolidates all scattered sentiment and tone columns
--            into a single centralized 'sentiment_audit' JSONB column.
--            Drops redundant flat columns and creates performance indexes.
-- =========================================================================

-- 1. Ensure sentiment_audit column exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sentiment_audit JSONB;

-- 2. Migrate existing flat column data into centralized JSONB structure
-- This preserves all live database values, maps distress tones to the distress_indicator,
-- standardizes timestamps, and merges advanced structured keys cleanly.
UPDATE profiles
SET sentiment_audit = jsonb_build_object(
  'primary_tone',              COALESCE(primary_tone, sentiment_audit->>'primary_tone', 'Balanced'),
  'stress_level',              COALESCE(stress_level, sentiment_audit->>'stress_level', 'Moderate'),
  'emotional_resilience',      COALESCE(emotional_resilience, sentiment_audit->>'emotional_resilience', 'Moderate'),
  'lifestyle_friction',        COALESCE(lifestyle_friction, sentiment_audit->>'lifestyle_friction', 'Moderate'),
  'distress_indicator',        (COALESCE(primary_tone, sentiment_audit->>'primary_tone', 'Balanced') IN ('Burned Out', 'Frustrated', 'Overwhelmed', 'Anxious', 'Lonely', 'Stressed', 'Melancholic')),
  'confidence_score',          COALESCE(confidence_score, (sentiment_audit->>'confidence')::float8, (sentiment_audit->>'confidence_score')::float8, 0.50),
  'analysis_summary',          COALESCE(sentiment_audit->>'analysis_summary', 'Profile emotional and lifestyle audit'),
  'audit_timestamp',           COALESCE(sentiment_audit->>'audit_timestamp', sentiment_analyzed_at::text, NOW()::text),
  'communication_style',        COALESCE(communication_pressure, sentiment_audit->>'communication_style', 'Moderate'),
  'conflict_resolution_style',  COALESCE(conflict_style, sentiment_audit->>'conflict_resolution_style', 'Collaborative'),
  
  -- Preserve other fields for complete backward compatibility (scoring, etc.)
  'emotional_energy',          COALESCE(emotional_energy, sentiment_audit->>'emotional_energy', 'Moderate'),
  'social_capacity',           COALESCE(social_capacity, sentiment_audit->>'social_capacity', 'Moderate'),
  'relationship_need',         COALESCE(relationship_need, sentiment_audit->>'relationship_need', 'Deep Connection'),
  'stress_recovery_style',     COALESCE(stress_recovery_style, sentiment_audit->>'stress_recovery_style', 'Routine & Structure'),
  'recommended_partner_traits', COALESCE(sentiment_audit->'recommended_partner_traits', '[]'::jsonb),
  'burnout_signals',           COALESCE(sentiment_audit->'burnout_signals', '[]'::jsonb),
  'profile_hash',              COALESCE(sentiment_audit->>'profile_hash', '')
)
WHERE is_submitted = true OR primary_tone IS NOT NULL OR sentiment_audit IS NOT NULL;

-- 3. Drop old redundant indexes
DROP INDEX IF EXISTS idx_profiles_primary_tone;
DROP INDEX IF EXISTS idx_profiles_emotional_resilience;
DROP INDEX IF EXISTS idx_profiles_stress_level;

-- 4. Drop redundant flat columns safely
ALTER TABLE profiles DROP COLUMN IF EXISTS primary_tone;
ALTER TABLE profiles DROP COLUMN IF EXISTS stress_level;
ALTER TABLE profiles DROP COLUMN IF EXISTS emotional_energy;
ALTER TABLE profiles DROP COLUMN IF EXISTS social_capacity;
ALTER TABLE profiles DROP COLUMN IF EXISTS relationship_need;
ALTER TABLE profiles DROP COLUMN IF EXISTS emotional_resilience;
ALTER TABLE profiles DROP COLUMN IF EXISTS lifestyle_friction;
ALTER TABLE profiles DROP COLUMN IF EXISTS conflict_style;
ALTER TABLE profiles DROP COLUMN IF EXISTS stress_recovery_style;
ALTER TABLE profiles DROP COLUMN IF EXISTS communication_pressure;
ALTER TABLE profiles DROP COLUMN IF EXISTS sentiment_analyzed_at;

-- 5. Create new optimized functional indexes on the JSONB properties for suggestions search
CREATE INDEX IF NOT EXISTS idx_profiles_sentiment_audit_tone 
    ON profiles ((sentiment_audit->>'primary_tone'))
    WHERE sentiment_audit IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_sentiment_audit_resilience 
    ON profiles ((sentiment_audit->>'emotional_resilience'))
    WHERE sentiment_audit IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_sentiment_audit_friction 
    ON profiles ((sentiment_audit->>'lifestyle_friction'))
    WHERE sentiment_audit IS NOT NULL;

-- 6. GIN index on JSONB for any other trait queries
CREATE INDEX IF NOT EXISTS idx_profiles_sentiment_audit_gin_refactored
    ON profiles USING gin(sentiment_audit)
    WHERE sentiment_audit IS NOT NULL;
