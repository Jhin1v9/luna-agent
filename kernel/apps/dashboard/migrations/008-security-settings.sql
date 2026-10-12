-- Migration 008: Security Settings
-- Move security settings from JSON file to PostgreSQL

CREATE TABLE IF NOT EXISTS security_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  settings JSONB NOT NULL DEFAULT '{}',
  last_notified_at TIMESTAMP WITH TIME ZONE,
  version TEXT NOT NULL DEFAULT '1.0',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default row
INSERT INTO security_settings (id, settings, version)
VALUES ('default', '{"maxAttemptsBeforeAlert": 1}'::jsonb, '1.0')
ON CONFLICT (id) DO NOTHING;
