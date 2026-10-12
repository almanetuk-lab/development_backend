-- Account bans (timed / permanent deactivation).
-- Apply manually (psql or Supabase SQL editor) BEFORE deploying the code that uses it.
-- REQUIRES add_message_moderation.sql to be applied first (source_flag_id FK).
-- Idempotent: safe to re-run.
--
-- A user is banned when: status = 'Deactivate' AND (banned_until IS NULL OR banned_until > NOW())
-- banned_until IS NULL with status 'Deactivate' means a permanent ban.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_by INTEGER;          -- admins.id

CREATE TABLE IF NOT EXISTS user_bans (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  banned_by INTEGER,                                   -- admins.id
  banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  banned_until TIMESTAMPTZ,                            -- NULL = permanent
  previous_status VARCHAR(50),                         -- restored when the ban is lifted
  source_flag_id INTEGER REFERENCES message_moderation_flags(id) ON DELETE SET NULL,
  lifted_at TIMESTAMPTZ,
  lifted_by INTEGER,                                   -- admins.id; NULL when expired
  lift_reason VARCHAR(20),                             -- 'expired' | 'reactivated' | 'replaced'
  lift_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_bans_user ON user_bans (user_id, banned_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_bans_open_expiry ON user_bans (banned_until) WHERE lifted_at IS NULL;

-- Backfill: accounts already deactivated become permanent bans with a history row.
INSERT INTO user_bans (user_id, reason, banned_at, banned_until, previous_status)
SELECT u.id,
       COALESCE(NULLIF(TRIM(u.reason), ''), 'Deactivated before ban tracking'),
       COALESCE(u.updated_at, NOW()),
       NULL,
       'Approve'
FROM users u
WHERE u.status = 'Deactivate'
  AND NOT EXISTS (SELECT 1 FROM user_bans b WHERE b.user_id = u.id AND b.lifted_at IS NULL);

UPDATE users
SET banned_at = COALESCE(banned_at, updated_at, NOW())
WHERE status = 'Deactivate' AND banned_at IS NULL;
