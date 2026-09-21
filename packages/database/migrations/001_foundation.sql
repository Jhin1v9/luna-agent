-- F1.1 — Schema operacional inicial (§7.12).
-- Colunas básicas + timestamps + índices óbvios; F1.2 refinará (outbox, DLQ,
-- idempotency keys, constraints de enums).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ──────────────────────────── organizations ────────────────────────────
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──────────────────────────── plans ────────────────────────────
CREATE TABLE plans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    code        TEXT NOT NULL UNIQUE,
    monthly_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    limits      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──────────────────────────── clients ────────────────────────────
CREATE TABLE clients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    plan_id         UUID REFERENCES plans(id),
    name            TEXT NOT NULL,
    code            TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'active',
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clients_org ON clients(organization_id);

-- ──────────────────────────── contacts ────────────────────────────
CREATE TABLE contacts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID NOT NULL REFERENCES clients(id),
    name        TEXT,
    channel     TEXT NOT NULL,              -- whatsapp | email | push ...
    address     TEXT NOT NULL,              -- telefone / email / endpoint
    is_primary  BOOLEAN NOT NULL DEFAULT false,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, channel, address)
);
CREATE INDEX idx_contacts_client ON contacts(client_id);

-- ──────────────────────────── channel_preferences ────────────────────────────
CREATE TABLE channel_preferences (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID NOT NULL REFERENCES clients(id),
    channel     TEXT NOT NULL,              -- whatsapp | email | push
    enabled     BOOLEAN NOT NULL DEFAULT true,
    config      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, channel)
);

-- ──────────────────────────── conversations ────────────────────────────
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES clients(id),
    contact_id      UUID REFERENCES contacts(id),
    channel         TEXT NOT NULL,
    state           TEXT NOT NULL DEFAULT 'NEW',  -- §7.11 state machine
    subject         TEXT,
    last_message_at TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_client ON conversations(client_id);
CREATE INDEX idx_conversations_state ON conversations(state);

-- ──────────────────────────── messages ────────────────────────────
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    direction       TEXT NOT NULL,          -- inbound | outbound
    channel         TEXT NOT NULL,
    sender          TEXT NOT NULL,          -- contact | luna | agent:<nome>
    body            TEXT NOT NULL,
    external_id     TEXT,                   -- id no canal (idempotência)
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE UNIQUE INDEX idx_messages_external ON messages(channel, external_id)
    WHERE external_id IS NOT NULL;

-- ──────────────────────────── events ────────────────────────────
-- Tabela-append do Event Envelope universal (§7.4). payload guarda o envelope completo.
CREATE TABLE events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        TEXT NOT NULL UNIQUE,   -- evt_<uuid> global
    event_type      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    organization_id UUID REFERENCES organizations(id),
    client_id       UUID REFERENCES clients(id),
    conversation_id UUID REFERENCES conversations(id),
    correlation_id  TEXT NOT NULL,
    causation_id    TEXT,
    priority        INTEGER NOT NULL DEFAULT 0,
    payload         JSONB NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_type ON events(event_type, occurred_at);
CREATE INDEX idx_events_correlation ON events(correlation_id);
CREATE INDEX idx_events_client ON events(client_id, occurred_at);

-- ──────────────────────────── jobs ────────────────────────────
-- Cola inicial = tabela + worker (§7.12). Sem Kafka.
CREATE TABLE jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type        TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    status          TEXT NOT NULL DEFAULT 'pending', -- pending | running | completed | failed | dead
    priority        INTEGER NOT NULL DEFAULT 0,
    run_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    last_error      TEXT,
    idempotency_key TEXT UNIQUE,
    locked_by       TEXT,
    locked_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_jobs_poll ON jobs(status, priority DESC, run_at)
    WHERE status = 'pending';

-- ──────────────────────────── notifications ────────────────────────────
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID REFERENCES clients(id),
    event_id        TEXT,
    channel         TEXT NOT NULL,
    recipient       TEXT NOT NULL,
    title           TEXT,
    body            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending', -- pending | sent | delivered | failed
    error           TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_status ON notifications(status, created_at);

-- ──────────────────────────── agent_runs ────────────────────────────
CREATE TABLE agent_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        TEXT,
    client_id       UUID REFERENCES clients(id),
    agent           TEXT NOT NULL DEFAULT 'luna',
    brain           TEXT,                   -- fast | live
    status          TEXT NOT NULL DEFAULT 'running', -- running | completed | failed
    input           JSONB NOT NULL DEFAULT '{}'::jsonb,
    output          JSONB,
    error           TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_runs_client ON agent_runs(client_id, started_at);

-- ──────────────────────────── run_buffer_lines (§20) ────────────────────────────
CREATE TABLE run_buffer_lines (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id      UUID NOT NULL REFERENCES agent_runs(id),
    seq         INTEGER NOT NULL,
    line        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, seq)
);

-- ──────────────────────────── tool_runs ────────────────────────────
CREATE TABLE tool_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_run_id    UUID REFERENCES agent_runs(id),
    tool            TEXT NOT NULL,
    input           JSONB NOT NULL DEFAULT '{}'::jsonb,
    output          JSONB,
    status          TEXT NOT NULL DEFAULT 'success', -- success | failed
    error           TEXT,
    duration_ms     INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tool_runs_run ON tool_runs(agent_run_id);

-- ──────────────────────────── escalations ────────────────────────────
CREATE TABLE escalations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id    UUID REFERENCES clients(id),
    conversation_id UUID REFERENCES conversations(id),
    reason       TEXT NOT NULL,
    priority     TEXT NOT NULL DEFAULT 'NORMAL', -- CRITICA | ALTA | NORMAL | BAJA
    status       TEXT NOT NULL DEFAULT 'open',   -- open | resolved
    assigned_to  TEXT,
    resolved_at  TIMESTAMPTZ,
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_escalations_status ON escalations(status, priority);

-- ──────────────────────────── incidents ────────────────────────────
CREATE TABLE incidents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    severity     TEXT NOT NULL DEFAULT 'info',   -- info | warning | critical
    source       TEXT NOT NULL,                  -- componente que falhou
    title        TEXT NOT NULL,
    description  TEXT,
    root_cause   TEXT,
    fix_summary  TEXT,
    status       TEXT NOT NULL DEFAULT 'open',   -- open | resolved
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_incidents_status ON incidents(status, created_at);

-- ──────────────────────────── usage_entries ────────────────────────────
CREATE TABLE usage_entries (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id      UUID REFERENCES clients(id),
    event_id       TEXT,
    provider       TEXT NOT NULL,
    model          TEXT NOT NULL,
    input_tokens   INTEGER NOT NULL DEFAULT 0,
    output_tokens  INTEGER NOT NULL DEFAULT 0,
    estimated_cost NUMERIC(12,6) NOT NULL DEFAULT 0,
    billable_units INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_client ON usage_entries(client_id, created_at);

-- ──────────────────────────── memory_index ────────────────────────────
CREATE TABLE memory_index (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID REFERENCES clients(id),
    type        TEXT NOT NULL,
    path        TEXT NOT NULL,
    tags        TEXT[] NOT NULL DEFAULT '{}',
    summary     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_client ON memory_index(client_id, type);

-- ──────────────────────────── projects ────────────────────────────
CREATE TABLE projects (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id    UUID NOT NULL REFERENCES clients(id),
    name         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active',
    repo_url     TEXT,
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_client ON projects(client_id);

-- ──────────────────────────── tasks ────────────────────────────
CREATE TABLE tasks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID REFERENCES projects(id),
    client_id    UUID REFERENCES clients(id),
    title        TEXT NOT NULL,
    description  TEXT,
    status       TEXT NOT NULL DEFAULT 'todo', -- todo | in_progress | done | blocked
    assignee     TEXT,
    due_date     DATE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_status ON tasks(status);

-- ──────────────────────────── reports ────────────────────────────
CREATE TABLE reports (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id    UUID REFERENCES clients(id),
    type         TEXT NOT NULL,
    title        TEXT NOT NULL,
    content      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_client ON reports(client_id, created_at);

-- ──────────────────────────── brain_commits ────────────────────────────
-- Referência auditável de commits do Brain (Git privado, §11).
CREATE TABLE brain_commits (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id    UUID REFERENCES clients(id),
    repo         TEXT NOT NULL,
    commit_hash  TEXT NOT NULL,
    author       TEXT NOT NULL DEFAULT 'Luna',
    message      TEXT NOT NULL,
    paths        TEXT[] NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (repo, commit_hash)
);
