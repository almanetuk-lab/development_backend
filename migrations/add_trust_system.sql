-- ─────────────────────────────────────────────────────────────────────────────
-- Module 8 — Anti-Ghosting Staking / Trust System Migration
-- Adds trust_score column to users table and creates trust_history table.
-- Idempotent. Run once.
-- ─────────────────────────────────────────────────────────────────────────────

-- Add trust_score column to users table if missing
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 100;

-- Create trust_history table
CREATE TABLE IF NOT EXISTS trust_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  handshake_id INTEGER REFERENCES handshake_sessions(id) ON DELETE SET NULL,
  points_change INTEGER NOT NULL,
  new_trust_score INTEGER NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index user logins / lookups in history
CREATE INDEX IF NOT EXISTS idx_trust_history_user_id ON trust_history(user_id);
CREATE INDEX IF NOT EXISTS idx_trust_history_handshake_id ON trust_history(handshake_id);

COMMENT ON COLUMN users.trust_score IS
  'Anti-Ghosting System: user reliability score clamped between 0 and 100';
COMMENT ON TABLE trust_history IS
  'Anti-Ghosting System: logs of trust point increases, penalties, and reasons';
