-- Chat abusive-content moderation.
-- Apply manually (psql or Supabase SQL editor) BEFORE deploying the code that uses it.
-- Idempotent: safe to re-run.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS message_moderation_flags (
  id SERIAL PRIMARY KEY,
  message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL, -- survives sender deleting the message
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  original_content TEXT NOT NULL,                -- evidence snapshot
  matched_words TEXT[] NOT NULL DEFAULT '{}',
  is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | dismissed | warned | deleted
  reviewed_by INTEGER,                           -- admins.id
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mmf_status_created ON message_moderation_flags (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mmf_sender ON message_moderation_flags (sender_id);
