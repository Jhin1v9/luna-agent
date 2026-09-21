-- F1.2 — Events/DB: outbox (§7.8), DLQ (§7.7), idempotência (§7.6),
-- audit/activity log (§20). A 001_foundation fica INTACTA — append-only.

-- ──────────────────────────── outbox (§7.8) ────────────────────────────
-- Estado + evento na MESMA transação. O dispatcher publica marando
-- published_at; falhas reentram com backoff até virarem dead.
CREATE TABLE outbox (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id      TEXT NOT NULL UNIQUE REFERENCES events(event_id),
    event_type    TEXT NOT NULL,
    payload       JSONB NOT NULL,              -- envelope completo (§7.4)
    status        TEXT NOT NULL DEFAULT 'pending', -- pending | published | dead
    attempts      INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at     TIMESTAMPTZ,
    occurred_at   TIMESTAMPTZ NOT NULL,
    published_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_poll ON outbox(status, next_retry_at) WHERE status = 'pending';

-- ──────────────────────────── dead_letter_events (§7.7) ────────────────────────────
-- Evento/job que esgotou tentativas: motivo, último erro, tentativas, stack.
CREATE TABLE dead_letter_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    TEXT,
    event_type  TEXT,
    source      TEXT NOT NULL,               -- quem falhou: handler, job_type, worker…
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason      TEXT NOT NULL,
    last_error  TEXT,
    attempts    INTEGER NOT NULL DEFAULT 0,
    stack       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dlq_created ON dead_letter_events(created_at);

-- ──────────────────────────── idempotency_keys (§7.6) ────────────────────────────
-- "Já processei isso?" → chave vista retorna o evento original. Retry de rede
-- nunca vira execução dupla.
CREATE TABLE idempotency_keys (
    key        TEXT PRIMARY KEY,
    event_id   TEXT NOT NULL REFERENCES events(event_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──────────────────────────── audit_log (§20 — máquina) ────────────────────────────
-- actor, event, tool, client, correlation_id, duration, result, timestamp, commit.
CREATE TABLE audit_log (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor          TEXT NOT NULL,
    action         TEXT NOT NULL,
    tool           TEXT,
    client_id      UUID REFERENCES clients(id),
    correlation_id TEXT,
    duration_ms    INTEGER,
    result         TEXT NOT NULL DEFAULT 'success', -- success | failed
    commit_hash    TEXT,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_correlation ON audit_log(correlation_id);

-- ──────────────────────────── activity_log (§20 — humano) ────────────────────────────
-- "14:31 — Respondi a Jess." Frases curtas para gente ler, não para máquina.
CREATE TABLE activity_log (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor          TEXT NOT NULL DEFAULT 'luna',
    client_id      UUID REFERENCES clients(id),
    kind           TEXT NOT NULL DEFAULT 'info', -- info | action | incident
    summary        TEXT NOT NULL,
    correlation_id TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_created ON activity_log(created_at DESC);

-- ──────────────────────────── refino de jobs (F1.2) ────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
