# Prompt de handoff — Kimi Code na Luna (luna-agent)

Cole no Kimi Code (workspace `C:\Users\Abner\Documents\Luna cto\luna-agent`):

---

Você é o engenheiro da **Luna**, cérebro operacional da Nexo Digital. Continue o trabalho EXATAMENTE de onde paramos (2026-09-24 ~21:20). Leia primeiro `AGENTS.md`, `.brain/README.md` e `.brain/luna/synapses/2026-09.md` (diário completo do dia) — não repita o que já foi feito.

## Feito hoje (NÃO refaça)
- API nova no repo **nexo-workspace** (separado, clone em `.brain/.nexo-workspace-src`): `POST /nexo/api/admin/requests` (commit cf139af, deployada, produção).
- Solicitação da Jess criada pelo painel; cron automation_27b0babd (10 min) saudável; dedup do workspace feito.
- `.brain/luna/prompt-nova-kimi.md` (onboarding da Kimi-2) e skill `solicitacoes-painel` prontos.

## Estado do working tree (importante)
Há mudanças NÃO commitadas da sessão de voz (~9 arquivos: orchestrator, watchdog, whatsplay index/voice, worker index/replay/tools-run-evals, OPINIONES.md — diffstat ~122+/14-). **Passo 0: rode `pnpm typecheck` e `pnpm test:unit`, revise o diff, e commite como Luna** (`git -c user.name=Luna -c user.email=luna@nexo-digital.app`) com mensagem explicando o porquê, OU descarte se for resto de debug. Também há `apps/whatsplay/daemon-restart*.err` — leia-os, eles podem conter a causa de quedas.

## Bugs priorizados para corrigir (ordem = prioridade)
1. **BUG 1 (grave, vivo): outbound do WhatsApp embaralha caracteres quando 2 envios concorrem** (char-interleaving — relatado pelo owner; respostas curtas foram a mitigação). Falta serialização por chat no pipeline. Onde: `apps/whatsplay/src/outbound.ts` (watchdog conta 'queued', dispara pg_notify 'luna_outbound'). Faça fila por conversation com trava (ex.: `SELECT ... FOR UPDATE SKIP LOCKED` ou lock em tabela por chat_id) e teste com 2 envios simultâneos.
2. **BUG 2: detector de chamada captura o rótulo do botão do popup como caller** (2x hoje, ~5 ocorr. em 15 min). Onde: `apps/whatsplay/src/voice/incoming-fastpath.ts` — o seletor do caller está pegando aria/label errado. Corrija o seletor e atualize o teste `incoming-fastpath.test.ts`.
3. **`voice.call` sem handler no worker** (DLQ 22/09: "nenhum handler registrado para job_type 'voice.call'"). Verifique se o handler existe hoje em `apps/worker/src/index.ts` e se o enqueue (`packages/database`) bate com o registro; se já foi corrigido, feche com teste de integração.
4. **`conversation.classify` morre quando Kimi dá 403 e Gemini dá 429** (5 mortes 22–23/09). O ADR-040 criou o provider kimiwork (adapter em `packages/agent/src/kimiwork.ts`) — verifique se o classify usa a cadeia completa Kimi→Gemini→kimiwork com retry/backoff; se não, integre.
5. **kimi-cli resposta vazia tratada como sucesso** (4 mortes 21/09: "exit ok, N linhas stream-json" mas sem conteúdo). Onde: handler de investigate no worker — tratar stream vazio como falha com retry.
6. **DLQ com 20 eventos** (`dead_letter_events`): 2-3 `invalid_envelope` (payloads legados sem event_id — normalizar no ingest ou arquivar), restante são causas 3-5 acima. Regra do projeto: não deletar, analisar. Proponha um script `scripts/dlq-analyze.ts` que classifique e (re)enfileue os recuperáveis.
7. **`investigate` com budget explora mas não entrega objeto** (respostas cortadas/timeout 600s no kimiwork). Verificar prompt/timeout em `apps/worker/src/jobs/investigate.ts`.

## Regras do projeto (AGENTS.md)
- Simple Until Complexity Is Earned; migrações append-only; Event Envelope universal (`@luna/events`); secrets nunca em logs (`@luna/logging` redige); commits em PT-BR curtos, autor Luna; **nunca commite .env** (nem .env.bak — eles foram deletados hoje, não recrie).
- Antes de considerar pronto: `pnpm typecheck` + `pnpm test` (integração sobe/derruba `luna_test` sozinha) + orchestrator respondendo em `/health` e `/ready` (porta 3100).

## Verificação rápida de contexto
- Postgres local :5433 (script `scripts/start-postgres.sh` se precisar). Health: `curl localhost:3100/ready`.
- WhatsApp roda headless pelo whatsplay (Chrome dedicado); áudio da máquina passa por Voicemeeter Banana (agora no startup do Windows; FxSound foi removido — não reintroduza dependência dele).

Comece pelo Passo 0 (typecheck/test/commit do working tree), depois BUG 1. Quando terminar cada bug: commit + linha em `.brain/luna/synapses/2026-09.md`.
