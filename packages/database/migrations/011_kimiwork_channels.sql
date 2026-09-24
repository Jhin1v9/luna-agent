-- 011 — Canais dedicados por chat (decreto owner 2026-09-24 08:16):
-- três conversas Kimi Work separadas (Voz / Cron / Geral) não podem
-- atropelar uma à outra. Cada turno LLM carrega um `channel` que define
-- QUAL automação responde; cada evento de inbox já tem `kind` (routers
-- em should_fire filtram por kind/channel — escopos disjuntos).
--
-- voice  = turnos da conductora de chamada (session_key conductor:*,
--          operator:*) — respondidos pela automação "Luna — Voz".
-- geral  = todo o resto (fast brain do orchestrator, auto-reparo, etc.) —
--          respondidos pela automação "Luna — Geral".
-- (o chat "Cron" é a própria conversa da automação de varredura — não usa
--  turnos; se um dia usar, nasce com channel 'geral' por default e o
--  roteamento se repensa na 012.)

ALTER TABLE kimiwork_llm_turns
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'geral';

-- Backfill: turnos de voz já na fila antes da coluna existir.
UPDATE kimiwork_llm_turns
  SET channel = 'voice'
  WHERE channel = 'geral'
    AND (session_key LIKE 'conductor:%' OR session_key LIKE 'operator:%');

-- Router das automações consulta (status, channel) a cada checagem.
CREATE INDEX IF NOT EXISTS idx_kimiwork_turns_status_channel
  ON kimiwork_llm_turns (status, channel);
