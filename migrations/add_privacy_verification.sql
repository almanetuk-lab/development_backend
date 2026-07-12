-- ─────────────────────────────────────────────────────────────────────────────
-- Module 6 — Privacy-Preserving Data Exchange
-- Adds the privacy_verification JSONB column to handshake_sessions.
-- Run once. Idempotent (DO NOTHING if already exists).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE handshake_sessions
  ADD COLUMN IF NOT EXISTS privacy_verification JSONB DEFAULT NULL;

-- Optional index for fast reads on privacy verification data
CREATE INDEX IF NOT EXISTS idx_handshake_privacy_verification
  ON handshake_sessions USING gin (privacy_verification);

COMMENT ON COLUMN handshake_sessions.privacy_verification IS
  'Module 6 — Privacy-Preserving Data Exchange: stores privacy audit scores and AI summary';
