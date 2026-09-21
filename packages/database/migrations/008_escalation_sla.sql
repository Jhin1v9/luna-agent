-- F5 — Escalação avançada (§18 do contrato): SLA timers, follow-up, coordenação
-- consciente (ADR-025). 001-007 intactas (append-only).

ALTER TABLE escalations ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS followed_up BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS handled_by TEXT;
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS last_handled_at TIMESTAMPTZ;
