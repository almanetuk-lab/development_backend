-- Automatic chat moderation: severity tiers, strikes and chat mutes.
-- Apply manually (psql or Supabase SQL editor) BEFORE deploying the code that uses it.
-- REQUIRES add_message_moderation.sql to be applied first.
-- Idempotent: safe to re-run.
--
-- A strike is active when: is_strike AND status <> 'dismissed' AND created_at > NOW() - 30 days
-- A mute is active when:   lifted_at IS NULL AND muted_until > NOW()  (expires on time, no cron)

ALTER TABLE message_moderation_flags
  ADD COLUMN IF NOT EXISTS severity VARCHAR(10) NOT NULL DEFAULT 'mild',  -- mild | severe
  ADD COLUMN IF NOT EXISTS is_strike BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_action VARCHAR(20);                       -- warned | muted | NULL

CREATE INDEX IF NOT EXISTS idx_mmf_sender_strikes
  ON message_moderation_flags (sender_id, created_at DESC) WHERE is_strike;

CREATE TABLE IF NOT EXISTS user_chat_mutes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  muted_until TIMESTAMPTZ NOT NULL,
  strike_count INTEGER NOT NULL,
  source_flag_id INTEGER REFERENCES message_moderation_flags(id) ON DELETE SET NULL,
  lifted_at TIMESTAMPTZ,
  lifted_by INTEGER,                 -- admins.id; NULL when lifted automatically
  lift_reason VARCHAR(20),           -- 'admin' | 'flag_dismissed' | 'replaced'
  lift_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_ucm_active ON user_chat_mutes (user_id, muted_until) WHERE lifted_at IS NULL;
