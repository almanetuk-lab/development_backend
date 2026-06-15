-- ============================================================
-- MIGRATION: Create refined_query_sessions table
-- Point #7: Adaptive Query Refinement & Dynamic Clarification Loop
-- ============================================================
-- This table stores TEMPORARY emotional/priority sessions.
-- It does NOT modify the profiles table or any permanent data.
-- Sessions auto-expire after 2 hours.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS refined_query_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INT NOT NULL,
  raw_query TEXT,
  selected_priorities TEXT[],
  emotional_state TEXT,
  generated_context JSONB,
  temporary_weights JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rqs_user_id ON refined_query_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_rqs_expires_at ON refined_query_sessions(expires_at);
