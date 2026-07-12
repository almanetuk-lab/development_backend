-- ─────────────────────────────────────────────────────────────────────────────
-- Modules 4 & 5 — Friction Interview & Conflict Simulation
-- Adds friction_interview and conflict_simulation JSONB columns to handshake_sessions.
-- Run once. Idempotent (DO NOTHING if column already exists).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE handshake_sessions
  ADD COLUMN IF NOT EXISTS friction_interview JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS conflict_simulation JSONB DEFAULT NULL;

-- Indexes for fast reads/GIN querying on JSON keys
CREATE INDEX IF NOT EXISTS idx_handshake_friction_interview
  ON handshake_sessions USING gin (friction_interview);

CREATE INDEX IF NOT EXISTS idx_handshake_conflict_simulation
  ON handshake_sessions USING gin (conflict_simulation);

COMMENT ON COLUMN handshake_sessions.friction_interview IS
  'Module 4 — Agent-to-Agent Friction Interview: stores simulated twin QA conversation and compatibility ratings';

COMMENT ON COLUMN handshake_sessions.conflict_simulation IS
  'Module 5 — Conflict Simulation Logic: stores simulated relationship conflict scenarios, triggers, resolution suggestions and outcomes';
