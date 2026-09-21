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
> **F1.4 WhatsPlay + Brain Real ✅ (critério PARCIAL — falta key de brain válida
> e confirmação do owner p/ envio)** — KimiApiAdapter (fast brain oficial,
> §7.2; anti-mock por decreto — ADR-016) e **GeminiAdapter (fast brain
> INTERINO p/ teste, ADR-018)** sobre OpenAiCompatAdapter compartilhado.
> WhatsPlay real: Chrome dedicado, captura por mutação de DOM, transport
> isolado, watchdog 5 estados, grupo §5, debounce §19, client lock, fila de
> saída NOTIFY, Telegram §15, selector memory. **Falso negativo de detecção
> corrigido** (ADR-017 corrigido: a sessão ESTAVA pareada; heurística pura em
> `state.ts` + polling; leitura real validada — badges, abertura de painel,
> extração de mensagens). Bug de robustez do dispatcher corrigido (payload
> inválido → DLQ `invalid_envelope`, nunca 'running' preso). Chamada real à
> Gemini: **key rejeitada pelo endpoint (400 Invalid Auth key)** — key não tem
> formato Google (`AIza…`); pendente do owner reemitir (ver ADR-018). Ciclo
> vivo completo até o envio validado: publish real → dispatch → brain → falha
> EXPLÍCITA auditada (5 tentativas → DLQ), zero resposta fake. Testes:
> 46 unitários + 26 de integração, verdes. Próxima: F1.5 Recovery/E2E.

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
