-- 013 — Supervisão da Vênus (decreto owner 2026-10-09): a Luna é irmã maior
-- e vigia o irmão. Critic por regras (zero tokens) avalia TODA mensagem
-- outbound dele; flag dispara turno 'geral' pra Luna julgar/corrigir.
-- Luna registra veredito e ação aqui (painel mostra; memória entre execuções).
CREATE TABLE IF NOT EXISTS venus_supervision (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id   UUID REFERENCES messages(id),
    chat_id      TEXT,
    body         TEXT,                          -- trecho da mensagem avaliada
    critic       JSONB NOT NULL DEFAULT '{}',   -- {pass: bool, reasons: [...]}
    flagged      BOOLEAN NOT NULL DEFAULT false,
    luna_verdict TEXT,                          -- ok | corrigido | pedi_desculpas | falso_positivo
    luna_action  TEXT,                          -- o que a Luna fez (resumo)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_venus_supervision_flagged ON venus_supervision (created_at)
    WHERE flagged AND luna_verdict IS NULL;
