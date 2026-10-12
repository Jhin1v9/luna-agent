-- Migration 009: Trusted IPs
-- Move trusted IP configuration from JSON file to PostgreSQL

CREATE TABLE IF NOT EXISTS trusted_ips (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CEO',
  ips JSONB NOT NULL DEFAULT '[]',
  auto_capture BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default CEOs (will be populated by migration script or server init)
INSERT INTO trusted_ips (id, user_key, name, role, ips, auto_capture, notes)
VALUES 
  ('ceo-abner', 'abner', 'Abner Gabriel', 'CEO', '["127.0.0.1"]'::jsonb, true, 'Capturar IP automaticamente no próximo login'),
  ('ceo-nonoke', 'nonoke', 'Enoque (Nonoke)', 'CEO', '[]'::jsonb, true, 'Capturar IP automaticamente no próximo login'),
  ('ceo-elias', 'elias', 'Elias', 'CEO', '[]'::jsonb, true, 'Capturar IP automaticamente no próximo login')
ON CONFLICT (user_key) DO NOTHING;
