-- F1.5 — Heartbeats de serviços (§20 watchdog geral). 001-004 intactas.
-- Cada daemon sobe sua linha; o watchdog geral lê e decide restart.

CREATE TABLE IF NOT EXISTS service_heartbeats (
    service    TEXT PRIMARY KEY,          -- orchestrator | whatsplay | worker | watchdog
    pid        INTEGER,
    meta       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {state, pageAlive, session, ...}
    seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
