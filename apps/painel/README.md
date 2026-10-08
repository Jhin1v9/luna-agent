# PAINEL DA LUNA — Next.js + Tailwind (mock pronto para o real)

Painel de controle operacional da Luna. **100% funcional em modo mock** — os dados
vivem em memória em `lib/store.ts`. Para plugar no stack real, **somente `lib/store.ts`
muda**; rotas (`app/api/*`) e frontend (`app/page.tsx`) permanecem intactos.

## Rodar

```bash
cd apps/painel   # ou a pasta onde este pacote foi colocado
pnpm install
pnpm dev         # http://127.0.0.1:3101
# ou em producao:
pnpm build && pnpm start
```

## Mapa mock -> real (troca na IA local, arquivo a arquivo dentro de lib/store.ts)

| Funcao | Real a implementar |
|---|---|
| `getModo` / `setEnvKey` | Ler/gravar `.env` da raiz do repo via `fs` (gravacao atomica tmp+rename). Allowlist e fail-closed JA estao no codigo |
| `getValidacao` | `fetch http://127.0.0.1:8000/v1/models` (colibri), `SELECT 1` via pg (host da DATABASE_URL), `getMe` do Telegram, `fetch https://vps.nexo-digital.app/brain/` (status HTTP) |
| `getChats` | `SELECT DISTINCT metadata->>'chat_id', COUNT(*), MAX(created_at) FROM messages ...` (saidas recentes; default `productions`) |
| `getAtividade` | `... WHERE direction='outbound' AND sender IN ('luna','agent:venus') ORDER BY created_at DESC LIMIT 20` |
| `getContexto` | `... WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 8` |
| `sendMessage` | `INSERT INTO messages (..., send_state='queued')` + `SELECT pg_notify('luna_outbound', '<id>')` — o whatsplay consome e entrega |
| `getServicos` | `SELECT service, pid, meta, seen_at FROM service_heartbeats` — estado em `meta.state/overall/ready`; parado se > 90s |
| `getInbox` / `reprocessarInbox` | `kimiwork_inbox` — reprocessar: `UPDATE ... SET status='pending', processed_at=NULL WHERE id=$1 AND status IN ('done','error')` |
| `escalarInbox` | `INSERT INTO kimiwork_llm_turns (session_key, prompt, channel) VALUES ('inbox:<id>', ..., 'geral')` |
| `responderTurno` | `UPDATE kimiwork_llm_turns SET status='answered', response=$2, answered_at=now() WHERE id=$1 AND status='pending' RETURNING id` (atomico, ja espelhado) |
| `getVenus` | pm2 `jlist` para `venus-varredura` (ou heartbeat proprio em `service_heartbeats` — exige NOVA migracao append-only) |
| `invocarTarefa` | `spawn('node', ['scripts/venus/venus.mjs', '--tarefa', texto], { cwd: repoRoot })`, capturando stdout/stderr para o log |

## Contratos de API (ja estabilizados — nao mudar)

- `GET/POST /api/modo` · `GET /api/validacao` · `GET /api/chats` · `POST /api/mensagem`
- `GET /api/atividade` · `GET /api/conversas/:id/contexto` · `GET /api/servicos`
- `GET /api/inbox` · `POST /api/inbox/:id/reprocessar` · `POST /api/inbox/:id/escalar`
- `GET /api/turnos` · `POST /api/turnos/:id/responder` · `GET /api/venus` · `POST /api/venus/tarefa`

## pm2 (sobreviver a reboot junto com o stack)

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

## Regras mantidas

- Zero emojis (icones Lucide inline)
- Guard-rail de prazo ativo em `sendMessage` (regex bloqueia "essa semana", "amanha", "te entrego", etc.)
- Segredos so como presenca/ausencia — nunca valores
- Fail-closed na allowlist do .env (chave e valor validados server-side)
- Countdown de heartbeats rotulado como ESTIMATIVA
- Auto-refresh de 10s em Validacao, Servicos, Inbox e Turnos (sem perder o que esta sendo digitado)
