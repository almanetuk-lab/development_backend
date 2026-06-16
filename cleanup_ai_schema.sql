-- Migration: Finalize AI Intent Engine Schema
-- 1. Remove all over-engineered/unnecessary AI columns
ALTER TABLE profiles 
  DROP COLUMN IF EXISTS career_tier,
  DROP COLUMN IF EXISTS emotional_state,
  DROP COLUMN IF EXISTS professional_rhythm,
  DROP COLUMN IF EXISTS lifestyle_pattern,
  DROP COLUMN IF EXISTS emotional_energy,
  DROP COLUMN IF EXISTS vector_data,
  DROP COLUMN IF EXISTS embeddings;

-- 2. Ensure intent_tags exists, is properly typed as JSONB, and has a safe default
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='intent_tags') THEN
    ALTER TABLE profiles ADD COLUMN intent_tags JSONB DEFAULT '{}'::jsonb;
  ELSE
    ALTER TABLE profiles 
      ALTER COLUMN intent_tags TYPE JSONB USING intent_tags::jsonb,
      ALTER COLUMN intent_tags SET DEFAULT '{}'::jsonb;
  END IF;
END $$;
