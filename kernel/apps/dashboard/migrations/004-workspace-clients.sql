-- ============================================================
-- Workspace Clients — Persistência de metadados de clientes
-- ============================================================
-- O conteúdo dos arquivos fica no filesystem/git,
-- mas os metadados dos clientes e a estrutura de pastas
-- são persistidos no PostgreSQL para não morrer com o dyno.

CREATE TABLE IF NOT EXISTS workspace_clients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  path          TEXT NOT NULL,
  status        TEXT DEFAULT 'ativo',
  color         TEXT DEFAULT '#3b82f6',
  responsavel   TEXT DEFAULT 'todos',
  tipo          TEXT DEFAULT 'cliente',
  data_inicio   DATE,
  orcamento_total NUMERIC(12,2) DEFAULT 0,
  moeda         TEXT DEFAULT 'EUR',
  tags          JSONB DEFAULT '[]'::jsonb,
  anotacoes     TEXT DEFAULT '',
  metadata      JSONB DEFAULT '{}'::jsonb,
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_clients_status ON workspace_clients(status);
CREATE INDEX IF NOT EXISTS idx_workspace_clients_responsavel ON workspace_clients(responsavel);
