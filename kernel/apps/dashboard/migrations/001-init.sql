-- ============================================================
-- NEXO Dashboard — PostgreSQL Schema v1.0
-- Created: 2026-05-18
-- ============================================================

-- Drop tables if they exist (for clean migration)
DROP TABLE IF EXISTS idea_comments CASCADE;
DROP TABLE IF EXISTS ideas CASCADE;
DROP TABLE IF EXISTS task_comments CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS company_tasks CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS cash_box CASCADE;
DROP TABLE IF EXISTS quotes CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS members CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS links CASCADE;
DROP TABLE IF EXISTS changelog CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS security_logs CASCADE;
DROP TABLE IF EXISTS whatsapp_history CASCADE;
DROP TABLE IF EXISTS luna_threads CASCADE;
DROP TABLE IF EXISTS luna_buffer CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================================
-- 1. USERS
-- ============================================================
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  color TEXT,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. TASKS
-- ============================================================
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT DEFAULT 'medium',
  task_type TEXT DEFAULT 'one_time',
  due_date TIMESTAMPTZ,
  added_by TEXT,
  assigned_to TEXT,
  source TEXT DEFAULT 'manual',
  comments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX idx_tasks_priority ON tasks(priority);

-- ============================================================
-- 3. COMPANY TASKS
-- ============================================================
CREATE TABLE company_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT DEFAULT 'medium',
  task_type TEXT DEFAULT 'one_time',
  due_date TIMESTAMPTZ,
  added_by TEXT,
  assigned_to TEXT,
  source TEXT DEFAULT 'manual',
  comments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_company_tasks_status ON company_tasks(status);

-- ============================================================
-- 4. IDEAS
-- ============================================================
CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT DEFAULT 'rascunho',
  category TEXT,
  priority TEXT DEFAULT 'medium',
  author TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  blocks JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ideas_status ON ideas(status);
CREATE INDEX idx_ideas_category ON ideas(category);

-- ============================================================
-- 5. PAYMENTS (RECEITAS / FATURAS)
-- ============================================================
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_id TEXT,
  client_name TEXT,
  project_id TEXT,
  project_name TEXT,
  amount_value NUMERIC(12,2) DEFAULT 0,
  amount_currency TEXT DEFAULT 'EUR',
  status TEXT DEFAULT 'pending',
  due_date DATE,
  paid_date DATE,
  installments JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_client ON payments(client_id);

-- ============================================================
-- 6. EXPENSES
-- ============================================================
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  amount_value NUMERIC(12,2) DEFAULT 0,
  amount_currency TEXT DEFAULT 'EUR',
  cost_per_person_value NUMERIC(12,2) DEFAULT 0,
  cost_per_person_currency TEXT DEFAULT 'EUR',
  type TEXT DEFAULT 'one_time',
  period TEXT,
  period_label TEXT,
  start_date DATE,
  renew_date DATE,
  end_date DATE,
  category TEXT,
  category_label TEXT,
  split_among JSONB DEFAULT '[]'::jsonb,
  paid_by JSONB DEFAULT '{}'::jsonb,
  fully_paid BOOLEAN DEFAULT FALSE,
  auto_deduct_from_cash_box BOOLEAN DEFAULT TRUE,
  notes TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_expenses_category ON expenses(category);
CREATE INDEX idx_expenses_fully_paid ON expenses(fully_paid);

-- ============================================================
-- 7. CASH BOX (single-row config table)
-- ============================================================
CREATE TABLE cash_box (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  balance_value NUMERIC(12,2) DEFAULT 0,
  balance_currency TEXT DEFAULT 'EUR',
  monthly_income_value NUMERIC(12,2) DEFAULT 0,
  monthly_income_currency TEXT DEFAULT 'EUR',
  monthly_expenses_value NUMERIC(12,2) DEFAULT 0,
  monthly_expenses_currency TEXT DEFAULT 'EUR',
  projected_balance_value NUMERIC(12,2) DEFAULT 0,
  projected_balance_currency TEXT DEFAULT 'EUR',
  projection_months INTEGER DEFAULT 3,
  incoming_payments JSONB DEFAULT '[]'::jsonb,
  outgoing_expenses JSONB DEFAULT '[]'::jsonb,
  history JSONB DEFAULT '[]'::jsonb,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. QUOTES (ORÇAMENTOS)
-- ============================================================
CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  project_name TEXT,
  client_name TEXT,
  client_id TEXT,
  status TEXT DEFAULT 'draft',
  status_label TEXT,
  total_amount_value NUMERIC(12,2) DEFAULT 0,
  total_amount_currency TEXT DEFAULT 'EUR',
  monthly_fee_value NUMERIC(12,2) DEFAULT 0,
  monthly_fee_currency TEXT DEFAULT 'EUR',
  year1_investment_value NUMERIC(12,2) DEFAULT 0,
  year1_investment_currency TEXT DEFAULT 'EUR',
  discount_percent NUMERIC(5,2) DEFAULT 0,
  discount_amount NUMERIC(12,2) DEFAULT 0,
  discount_currency TEXT DEFAULT 'EUR',
  created_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  valid_until DATE,
  github_url TEXT,
  items JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quotes_status ON quotes(status);
CREATE INDEX idx_quotes_client ON quotes(client_id);

-- ============================================================
-- 9. LEADS
-- ============================================================
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  source TEXT,
  status TEXT DEFAULT 'new',
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_status ON leads(status);

-- ============================================================
-- 10. MEMBERS
-- ============================================================
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  skills JSONB DEFAULT '[]'::jsonb,
  share_percent NUMERIC(5,2) DEFAULT 0,
  status TEXT DEFAULT 'active',
  projects JSONB DEFAULT '[]'::jsonb,
  email TEXT,
  phone TEXT,
  country TEXT,
  joined_at DATE,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 11. TRANSACTIONS
-- ============================================================
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  date DATE,
  type TEXT,
  amount NUMERIC(12,2) DEFAULT 0,
  description TEXT,
  category TEXT,
  balance_after NUMERIC(12,2) DEFAULT 0,
  recorded_by TEXT,
  recorded_at TIMESTAMPTZ,
  note TEXT,
  source TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_type ON transactions(type);

-- ============================================================
-- 12. LINKS
-- ============================================================
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  author TEXT,
  timestamp TIMESTAMPTZ,
  chat TEXT,
  notes TEXT,
  manual BOOLEAN DEFAULT FALSE,
  preview JSONB DEFAULT '{}'::jsonb,
  platform TEXT,
  patterns JSONB DEFAULT '[]'::jsonb,
  icon TEXT,
  color TEXT,
  category TEXT,
  label TEXT,
  hostname TEXT,
  enriched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_links_category ON links(category);
CREATE INDEX idx_links_platform ON links(platform);

-- ============================================================
-- 13. CHANGELOG
-- ============================================================
CREATE TABLE changelog (
  id TEXT PRIMARY KEY,
  version TEXT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  emoji TEXT,
  author TEXT,
  tier INTEGER DEFAULT 3,
  date TIMESTAMPTZ,
  tags JSONB DEFAULT '[]'::jsonb,
  read_by JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_changelog_date ON changelog(date);

-- ============================================================
-- 14. NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  type TEXT,
  title TEXT NOT NULL,
  message TEXT,
  severity TEXT DEFAULT 'info',
  read BOOLEAN DEFAULT FALSE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_read ON notifications(read);
CREATE INDEX idx_notifications_timestamp ON notifications(timestamp);

-- ============================================================
-- 15. SECURITY LOGS
-- ============================================================
CREATE TABLE security_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT,
  user_id TEXT,
  ip TEXT,
  location TEXT,
  user_agent TEXT,
  success BOOLEAN,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_security_logs_event ON security_logs(event_type);
CREATE INDEX idx_security_logs_created ON security_logs(created_at);

-- ============================================================
-- 16. WHATSAPP HISTORY
-- ============================================================
CREATE TABLE whatsapp_history (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  chat_name TEXT,
  sender TEXT,
  message TEXT,
  timestamp TIMESTAMPTZ,
  type TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_chat ON whatsapp_history(chat_id);
CREATE INDEX idx_whatsapp_timestamp ON whatsapp_history(timestamp);

-- ============================================================
-- 17. LUNA THREADS
-- ============================================================
CREATE TABLE luna_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  title TEXT,
  messages JSONB DEFAULT '[]'::jsonb,
  context JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_luna_threads_user ON luna_threads(user_id);

-- ============================================================
-- 18. LUNA BUFFER
-- ============================================================
CREATE TABLE luna_buffer (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 19. SETTINGS (generic key-value JSON store)
-- ============================================================
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
