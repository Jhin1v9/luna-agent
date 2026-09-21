-- F3 adiantado — Classificação pós-conversa (§27) + perfil rico de cliente.
-- 001-006 intactas (append-only).

-- Classificação da conversa ao RESOLVED (worker, classifier §27):
-- outcome, sentiment, topic, product, urgency, follow_up_required, summary, quality_score.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS classification JSONB;

-- Perfil rico do cliente: sinais de negócio acumulados pelo classifier
-- (pedidos, reclamações recorrentes, preferências, produtos).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;

-- projects.client_id (FK pro cliente) já existe desde a 001 — clientes
-- linkados nos projetos sem migração nova.
