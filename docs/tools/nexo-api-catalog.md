# Catálogo oficial de tools — APIs da VPS Nexo (dashboard pro + workspace)

> Mapeado ao vivo em 2026-09-21 contra `https://vps.nexo-digital.app` (curl + análise do bundle
> JS do dashboard). Base da API: **`/dashboard/api/`** (o prefixo importa — `/api/` puro responde 401).
> Auth: `POST /dashboard/api/auth/login` `{username, password}` → `{token}` → header
> `Authorization: Bearer <token>` (JWT, ~8h de validade). Credenciais **só via env**
> (`NEXO_API_USERNAME` / `NEXO_API_PASSWORD`) — nunca em código nem log (pino mascara).
> Decreto owner: ligado "igual um neurônio". Regra de ouro (§4) intocável: **consulta livre,
> ação comercial NUNCA** — tudo que escreve está em RESTRITO.

## Mapa dos apps (do ROTAS-VPS.md)

| Rota | App | Uso pra Luna |
|---|---|---|
| `/dashboard/` | NEXO DASHBOARD PRO (SPA Vite) | **É a API principal** (esta tabela) |
| `/nexo/` | workspace admin (Next.js/NextAuth) | sem API REST mapeada (sessão web) |
| `/cliente/` | workspace do cliente (Next.js) | auth `/cliente/api/auth/*` (NextAuth, cookie) |
| `/relatorios/` | Central de Relatórios (form+cookie) | relatório por cliente via slug (ver fim) |

## TOOLS IMPLEMENTADAS (leitura — livres pra Luna)

| Tool | Endpoint | Método | Retorna |
|---|---|---|---|
| `nexo.finance.summary` | `/dashboard/api/finance/summary` | GET | receita/despesa/caixa, saldos em EUR, clientes ativos |
| `nexo.clients.list` | `/dashboard/api/workspace/clients` | GET | clientes: nome, slug, status, pipeline, kind (lead/cliente), valor estimado |
| `nexo.leads.list` | `/dashboard/api/leads` | GET | leads: nome, email, telefone, origem |
| `nexo.tasks.list` | `/dashboard/api/tasks` | GET | tarefas: título, status, prioridade, origem |
| `nexo.cashbox.summary` | `/dashboard/api/cash-box` | GET | saldo caixa, projeção, entradas/saídas do mês |
| `nexo.expenses.list` | `/dashboard/api/expenses` | GET | despesas |
| `nexo.payments.list` | `/dashboard/api/payments` | GET | pagamentos registrados |
| `nexo.quotes.list` | `/dashboard/api/quotes` | GET | orçamentos/propostas |
| `nexo.ideas.list` | `/dashboard/api/ideas` | GET | ideias + stats |
| `nexo.system.status` | `/dashboard/api/system/status` | GET | backend/frontend/luna rodando?, portas, timestamp |
| `nexo.ops.overview` | `/dashboard/api/ops` | GET | alertas, operações ativas, saúde |
| `nexo.notifications.list` | `/dashboard/api/notifications` | GET | notificações (ex.: alertas de login falho) |
| `nexo.reports.history` | `/dashboard/api/reports/history` | GET | histórico de relatórios gerados |
| `nexo.schema.overview` | `/dashboard/api/schema/clients` | GET | schema do revenue engine (metadados) |
| `nexo.auth.me` | `/dashboard/api/auth/me` | GET | sessão atual (quem sou) |

## RESTRITOS — catalogados, NÃO implementados (§9 guardrails / regla de ouro §4)

Escrita, dinheiro, controle de sistema e namespace legado. Só com decreto explícito do owner.

| Endpoint | Por que restrito |
|---|---|
| `POST /dashboard/api/payments`, `POST /api/expenses`, `/api/expenses/quick` | movimenta dinheiro / escreve financeiro |
| `/dashboard/api/cash-box/reconcile`, `/api/cash-box/entries/*`, `/api/cash-box/payments/*` | reconciliação/escrita de caixa |
| `POST /dashboard/api/tasks`, `/api/tasks/$id`, `/api/notifications/read-all` | escrita |
| `POST /dashboard/api/ideas`, `/api/ideas/$id` | escrita |
| `/dashboard/api/run`, `/api/system/control`, `/api/system/logs` | executa/comanda a VPS |
| `/dashboard/api/luna/*` (command, execute-action, control, batch, undo, threads, proactive, action-center) | **namespace do luna-kernel legado: QUEBRADO na VPS** (`relation "luna_checkpoint" does not exist`, 500) + é ação |
| `/dashboard/api/email/messages/send`, `/api/email/drafts*`, `/api/email/ai/*` | envio/escrita de email + AI draft |
| `/dashboard/api/telegram/start|stop` | controla o bot do Telegram |
| `/dashboard/api/auth/change-password`, `/api/security/settings`, `/api/security/log` | segurança |
| `/dashboard/api/external/refresh`, `/api/github-repos`, `/api/vercel-projects` | integrações externas (refresh escreve) |
| `/dashboard/api/users` | dados de usuários (sensível) |
| `/admin-tools/vnc.html` | VNC — acesso total à máquina |

## Workspace do cliente (`/cliente/api/auth/*`, NextAuth)

Sessão por cookie (não Bearer): `GET /cliente/api/auth/csrf` → `POST /cliente/api/auth/callback/credentials`
→ `GET /cliente/api/auth/session` retorna `{user: {name, email, role, isNexoStaff, organizationName, organizationId}}`.
Sem endpoints de dados REST mapeados além de auth. **Tool candidata futura**: `nexo.workspace.session` (quem está logado).
Credenciais: mesma regra (env, nunca commit).

## Central de Relatórios (`/relatorios/`)

Login por form: `POST /relatorios/entrar` `{email, senha em branco p/ cliente, next}` → cookie →
`GET /relatorios/clientes/<slug>/` (HTML do relatório). Slugs verificados: `jr-reformas`.
**Tool candidata futura**: `nexo.report.fetch` (slug) → devolve o HTML/título. Uso: Luna responde
"seu relatório está em …" sem inventar link.

## Pendências de credencial / infra

1. Criar **usuário de serviço** pro Luna-agent no dashboard (hoje usa a conta do owner — funciona,
   mas o ideal é um login próprio tipo `luna` com role de leitura). Decreto do owner.
2. `/dashboard/api/luna/*` quebrado na VPS (tabela `luna_checkpoint` inexistente) — se o kernel
   antigo for reativado, o namespace vira RESTRITO de qualquer forma (ação).
3. Rate limit/auditoria: as chamadas aparecem nos logs do dashboard (notificações de sistema) —
   comportamento observado e ok.
