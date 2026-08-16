-- AI Agent config (global per user)
CREATE TABLE IF NOT EXISTS ai_agent_config (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  instructions TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_config_user_id
  ON ai_agent_config (user_id);

CREATE INDEX IF NOT EXISTS idx_ai_agent_config_enabled
  ON ai_agent_config (enabled)
  WHERE enabled = TRUE;

-- Mark AI-generated chat messages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE;