-- ─────────────────────────────────────────────────────────────────────────────
-- Module 7 — Structural Audit Report
-- Adds the audit_report JSONB column to handshake_sessions.
-- Run once. Idempotent (DO NOTHING if column already exists).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE handshake_sessions
  ADD COLUMN IF NOT EXISTS audit_report JSONB DEFAULT NULL;

-- Index for fast lookups / filtering on audit data
CREATE INDEX IF NOT EXISTS idx_handshake_audit_report
  ON handshake_sessions USING gin (audit_report);

COMMENT ON COLUMN handshake_sessions.audit_report IS
  'Module 7 — Structural Audit Report: synthesised cross-module evaluation including overall score, grade, strengths, risks, recommendation, and AI summary';
