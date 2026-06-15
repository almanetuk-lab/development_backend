-- ========================================================
-- MIGRATION: Sentiment & Tone Audit System
-- PLATFORM:  Intentional Connection
-- PURPOSE:   Add emotional tone + psychological state columns
--            to the profiles table for AI-powered sentiment
--            analysis and emotionally-aware compatibility matching.
-- ========================================================

-- ── Flat columns for fast SQL filtering & ordering ──────────────────────────
-- These allow direct WHERE/ORDER BY without unpacking JSON.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS primary_tone              VARCHAR(100);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stress_level              VARCHAR(50);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS emotional_energy          VARCHAR(50);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_capacity           VARCHAR(50);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS relationship_need         VARCHAR(100);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS emotional_resilience      VARCHAR(50);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS lifestyle_friction        VARCHAR(50);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS conflict_style            VARCHAR(100);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stress_recovery_style     VARCHAR(100);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS communication_pressure    VARCHAR(50);

-- ── JSONB field: full structured audit result from Gemini ───────────────────
-- Stores the complete AI response including burnout_signals,
-- recommended_partner_traits, confidence, and all tone fields.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sentiment_audit           JSONB;

-- ── Timestamp to track when the audit was last run ─────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sentiment_analyzed_at     TIMESTAMP;

-- ── Indexes for common filter queries ──────────────────────────────────────
-- Used by getSuggestions() for sentiment-aware candidate boosting.
CREATE INDEX IF NOT EXISTS idx_profiles_primary_tone
    ON profiles (primary_tone)
    WHERE primary_tone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_emotional_resilience
    ON profiles (emotional_resilience)
    WHERE emotional_resilience IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_stress_level
    ON profiles (stress_level)
    WHERE stress_level IS NOT NULL;

-- ── GIN index on JSONB for fast trait queries ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_sentiment_audit_gin
    ON profiles USING gin(sentiment_audit)
    WHERE sentiment_audit IS NOT NULL;

-- ── Verify migration ────────────────────────────────────────────────────────
-- Run this SELECT to confirm columns were created:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'profiles'
--   AND column_name IN (
--     'primary_tone','stress_level','emotional_energy','social_capacity',
--     'relationship_need','emotional_resilience','lifestyle_friction',
--     'conflict_style','stress_recovery_style','communication_pressure',
--     'sentiment_audit','sentiment_analyzed_at'
--   )
-- ORDER BY column_name;
