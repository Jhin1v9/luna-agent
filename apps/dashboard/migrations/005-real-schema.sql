-- ============================================================
-- MIGRATION 005 — Real Schema (Reverse Schema Engineering)
-- Fase 0.1 · NEXO Dashboard Pro
--
-- Objetivo: Alinhar o schema PostgreSQL EXATAMENTE com o que
-- o server.js usa hoje. Zero adapters, zero tradução.
--
-- Estratégia:
--   - Tabelas com dados e schema OK: não mexer
--   - Tabelas com dados e schema parcial: ALTER TABLE
--   - Tabelas vazias ou schema completamente diferente: DROP + CREATE
-- ============================================================

-- ============================================================
-- 1. AJUSTES MENORES (tabelas com dados)
-- ============================================================

-- USERS: adicionar discord_id (existe no JSON, não no PG)
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id TEXT;

-- CASH_BOX: adicionar campos que o server.js usa mas PG não sincroniza
ALTER TABLE cash_box ADD COLUMN IF NOT EXISTS alerts JSONB DEFAULT '[]';
ALTER TABLE cash_box ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{"lowBalanceMultiplier":2,"currency":"EUR","autoDeductRecurring":true,"projectionMonths":3}';
ALTER TABLE cash_box ADD COLUMN IF NOT EXISTS audit_log JSONB DEFAULT '[]';

-- ============================================================
-- 2. RECRIAÇÃO DE TABELAS COM SCHEMA COMPLETAMENTE DIFERENTE
-- ============================================================

-- PAYMENTS (vazia) — schema real do server.js
DROP TABLE IF EXISTS payments;
CREATE TABLE payments (
  payment_id TEXT PRIMARY KEY,
  id TEXT, -- fallback, mesmo valor que payment_id
  client_id TEXT,
  client_name TEXT,
  client_short_name TEXT DEFAULT '',
  project_name TEXT DEFAULT '',
  project_id TEXT DEFAULT '',
  description TEXT DEFAULT '',
  total_amount JSONB DEFAULT '{"value":0,"currency":"EUR"}',
  equivalent_eur JSONB,
  status TEXT DEFAULT 'pending',
  payment_terms JSONB DEFAULT '{"type":"full","splits":[]}',
  method_preferred TEXT,
  method_accepted JSONB DEFAULT '["transfer","card","cash","bizum"]',
  revenue_split JSONB DEFAULT '[]',
  transactions JSONB DEFAULT '[]',
  notes TEXT DEFAULT '',
  links JSONB DEFAULT '{}',
  company_share_percent NUMERIC DEFAULT 25,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- LEADS (vazia) — schema real do server.js
DROP TABLE IF EXISTS leads;
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  name TEXT,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  type TEXT DEFAULT 'lead',
  status TEXT DEFAULT 'potencial',
  pipeline_status TEXT DEFAULT 'novo',
  estimated_value NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  notes TEXT DEFAULT '',
  assigned_to TEXT,
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_contact TIMESTAMPTZ,
  converted_at TIMESTAMPTZ
);

-- MEMBERS (vazia) — schema real do server.js (já estava OK, recriar para garantir)
DROP TABLE IF EXISTS members;
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  skills JSONB DEFAULT '[]',
  share_percent NUMERIC,
  status TEXT,
  projects JSONB DEFAULT '[]',
  email TEXT,
  phone TEXT,
  country TEXT,
  joined_at DATE,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TRANSACTIONS (vazia) — schema real do server.js
DROP TABLE IF EXISTS transactions;
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  date DATE,
  type TEXT,
  amount NUMERIC,
  currency TEXT DEFAULT 'EUR',
  description TEXT,
  category TEXT DEFAULT 'outros',
  balance_after NUMERIC,
  recorded_by TEXT,
  recorded_at TIMESTAMPTZ,
  notes TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  is_active BOOLEAN DEFAULT true,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT DEFAULT 'abner',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SECURITY_LOGS (vazia) — schema real do server.js
DROP TABLE IF EXISTS security_logs;
CREATE TABLE security_logs (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  type TEXT,
  severity TEXT,
  ip TEXT,
  location JSONB,
  risk JSONB,
  device JSONB,
  attempted_user TEXT,
  message TEXT,
  notified BOOLEAN DEFAULT false,
  notification_channel TEXT,
  has_camera_photo BOOLEAN DEFAULT false,
  has_screenshot BOOLEAN DEFAULT false,
  camera_photo TEXT,
  screenshot TEXT,
  intruder_data JSONB,
  last_notified_at TIMESTAMPTZ,
  settings JSONB DEFAULT '{"maxAttemptsBeforeAlert":1}'
);

-- CHANGELOG (vazia) — schema real do server.js
-- Nota: o server.js lê de backend/changelog.json (fora de data/)
-- A tabela PG representa o array "entries" interno
DROP TABLE IF EXISTS changelog;
CREATE TABLE changelog (
  id TEXT PRIMARY KEY,
  version TEXT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  emoji TEXT,
  author TEXT DEFAULT 'Luna',
  tier INTEGER DEFAULT 3,
  date TIMESTAMPTZ DEFAULT NOW(),
  tags JSONB DEFAULT '[]',
  read_by JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- IDEAS (vazia) — schema real do server.js
-- Nota: o server.js usa { ideas: { [id]: {...} }, _meta, templates, categories }
-- A tabela PG representa CADA idea individual
DROP TABLE IF EXISTS ideas;
CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'rascunho',
  type TEXT DEFAULT 'outro',
  priority TEXT DEFAULT 'media',
  linked_to JSONB,
  content JSONB,
  ai_context JSONB DEFAULT '{"brainstormHistory":[],"aiSuggestions":[],"aiInsights":[]}',
  tags JSONB DEFAULT '[]',
  created_by TEXT,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  collaborators JSONB DEFAULT '[]',
  comments JSONB DEFAULT '[]',
  attachments JSONB DEFAULT '[]',
  version_history JSONB DEFAULT '[]',
  summary TEXT,
  due_date TEXT,
  assigned_to TEXT,
  converted_to JSONB
);

-- WORKSPACE_CLIENTS (tem 2 rows) — backup, recriar, restore
-- Primeiro fazer backup dos dados existentes
CREATE TABLE IF NOT EXISTS workspace_clients_backup AS SELECT * FROM workspace_clients;
DROP TABLE IF EXISTS workspace_clients;
CREATE TABLE workspace_clients (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  caminho TEXT NOT NULL,
  status TEXT DEFAULT 'ativo',
  cor TEXT DEFAULT '#3b82f6',
  responsavel TEXT DEFAULT 'todos',
  tipo TEXT DEFAULT 'cliente',
  data_inicio DATE,
  orcamento_total NUMERIC DEFAULT 0,
  moeda TEXT DEFAULT 'EUR',
  tags JSONB DEFAULT '[]',
  anotacoes TEXT DEFAULT '',
  versao TEXT DEFAULT '1.0',
  ultima_atualizacao TIMESTAMPTZ DEFAULT NOW(),
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
-- Restore dos dados antigos (mapeando nomes antigos para novos)
DO $$
DECLARE
  has_name_col BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workspace_clients_backup' AND column_name = 'name'
  ) INTO has_name_col;

  IF has_name_col THEN
    INSERT INTO workspace_clients (id, nome, caminho, status, cor, responsavel, tipo, data_inicio, orcamento_total, moeda, tags, anotacoes, versao, ultima_atualizacao, criado_em, atualizado_em)
    SELECT 
      id,
      COALESCE(name, id) as nome,
      COALESCE(path, id) as caminho,
      COALESCE(status, 'ativo') as status,
      COALESCE(color, '#3b82f6') as cor,
      COALESCE(responsavel, 'todos') as responsavel,
      COALESCE(tipo, 'cliente') as tipo,
      data_inicio,
      COALESCE(orcamento_total, 0) as orcamento_total,
      COALESCE(moeda, 'EUR') as moeda,
      COALESCE(tags, '[]'::jsonb) as tags,
      COALESCE(anotacoes, '') as anotacoes,
      '1.0' as versao,
      NOW() as ultima_atualizacao,
      COALESCE(criado_em, NOW()) as criado_em,
      COALESCE(atualizado_em, NOW()) as atualizado_em
    FROM workspace_clients_backup;
  ELSE
    INSERT INTO workspace_clients (id, nome, caminho, status, cor, responsavel, tipo, data_inicio, orcamento_total, moeda, tags, anotacoes, versao, ultima_atualizacao, criado_em, atualizado_em)
    SELECT 
      id,
      id as nome,
      COALESCE(path, id) as caminho,
      COALESCE(status, 'ativo') as status,
      COALESCE(color, '#3b82f6') as cor,
      COALESCE(responsavel, 'todos') as responsavel,
      COALESCE(tipo, 'cliente') as tipo,
      data_inicio,
      COALESCE(orcamento_total, 0) as orcamento_total,
      COALESCE(moeda, 'EUR') as moeda,
      COALESCE(tags, '[]'::jsonb) as tags,
      COALESCE(anotacoes, '') as anotacoes,
      '1.0' as versao,
      NOW() as ultima_atualizacao,
      COALESCE(criado_em, NOW()) as criado_em,
      COALESCE(atualizado_em, NOW()) as atualizado_em
    FROM workspace_clients_backup;
  END IF;
END $$;
DROP TABLE IF EXISTS workspace_clients_backup;

-- WHATSAPP_HISTORY (vazia) — schema real do server.js
DROP TABLE IF EXISTS whatsapp_history;
CREATE TABLE whatsapp_history (
  id TEXT PRIMARY KEY,
  text TEXT,
  body TEXT,
  author TEXT,
  author_name TEXT,
  chat TEXT,
  chat_name TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  classification JSONB,
  reviewed BOOLEAN DEFAULT false,
  corrected_category TEXT,
  notes TEXT,
  sent_via_dashboard BOOLEAN DEFAULT false,
  direction TEXT,
  responded BOOLEAN DEFAULT false,
  resolved_author JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- LUNA_THREADS (vazia) — schema real do server.js
DROP TABLE IF EXISTS luna_threads;
CREATE TABLE luna_threads (
  id TEXT PRIMARY KEY,
  type TEXT DEFAULT 'individual',
  title TEXT,
  participants JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  message_count INTEGER DEFAULT 0,
  messages JSONB DEFAULT '[]'
);

-- LUNA_BUFFER (vazia) — schema real do server.js
DROP TABLE IF EXISTS luna_buffer;
CREATE TABLE luna_buffer (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  new_messages JSONB DEFAULT '[]',
  new_tasks JSONB DEFAULT '[]',
  new_tasks_done JSONB DEFAULT '[]',
  new_ideas JSONB DEFAULT '[]',
  new_decisions JSONB DEFAULT '[]',
  new_links JSONB DEFAULT '[]',
  new_leads JSONB DEFAULT '[]',
  new_finance JSONB DEFAULT '[]',
  ignored_messages JSONB DEFAULT '[]',
  new_mentions JSONB DEFAULT '[]',
  sentiment JSONB DEFAULT '{"positive":0,"negative":0,"urgent":0}',
  last_buffer_update TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. RECRIAÇÃO DE QUOTES (tem 2 rows — backup, recriar, restore)
-- ============================================================
CREATE TABLE IF NOT EXISTS quotes_backup AS SELECT * FROM quotes;
DROP TABLE IF EXISTS quotes;
CREATE TABLE quotes (
  quote_id TEXT PRIMARY KEY,
  id TEXT, -- fallback, mesmo valor
  project_id TEXT,
  project_name TEXT,
  client_name TEXT,
  client_id TEXT,
  status TEXT,
  status_label TEXT,
  total_amount JSONB,
  monthly_fee JSONB,
  year1_investment JSONB,
  discount_upfront JSONB,
  items JSONB DEFAULT '[]',
  github_url TEXT,
  created_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  valid_until DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Restore dos dados antigos
INSERT INTO quotes (quote_id, id, project_id, project_name, client_name, client_id, status, status_label, total_amount, monthly_fee, year1_investment, discount_upfront, items, github_url, created_at, sent_at, valid_until, updated_at)
SELECT 
  id as quote_id,
  id,
  project_id,
  project_name,
  client_name,
  client_id,
  status,
  status_label,
  jsonb_build_object('value', total_amount_value, 'currency', total_amount_currency) as total_amount,
  jsonb_build_object('value', monthly_fee_value, 'currency', monthly_fee_currency) as monthly_fee,
  jsonb_build_object('value', year1_investment_value, 'currency', year1_investment_currency) as year1_investment,
  jsonb_build_object('percent', discount_percent, 'amount', discount_amount, 'currency', discount_currency) as discount_upfront,
  COALESCE(items, '[]'::jsonb) as items,
  github_url,
  created_at,
  sent_at,
  valid_until,
  COALESCE(updated_at, NOW()) as updated_at
FROM quotes_backup;
DROP TABLE quotes_backup;

-- ============================================================
-- 4. ÍNDICES ÚTEIS
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_client_id ON payments(client_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads(pipeline_status);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_security_logs_type ON security_logs(type);
CREATE INDEX IF NOT EXISTS idx_security_logs_timestamp ON security_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_changelog_date ON changelog(date);
CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_chat ON whatsapp_history(chat);
CREATE INDEX IF NOT EXISTS idx_luna_threads_updated ON luna_threads(updated_at);
