-- 010 — Kimi Work como cérebro (decreto owner 2026-09-24): quando o modo
-- 'kimiwork' está ativo (KIMI_ADAPTER_MODE/KIMI_WORK... via skill cerebro),
-- fast brain e live brain delegam os turnos pra Luna do Kimi Work. O adapter
-- grava o turno aqui e faz poll até a resposta aparecer — quem responde é o
-- agente Kimi Work (varredura/cron), por UPDATE direto nesta tabela.
-- Sem resposta dentro do timeout = falha explícita (nunca cai pro mock).
CREATE TABLE IF NOT EXISTS kimiwork_llm_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key text NOT NULL,
  prompt text NOT NULL,
  image_base64 text, -- reserva (visão §14); Kimi Work lê do disco se precisar
  status text NOT NULL DEFAULT 'pending', -- pending | answered | failed
  response text,
  error text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_kimiwork_llm_turns_pending ON kimiwork_llm_turns (status, created_at)
  WHERE status = 'pending';
