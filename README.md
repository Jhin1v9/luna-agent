# luna-agent

Infraestrutura da Luna — CTO virtual da Nexo Digital. Arquitetura: monolito
modular orientado a eventos (§7.1), PostgreSQL como estado operacional (§7.12),
cola = tabela `jobs` + worker.

## Estado atual

> **Aviso permanente para novas sessões/agentes:** o estado do repo é consistente
> e verificado — migração `001_foundation` já aplicada (22 tabelas), lockfile
> consistente com o código, testes e typecheck verdes. **Não reinstale
> dependências (`pnpm install --force`/rebuild) nem reaplique migrações "do
> zero"** (drop/recreate) achando que é setup novo — isso derruba o estado
> validado. Para evoluir: migrações novas são `00X_nome.sql` (nunca editar a
> 001), e `pnpm install` normal é suficiente.
>
> Fases: F1.1 Foundation ✅ (skeleton orchestrator, Postgres, config, logging,
> health/ready/metrics). **F1.2 Events/DB ✅** — event bus (publish em
> transação única: `events` + `outbox`, §7.8), dispatcher com retry/backoff e
> DLQ (`dead_letter_events`, §7.7), idempotência por `idempotency_key` (§7.6),
> worker pollando `jobs` com `FOR UPDATE SKIP LOCKED`, audit log (máquina) e
> activity log (humano) — §20. Migração `002_events_outbox_dlq_audit` aplicada
> (27 tabelas; a 001 intacta). Testes: 8 unitários + 13 de integração contra
> Postgres real, todos verdes.
>
> **F1.3 Kimi Live ✅** — KimiAdapter (`@luna/agent`, interface estável +
> modo mock determinístico; REST do `kimi web` local verificada ao vivo,
> sendTurn via WS experimental — ver docs/adr/ADR-015-kimi-adapter-mock.md),
> identidade completa em `.kimi-code/agents/luna.md` (§3/§4/§5, sem templates),
> Context Builder mínimo (pack CLIENT_CONVERSATION, §7.9), state machine de
> atenção (NEW→AI_HANDLING→RESOLVED persistido, §7.11), handler real de
> `client.message.received` com activity + audit **sempre com correlation_id**,
> endpoint de teste `POST /test/simulate-message` (só fora de produção,
> WhatsPlay real é F1.4), reaper de locks travados no worker, e **primeiro
> evento end-to-end validado ao vivo** (curl → evento → resposta persistida →
> RESOLVED → evidência com correlation). Migração 003: não precisou.
> Testes: 18 unitários + 21 de integração, verdes.
>
> **F1.4 WhatsPlay + Brain Real ✅ FECHADO (ciclo real validado)** — KimiApiAdapter
> com key REAL do owner: modelo **`kimi-k2.6`** via `https://api.kimi.com/coding/v1`
> (key do Coding Plan; rejeita temperature≠1 — adapter não envia; ADR-019).
> Decreto registrado: modelo sempre o mais barato, NUNCA 2.7/K3. Config LLM_*
> no zod (contrato §9: troca de provider = só .env). **Ciclo real
> ponta-a-ponta validado ao vivo**: msg real de grupo no WhatsApp do owner →
> watcher (baseline não-invasivo, zero disparo em conversa parada) → evento →
> Context Builder → kimi-k2.6 real (399/447 tokens, 15.4s) → resposta na
> persona → **envio real autorizado** com espera humana anti-ban (~87s) →
> sent + activity + audit num correlation_id só → RESOLVED. Achado do teste
> vivo: grupo detectado como privado (heurística de nome) — violação §5,
> corrigido com jid `@g.us`, daemon reiniciado. Ingest = watcher de badges
> (ADR no watcher.ts; sweep de allowlisted cobre msgs lidas/virtualizadas e o
> self-test do owner). Gemini interino mantido como opção (ADR-018).
>
> **F2 Notificações multicanal + cérebro estruturado ✅** — Model Router
> (contrato v1.1): routes em config versionada (`config/routes.json`, mudar =
> commit sem tocar código), saídas estruturadas ANSWER/TOOL_CALL/HANDOFF_LIVE/
> ESCALATE_HUMAN com guardas (TOOL_CALL tope 5, HANDOFF 1 por evento + espera
> ao cliente, pedido explícito de humano = zero IA, HUMAN_HANDLING silencia a
> Luna), tools de leitura, eventos router.* (§11), investigation budget
> registrado (handoff executa como espera+registro — live brain pendente,
> ADR-023). Notifications engine (§22): fan-out por preferência do cliente,
> deliveries pending/sent/failed, dedupe por idempotency_key (migração 006),
> whatsapp (fila existente + guardrails) / email SMTP (nodemailer) / push PWA
> (web-push+VAPID) — fail-closed com capability logada no boot (ADR-025).
> Usage ledger (§23/§28): provider/modelo reais + estimated_cost com preços
> versionados (`config/prices.json`), custo interno ≠ billable_units
> (ADR-024). Endpoint do workspace: `POST /v1/events` com Bearer
> WORKSPACE_SERVICE_TOKEN (503 fail-closed sem token, exemplo no .env.example
> e no código). **136 testes verdes.** Telegram @lunanexobot: token pendente
> do owner — quando entrar no .env, todos os alertas funcionam sem mudança
> de código (`pm2 restart all`). ADRs 015–025. Próxima: F3 — memória/contexto
> completo (Brain, Context Builder full, memory index, promotion, summaries).
>
> **F1.5 Recovery/E2E ✅ — FASE F1 COMPLETA** — auto-reparo visual com VISÃO
> REAL do k2.6 (probe no boot: `vision: true` — ADR-021): screenshot+DOM →
> FAST analisa → retry com seletor sugerido → máx 3 → selector memory
> automática (§13) + incident + Telegram (falha explícita se sem token).
> Watchdog geral (§20, ADR-022) + self-test (boot + 6h) + heartbeats (migração
> 005). Supervisão em duas camadas: **pm2 ressobe processos** (ecosystem,
> node direto no tsx), **watchdog supervisiona saúde** e alerta.
> `@luna/channels` real (Telegram). Acceptance E2E da §31 validado AO VIVO:
> reboot no meio de job (sem perda) · duplicata não duplica · isolamento A/B ·
> chrome morto → relaunch automático com sessão persistente (sem QR) · falha →
> alerta explícito · correlation na cadeia · activity+audit. **112 testes
> verdes.** Daemons: `pm2 list` (luna-orchestrator/whatsplay/worker/watchdog;
> `pm2 save` feito; `pm2 startup` pendente — precisa admin). ADRs 015–022 em
> `docs/adr/`. Próxima: F2 — notificações multicanal (push PWA, email,
> WhatsApp por preferência) + usage ledger completo + Model Router.
> Divergências: reboot de máquina simulado por restart de processos; Telegram
> sem token (alertas explícitos em log).

## Quick start

```bash
pnpm install
cp .env.example .env
bash scripts/start-postgres.sh   # Postgres 16 em docker (porta 5433)
pnpm migrate                     # migrações SQL
pnpm dev:orchestrator            # http://localhost:3100
```

Endpoints: `GET /health` · `GET /ready` · `GET /metrics`

```bash
pnpm test         # unitários (packages) + integração (Postgres real, banco luna_test)
pnpm test:unit    # só unitários
pnpm test:integration  # só integração — cria/derruba o banco luna_test sozinho
pnpm typecheck    # tsc --noEmit
```

Ver `AGENTS.md` para as regras do projeto.
