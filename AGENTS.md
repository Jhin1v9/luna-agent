# AGENTS.md — luna-agent

Infraestrutura da **Luna**, CTO virtual da Nexo Digital. Contrato de arquitetura:
`../LUNA-AGENT-v3-1ARQUITECTURA-DEFINITIVA.md` (§7.1, §7.12, §17/§20, §21, §32).

## Stack

Node 24 · TypeScript (strict) · pnpm workspaces · PostgreSQL 16 (pg puro, sem ORM) ·
pino (logging estruturado) · zod (config + validação) · vitest.

## Como rodar

```bash
pnpm install
cp .env.example .env          # ajuste se necessário
bash scripts/start-postgres.sh  # sobe Postgres 16 em docker (porta 5433)
pnpm migrate                    # aplica migrações em packages/database/migrations
pnpm dev:orchestrator           # sobe o orchestrator (tsx watch)
pnpm dev:worker                 # worker (heartbeat por enquanto)
```

Health: `GET /health` (liveness), `GET /ready` (readiness — depende do Postgres),
`GET /metrics` (Prometheus texto). Porta default: **3100**.

## Regras do projeto

1. **Simple Until Complexity Is Earned** — sem Kafka/microserviços/ORM pesado.
   Cola = tabela `jobs` + worker. SQL migrações à mão em `packages/database/migrations`.
2. **Secrets nunca em logs** (§21) — o logger (`@luna/logging`) redige
   `authorization`, `password`, `token`, `apiKey`, `secret`, `cookie` em qualquer
   profundidade. Nunca logue env/credentials com outros meios.
3. **Todo evento usa o Event Envelope universal** (§7.4) de `@luna/events` —
   criar com `createEvent`, validar entrada externa com `validateEvent`.
4. **Config só via env validada** com zod (`@luna/shared` → `loadConfig`).
   Defaults de dev apontam para `localhost:5433/luna`.
5. **Migrações são append-only em dev/prod**: nunca edite uma migração já aplicada;
   crie `00X_nome.sql` novo (a 001_foundation ficou intacta; a 002 traz outbox,
   DLQ, idempotency_keys, audit/activity e `jobs.completed_at`).
6. **Eventos**: publicar = `EventBus.publish` (grava `events` + `outbox` + idempotency
   key na MESMA transação). Nunca inserir em `events`/`outbox` fora do bus.
   Falhas de dispatch viram `dead_letter_events` — não delete, analise.
7. **Commits**: mensagens curtas e diretas em português; mudanças grandes explicam
   o porquê no corpo.

## Testes e verificação

```bash
pnpm test          # unitários (packages) + integração (Postgres real, luna_test)
pnpm test:unit     # só unitários — envelope de eventos, redaction do logger
pnpm test:integration  # só integração — migrator, event bus, idempotência, worker
pnpm typecheck     # tsc --noEmit em todos os pacotes
```

Os testes de integração (`tests/integration/`) criam e derrubam o banco
`luna_test` sozinhos — nunca tocam no `luna` de dev. Override via
`TEST_DATABASE_URL`. Config da integração: `vitest.integration.config.ts`
(nome fora do padrão de descoberta para não vazar para os packages).

Antes de considerar pronto: migrator rodando contra Postgres real, orchestrator
respondendo em `/health` e `/ready`, e testes passando.

## Estrutura (§32)

```
apps/     orchestrator (HTTP + event bus/outbox) · worker (poll de jobs) · whatsplay/admin (placeholders)
packages/ events · database (pool, migrator, audit/activity, enqueueJob) · logging · shared (reais) · brain · agent · channels (placeholders)
scripts/  start-postgres.sh
docs/     adr/ (decisões)
tests/    integration/ (vitest contra Postgres real — banco luna_test)
```
