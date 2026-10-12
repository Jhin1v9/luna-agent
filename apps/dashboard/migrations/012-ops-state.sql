-- Migration 012: Operations State
-- Move ops-state from JSON file to PostgreSQL

CREATE TABLE IF NOT EXISTS ops_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  alerts JSONB NOT NULL DEFAULT '[]',
  active_operations JSONB NOT NULL DEFAULT '[]',
  recent_changes JSONB NOT NULL DEFAULT '[]',
  system_health JSONB NOT NULL DEFAULT '{"status": "ok"}',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default row
INSERT INTO ops_state (id, alerts, active_operations, recent_changes, system_health)
VALUES ('default', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{"status": "ok"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
