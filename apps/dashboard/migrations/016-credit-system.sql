-- Migration 016: Sistema de Créditos y Servicios
-- Permite gestión de créditos prepago, planes, suscripciones y tickets de servicio

-- ============================================================
-- PLANES DE CRÉDITO
-- ============================================================
CREATE TABLE IF NOT EXISTS credit_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price_monthly NUMERIC(10,2) NOT NULL DEFAULT 0,
  credits_per_month INTEGER NOT NULL DEFAULT 0,
  hosting_included BOOLEAN NOT NULL DEFAULT FALSE,
  support_level TEXT NOT NULL DEFAULT 'basic',
  features JSONB DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed planes por defecto
INSERT INTO credit_plans (id, name, description, price_monthly, credits_per_month, hosting_included, support_level, features) VALUES
  ('basico', 'Básico', '0 créditos + 1 modificación de texto/mes', 29, 0, FALSE, 'critical_only', '["1 modificación de texto/mes", "Soporte para caídas críticas"]'),
  ('profesional', 'Profesional', '900 créditos/mes (1.5h). Hosting incluido.', 59, 900, TRUE, 'standard', '["Hosting incluido", "Backups diarios", "WPO básico", "Soporte en 24h"]'),
  ('premium', 'Premium', '2400 créditos/mes (4h). Hosting incluido.', 119, 2400, TRUE, 'priority', '["Hosting incluido", "Backups diarios", "WPO avanzado", "Soporte <4h", "Consultoría mensual"]'),
  ('enterprise', 'Enterprise', 'Créditos personalizados. Dedicado.', 0, 0, TRUE, 'dedicated', '["Todo incluido", "Gestor dedicado", "SLA personalizado"]')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- CRÉDITOS POR CLIENTE
-- ============================================================
CREATE TABLE IF NOT EXISTS client_credits (
  client_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  total_assigned INTEGER NOT NULL DEFAULT 0,
  total_consumed INTEGER NOT NULL DEFAULT 0,
  total_reserved INTEGER NOT NULL DEFAULT 0,
  rollover INTEGER NOT NULL DEFAULT 0,
  auto_reload_threshold INTEGER DEFAULT NULL,
  auto_reload_amount INTEGER DEFAULT NULL,
  last_reloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MOVIMIENTOS DE CRÉDITOS (ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES client_credits(client_id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('asignacion', 'consumo', 'reserva', 'liberacion', 'rollover', 'ajuste', 'vencimiento')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description TEXT DEFAULT '',
  reference_type TEXT, -- 'ticket', 'plan', 'admin'
  reference_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_client ON credit_transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created ON credit_transactions(created_at);

-- ============================================================
-- SUSCRIPCIONES DE CLIENTES
-- ============================================================
CREATE TABLE IF NOT EXISTS client_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL REFERENCES credit_plans(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired', 'pending')),
  current_period_start DATE NOT NULL DEFAULT CURRENT_DATE,
  current_period_end DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '1 month'),
  auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  hosting_addon BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_subscriptions_client ON client_subscriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_client_subscriptions_status ON client_subscriptions(status);

-- ============================================================
-- TICKETS DE SERVICIO (solicitudes del cliente)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'general',
  estimated_credits INTEGER DEFAULT 0,
  actual_credits INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'cotizado', 'aprobado', 'reservado', 'en_progreso', 'completado', 'cancelado')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('baja', 'normal', 'alta', 'urgente')),
  credit_transaction_id UUID,
  assigned_to TEXT,
  admin_notes TEXT DEFAULT '',
  client_notes TEXT DEFAULT '',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_tickets_client ON service_tickets(client_id);
CREATE INDEX IF NOT EXISTS idx_service_tickets_status ON service_tickets(status);
