-- 014 — Cadeia de comando LUNA > VÊNUS (decreto owner 2026-10-09): a Luna
-- manda ordens diretas pro O Vênus pelo painel; a varredura dele consome e
-- executa. Hierarquia: Luna sempre manda por cima — ordem dela é OBRIGATÓRIA.
CREATE TABLE IF NOT EXISTS luna_ordens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ordem text NOT NULL,
  contexto text, -- opcional: porquê/contexto da ordem
  status text NOT NULL DEFAULT 'pending', -- pending | done | error | ignored
  result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_luna_ordens_pending ON luna_ordens (created_at)
  WHERE status = 'pending';
