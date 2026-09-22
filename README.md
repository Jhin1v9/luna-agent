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
> **Pós-F2 (hotfixes decretados pelo owner) ✅** — **BUG DE ROTEAMENTO
> GRAVO corrigido**: pergunta no grupo que foi respondida no privado errado —
> causa raiz com evidência (sweep atribuindo texto do painel aberto ao chat
> errado quando a row estava fora da lista virtualizada). Fix: openChat
> VERIFICA o título do painel + fallback pela busca; readConversation retorna
> [] sem o chat certo; sendMessage falha em vez de digitar no painel errado.
> **SEND-SAFETY incondicional** no whatsplay: mismatch pergunta→resposta =
> bloqueio + alerta imediato ao owner no Telegram + audit. Regressões
> cobertas (2 testes). Escopo revertido pelo owner: allowlists voltaram a
> Pai + 🏆Production-2026 (ADR-020 atualizado). **Classifier pós-conversa
> (§27, ADR-026)**: taxonomia pequena travada, pipeline RESOLVED→job→worker
> → DB + Brain (OPINIONES + sinapses `.brain/luna/synapses/YYYY-MM.md`
> assinadas) + memory_index; `@luna/brain` real; seed dev (Jess/onadance,
> NEXO Internal). Migração 007. **144 testes verdes.**
> **TELEGRAM VIVO ✅** (2026-09-22) — chat_id do grupo Nexo Digital recuperado
> do runbook do luna-kernel; alerta de sistema entregue; cascata + chat admin
> ativos.
>
> **Rodada F8 + varredura ✅ (2026-09-22)** — DLQ redrive automático (§7.7:
> falhas transientes como quota 403 voltam pra fila sozinhas; 5+ eventos reais
> do owner recuperáveis), auto-gatilho do heal (ADR-030: DOWN persistente com
> plano registrado dispara runHeal; sem plano = diagnóstico assistido, nunca
> palpite), **F8 hardening**: 15 golden conversations reais com evals (score
> 93/100 ao vivo — baseline anti-regressão de prompt), replay §29 validado
> (dry-run de evento real), failure injection formalizada (LLM
> timeout/down/tool-500), backup/restore TESTADOS (dump + restore num
> scratch: 24 clientes/99 msgs/schema 008) + backup diário no watchdog.
> **173 testes verdes. 5 serviços online, backup agendado rodando.**
> Telegram chat_id ainda pendente (poll autocontido ativo).
>
> **F5 + F7 ✅ (2026-09-22)** — F5 escalação avançada: SLA real (CRÍTICA 5min/
> ALTA 10min → follow-up de degrau, uma vez), coordenação consciente
> (humano responde → HUMAN_HANDLING + handled_by; humano extra → status, jamás
> re-escalação; humano some 15min + cliente ativo → cascata retoma com
> contexto), Luna silenciada em HUMAN_HANDLING no caminho real do WhatsApp.
> F7 auto-evolução (ADR-029): pipeline runHeal com gate duplo (typecheck+
> testes), commit autor Luna, merge main, restart, health retry, LKG, rollback
> automático, máx 3 tentativas, whitelist de componentes próprios (cliente
> VEDADO, migrations proibidas), incidentes viram learnings no Brain. PROVA AO
> VIVO: bug plantado no pingline → detectado → reparo commitado (fb32cbd) →
> testes verdes → health verde, com audit + sinapse + activity. Estabilização
> ADR-028: crash loop (Docker fora + arquivo corrompido) resolvido; janelas de
> CMD = fork mode visível + loop (pm2 como serviço Windows = pendente).
> **161 testes verdes. 5 serviços pm2 online.** Telegram chat_id ainda
> pendente (poll autocontido rearmado — owner manda msg pro @lunanexobot).
>
> **Tools da VPS Nexo ligadas ✅** — catálogo oficial em
> `docs/tools/nexo-api-catalog.md` (mapeado ao vivo do bundle do dashboard
> pro: base `/dashboard/api/`, Bearer via login). **12 tools de LEITURA** no
> TOOL_CALL do Model Router (finanças, clientes, leads, tarefas, caixa,
> orçamentos, notificações, relatórios, sistema) — a Luna consulta dados
> REAIS da VPS e responde no WhatsApp com eles. ~20 endpoints RESTRITOS
> catalogados sem implementação (pagamentos, escrita, system/control, VNC,
> namespace /api/luna/* quebrado do kernel legado). Business guard no prompt:
> consulta livre, ação comercial NUNCA (§4). Credenciais via env; chamada
> real validada (7 clientes reais + finanças EUR). Pendência: usuário de
> serviço próprio pra Luna (owner).
>
> **Pós-F2 — decretos + F3 adiantado + F4 mínimo ✅** — (1) NUNCA deixar
> chat aberto: closeCurrentChat após ler/responder + sweep só abre com
> trabalho novo; LIMITAÇÃO HONESTA (ADR-027): a plataforma não restaura o
> badge de não-lida — ler é irreversível; chip dedicado resolve. (2) Testes
> SÓ pro número do owner (jid 34685093192@s.whatsapp.net, match por número).
> FASE A (revisão): dep pool não usado no ingress, paridade de notificação
> no catch de entrega, sweep com autoria na transcrição. FASE B (F3):
> Context packs CLIENT_PROJECT e ADMIN_FULL selecionados PELA ROUTE,
> promotion protocol (§10/§11), summaries mensais no worker (memory_index +
> MEMORY.md + profile + sinapse — RODANDO ao vivo), estrutura do Brain
> garantida. FASE C (F4 mínimo): chat admin via Telegram (§25) — responde
> só o chat autorizado com dados REAIS; IDLE sem TELEGRAM_CHAT_ID.
> **147 testes verdes.** 4 serviços pm2 no ar. Pendências: chat_id Telegram
> (poll autocontido grava no .env quando o owner mandar msg pro bot),
> pm2 startup no boot (admin), chip dedicado, volume real p/ circuit breaker.
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

## Operação (Luna v1)

**Serviços (pm2):** `luna-orchestrator` (:3100), `luna-whatsplay` (Chrome
dedicado WhatsApp), `luna-worker` (jobs, classifier, auto-heal, admin
Telegram), `luna-watchdog` (saúde + self-test 6h + backup diário),
`luna-pingline` (prova de auto-evolução).

```bash
pm2 list                      # estado dos serviços
pm2 logs luna-orchestrator    # logs (mesmo padrão pros outros)
pm2 restart all --update-env  # aplica .env novo
pnpm migrate                  # migrações pendentes
pnpm test                     # 197 testes (unit + integração Postgres real)
pnpm --filter worker exec tsx src/tools-run-evals.ts   # golden conversations com LLM real (sob demanda)
pnpm --filter worker exec tsx src/tools-run-evals.ts --mock  # evals CI, zero token
pnpm --filter worker exec tsx src/replay.ts <event_id>      # replay §29 dry-run
bash scripts/backup-db.sh     # backup sob demanda (watchdog faz diário)
```

**Ações manuais do owner (uma vez):**
1. `pm2 startup` (terminal admin) — sobreviver reboot da máquina.
2. pm2 como serviço Windows ou wrapper hidden — sumir com as janelas de CMD
   (procedimento no ADR-028).
3. Chip dedicado WhatsApp — compra; remove a limitação do badge de não-lida.
4. Hardware de voz (docs/hardware-voz.md) — VB-Cable x2 + VoiceMeeter,
   checkpoints 1-3; o software da voz já está pronto.
5. Se a quota Kimi estourar: nada a fazer — o fallback pro Gemini é
   automático (sem GEMINI_API_KEY válida, falha explícita em log).
6. `AUTOHEAL_LLM_PATCH=true` no .env se quiser auto-reparo com diagnóstico
   por IA (ADR-031; OFF por default).

**Telegram:** grupo "Nexo Digital" ligado (@lunanexobot) — cascata de
escalação, alertas de watchdog/send-safety/auto-reparo e **chat admin** (o
time pergunta, a Luna responde com dados reais).
