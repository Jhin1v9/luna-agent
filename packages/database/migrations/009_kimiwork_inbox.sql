-- 009 — Ponte Kimi Work (decreto owner 2026-09-24): a Luna deixa de responder
-- por fluxo hardcoded com passos automáticos; os eventos do WhatsApp
-- (menções, ligações recebidas, etc.) caem nesta caixa de entrada e o
-- cérebro Kimi Work (agente no workspace, via Automation local_conversation)
-- decide as ações e as executa pelas vias já existentes (messages +
-- pg_notify('luna_outbound') pra texto, NOTIFY whatsapp_actions pra chamada).
CREATE TABLE IF NOT EXISTS kimiwork_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL, -- whatsapp.message | call.incoming | call.missed
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending', -- pending | processing | done | error
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  result jsonb,
  idempotency_key text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_kimiwork_inbox_pending ON kimiwork_inbox (received_at)
  WHERE status = 'pending';
