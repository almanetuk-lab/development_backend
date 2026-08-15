-- ─────────────────────────────────────────────────────────────────────────────
-- Security Audit Logging Table
-- Tracks security events: Data Export, Account Erasure, Consent Updates
-- Idempotent creation. Run once.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS security_audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL, -- Retain logs even after user is deleted
  action VARCHAR(255) NOT NULL,                         -- e.g. 'DATA_EXPORT', 'ACCOUNT_ERASURE', 'CONSENT_CHANGE'
  details TEXT DEFAULT NULL,                            -- Redacted description or details
  ip_address VARCHAR(45) DEFAULT NULL,
  user_agent TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_audit_logs_user_id ON security_audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_action ON security_audit_logs (action);

COMMENT ON TABLE security_audit_logs IS 'Tracks security and privacy compliance operations for UK GDPR audits.';
