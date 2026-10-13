# HANDOFF — Kimi Code: Tools da Luna (kernel + agent) — 2026-10-13

Missão do owner: **todas as APIs disponíveis viram tools da Luna** — brain, solicitações
(requests), comentários, WhatsApp (privado + grupos), crontasks. O modelo tem que
**enxergar e saber usar cada uma**, sem poluir o contexto com system prompt ruim.
Testar tool por tool, modelo por modelo, e deixar configuradas só as APIs que
funcionarem.

Contexto completo do que já foi feito hoje está em `HANDOFF-luna.md` (mesma pasta).
Este arquivo é a especificação da próxima fase.

---

## 1. Mapa do terreno (verificado hoje)

### PC (`C:\Users\Abner\Documents\luna-kernel\packages\kernel\`)
- Kernel roda em pm2 (`luna-kernel`, porta **:3458**). Soul em `luna-soul.cjs`,
  tools em `luna-tools.cjs`, catálogo em `tool-catalog.cjs`, bridges em
  `bridge-factory.cjs` (RodaApiBridge com failover + contexto ao girar — já feito).
- Catálogo atual: ~50 tools locais (arquivos/diretórios/busca/web/shell/git/sistema)
  + ~40 `dashboard*` (whatsapp, email, sistema, usuários, bugs, alertas, github,
  financeiro, links, votações, timeline).
- **ATENÇÃO**: `luna-soul.cjs` tem quebras de linha MISTAS com `\r` solto — editar
  só via script node + `node --check` (padrão tmp-fix-*.cjs; heredoc quebra).
- Config de prompt: repo E `C:\Users\Abner\.luna\kernel\config\luna-prompt-config.json`
  (o runtime lê a cópia do .luna — sempre sincronizar as duas).

### VPS (`ssh vps` = nexo@100.106.140.11 via Tailscale)
- `nexo_luna_kernel` (:3458) — kernel ANTIGO do VPS (só 4 tools). Reconciliar com o PC.
- `luna_whatsapp` — shim Baileys. HTTP em `127.0.0.1:<PORTA>` com:
  - `GET /api/whatsapp/status` → `{status, phone, qr, pairingCode}`
  - `GET /api/whatsapp/qr` → página HTML com QR
  - `POST /api/whatsapp/paircode` `{phone}` → pairing code (autorizado)
  - `POST /api/whatsapp/send` `{phone|chatId, message|text}` → envia (autorizado)
  - **fallback**: qualquer outra rota vira proxy reverso pro painel `PANEL_URL`
    (default `http://127.0.0.1:3500`).
- Painel no VPS `127.0.0.1:3500` — `/api/health` ok, serve `/dashboard`.
- `nexo-brain` (:4321) — brain. `GET /api/tools` exige sessão (`/login`).
  Endpoint de learning: `POST https://vps.nexo-digital.app/brain/api/learning/outcomes`
  (Bearer `BRAIN_API_TOKEN` do `.env` do luna-agent).

### Painel Nexo (workspace-nexo, https://vps.nexo-digital.app/nexo)
**17 rotas `/api/luna/*`** — auth `X-Luna-Key` (env `LUNA_API_KEY`), rate limit
100/min, formato `{success, data|error, meta}`. Doc completo em
`workspace-nexo/LUNA_API.md` (768 linhas, copiado pra cá como `tmp-LUNA_API.md`):

| Tool (nome canônico) | Endpoint | Uso |
|---|---|---|
| `workspaceAnalyzeRequest` | POST /api/luna/analyze-request | Analisa request → needs, prioridade, complexidade |
| `workspaceCreateNeed` | POST /api/luna/create-need | Cria Need a partir de análise |
| `workspaceListNeeds` | GET /api/luna/list-needs?requestId= | Lista needs de um request |
| `workspaceListPendingActions` | GET /api/luna/list-pending-actions?requestId= | Ações pendentes do cliente |
| `workspaceCompleteAction` | POST /api/luna/complete-action | Marca ação como completa |
| `workspaceCreateRequest` | POST /api/luna/create-request | Nova solicitação (entry point) |
| `workspaceGetRequest` | GET /api/luna/get-request?id= | Request completo (comments, timeline, actions, approvals) |
| `workspaceListRequests` | GET /api/luna/list-requests?organizationId&projectId&status | Lista com summary |
| `workspaceCreateComment` | POST /api/luna/create-comment | Comentário INTERNO (nunca visível ao cliente) |
| `workspaceListEvents` | GET /api/luna/list-events?requestId&fromDate&toDate&type&limit | Timeline de eventos |
| `workspaceSummarizeTimeline` | GET /api/luna/summarize-timeline?requestId&style&focus | Resumo inteligente da timeline |
| `workspaceNotifyClient` | POST /api/luna/notify-client | Notifica cliente (evento + delivery) |
| `workspaceRequestApproval` | POST /api/luna/request-approval | Pedido formal de aprovação |
| `workspaceApproveRequest` | POST /api/luna/approve-request | Cliente aprova → CLOSED |
| `workspaceRejectRequest` | POST /api/luna/reject-request | Cliente rejeita → volta p/ desenvolvimento |
| (infra) | GET /api/luna/security/check-ip · /trusted-ips | Segurança |

Regras de domínio (respeitar nas descrições das tools): Luna **nunca** tem autoridade
operacional (prepara, o time decide); **nunca** publica comentário visível ao cliente;
needs nunca são expostas ao cliente; toda ação gera Event.

**Rotas admin relevantes** (mesmo app, ~60 em `/api/admin/*`): clients, clients/[id],
projects, organizations, requests/[id]/comments, requests/[id]/events,
requests/[id]/actions(/complete), needs/[id](/approve|reject), users, stats,
ai-conversations. Úteis pra tools de leitura de clientes/projetos (ver §3).

### Painel workspace-cliente (https://vps.nexo-digital.app/cliente)
~60 rotas: `/api/chat/*` (mensagens, rooms, stream, escalações), `/api/ai-tools/*`
(analyze-request, complete-action, list-needs, list-pending-actions),
`/api/proxy/{clientes,financeiro,leads,tarefas}`, `/api/requests/*`, `/api/credits/*`,
`/api/notifications/*`.

### Painel local PC (:3101)
- `POST :3101/api/mensagem` `{chat_id, body, sender:"luna"}` — fila WhatsApp local
  via pg_notify (testada 200). `dashboardSendWhatsApp` tenta aqui primeiro e cai
  pro VPS (`/whatsapp/send`) se falhar.

---

## 2. Regra de nomenclatura dual (pedido explícito do owner)

Modelos diferentes tentam nomes diferentes de tool. Auditoria pedida: **verificar
qual chamada cada modelo tenta dar** nos logs (`pm2 logs luna-kernel`) e garantir
que TODAS as variações batam.

Hoje o soul já tem meta-tools `listTools`/`toolInfo` + fuzzy match com aliases
(clientes/contatos/pessoas/leads). Estender o normalizador do soul
(`_handleAction` em `luna-soul.cjs`) pra também aceitar as variações que modelos
OpenAI/Anthropic costumam emitir:

- Descoberta: `listTools`, `list_tools`, `tools/list`, `tools_list`, `getTools`,
  `get_tools`, `listarTools`, `available_tools` → **meta-tool `listTools`**.
- Info: `toolInfo`, `tool_info`, `getToolInfo`, `get_tool_info`, `describeTool`,
  `toolInfo_get` → **meta-tool `toolInfo`**.
- Se um modelo inventar nome fora do catálogo (ex.: `search_web`, `webSearch`,
  `read_file`, `write_file` snake_case): mapear snake_case→camelCase e tentar de
  novo ANTES de devolver erro. Erro de tool desconhecida deve terminar com
  "use listTools para ver as disponíveis" (já existe — manter).

Critério de aceite: rodar o E2E (§6) com 3+ modelos e nenhum pode travar em
"tool desconhecida" ao tentar descoberta.

---

## 3. Novas tools a implementar (todas via luna-tools.cjs + tool-catalog.cjs)

Padrão obrigatório de resultado (sem poluir): devolver **1 linha por item, com
campos-chave, truncado em ~300 chars/item e ~2000 chars total**; erro sempre
`status=erro + motivo + sugestão`. Seguir o formato `[tool] status=ok|erro` que o
soul já monta — a tool retorna só o payload enxuto.

### 3.1 Solicitações / comentários / needs (API `/api/luna/*` do painel)
Implementar as 15 tools canônicas da tabela do §1, prefixo `workspace`, num novo
módulo `packages/kernel/tools-workspace.cjs` (require lazy no luna-tools.cjs, igual
aos padrões atuais). Cliente HTTP: fetch nativo, base URL em env
`NEXO_WORKSPACE_URL` (default `https://vps.nexo-digital.app/nexo`), header
`X-Luna-Key` de env `LUNA_API_KEY`. Descrições das tools devem conter: quando usar,
1 exemplo de params, e a regra de domínio relevante (comentário só internal, etc.).

### 3.2 Brain (clientes, projetos, organizações)
Tools de leitura contra o painel (fonte de verdade de clientes):
- `brainListClients` / `brainGetClient` → `/api/admin/clients` (+ `?id=`)
- `brainListProjects` / `brainGetProject` → `/api/admin/projects`
- `brainListOrganizations` → `/api/admin/organizations`
- `brainGetStats` → `/api/admin/stats`
Auth: mesma sessão/admin do painel — descobrir o token usado pelo painel local
(:3500 / :3101) e reutilizar; se for cookie de sessão, documentar no código.
Se o brain :4321 tiver endpoints melhores autenticados por `BRAIN_API_TOKEN`,
preferir o brain.

### 3.3 WhatsApp — privado E grupos (estender o shim)
Hoje o shim só envia privado (`sendMessage <phone>@s.whatsapp.net`). Estender
`luna_whatsapp` (repo em `~/Documentos/VPS/VPS/luna-kernel` no VPS? confirmar onde
está o source do container — o container monta o código do shim; ver compose):
- `GET /api/whatsapp/chats` → lista chats recentes (uso `sock.chats` / store).
- `GET /api/whatsapp/chats/:jid/messages?limit=` → últimas N mensagens.
- `GET /api/whatsapp/groups` → lista grupos (`sock.groupFetchAllParticipating`).
- `POST /api/whatsapp/send` aceitar `jid` direto (grupo = `<gphone>@g.us`) além de
  `phone`/`chatId`.
Tools kernel correspondentes (juntar com as `dashboard*` existentes):
`whatsappListChats`, `whatsappGetMessages`, `whatsappListGroups`, `whatsappSendMessage`
(esta unifica: aceita phone, chatId ou jid; resolve privado vs grupo sozinha).

### 3.4 Crontasks
- Kernel: `cronList`, `cronCreate {name, schedule, prompt}`, `cronDelete {name}`,
  `cronRun {name}` — persistir em JSON em `~/.luna/kernel/config/crontasks.json`;
  o kernel tem heartbeat/loop — nele, a cada minuto, disparar os due (executa o
  `prompt` como mensagem de sessão interna `cron:<name>`).
- Se o luna-agent já tiver tabela `jobs` (tem — ver AGENTS.md), avaliar usar o
  `enqueueJob` em vez de JSON; escolher 1 e documentar.

### 3.5 Atualizar catálogo
Cada tool nova entra em `tool-catalog.cjs` com: `cat` (emoji + nome), `desc`
(curta + quando usar), `params`, `ex` (exemplo real com valores plausíveis).
O `{{TOOL_INDEX}}` do system prompt é gerado dele — 1 linha/tool.

---

## 4. System prompt / looping (já feito — manter e estender)

- System prompt (~10,4KB) montado em `buildSystemPrompt`: config + `{{TOOL_INDEX}}`
  + master prompt (`LUNA_MASTER_PROMPT.md` v7.3). Regras-chave já presentes:
  ação imediata (proibido só confirmar), meta-tools, erro nunca é sucesso, blocos
  irmãos, circuit breaker, feedback de tool enxuto.
- Ao adicionar as tools novas, NÃO inflar o master prompt — a descoberta é via
  `listTools`/`toolInfo` + TOOL_INDEX de 1 linha. Se o índice passar de ~6KB,
  considerar 2 níveis: índice resumido no system + detalhe só no `toolInfo`.

---

## 5. Divergências PC ↔ VPS pra reconciliar

1. **Kernel**: PC tem ~90 tools catalogadas; VPS (`nexo_luna_kernel`) tem 4.
   Definir fluxo: PC é fonte de verdade do código → sync pro VPS (git push +
   pull no repo `~/Documentos/VPS/VPS/luna-kernel` + rebuild/restart do container
   ou volume montado). Confirmar como o container é montado (compose) antes.
2. **providers.json**: contrato único em `luna-agent/config/providers.json`
   (`enabled && transport==='openai'` entram na roda). Roda atual:
   gemini(p1) → open-webui(p2) → kimi-coding(p4) → pollinations(p5) →
   nvidia-nim(p7) → luna-kernel(p98) → colibri(p99).
3. **Prompt config**: manter repo e `.luna` sincronizados (ver HANDOFF-luna.md §2).

---

## 6. Testes E2E — aceite (pedido do owner: tool por tool, modelo por modelo)

Script base já existe: `node e2e-luna-web.mjs "<mensagem>" [timeout]` (login real
abner/7741 → :3458/api/chat → polling 6s → loga action_start/action_end + resposta).

Plano de teste, **uma categoria por sessão de chat**:
1. "manda um oi pro Abner no whatsapp" → espera `whatsappSendMessage` ok.
2. "lista minhas solicitações abertas" → `workspaceListRequests` ok.
3. "cria uma solicitação de teste dizendo X no projeto Y" → `workspaceCreateRequest`.
4. "comenta internamente na solicitação Z: ..." → `workspaceCreateComment`.
5. "quais ações pendentes o cliente tem na solicitação Z?" → `workspaceListPendingActions`.
6. "resume a timeline da solicitação Z" → `workspaceSummarizeTimeline`.
7. "lista os grupos do whatsapp" / "lê as últimas mensagens do grupo W" → tools de grupo.
8. "lista os clientes" → `brainListClients`.
9. "cria um crontask de teste" → `cronCreate` + `cronList`.

**Scorecard por modelo** (rodar cada sessão contra cada provider e anotar):
modelo → quais tools chamou corretamente, onde errou, se tentou nome errado
(= entrada pra regra de nomenclatura dual). Providers com conta/key: gemini,
open-webui, kimi-coding, pollinations, nvidia-nim, colibri, luna-kernel, FCC
(:8082, Anthropic-style, rota brain). Keys pendentes do Abner: groq, xai,
openrouter, cerebras, zai, mistral, sambanova, together, HF_TOKEN, ovh, glhf,
hetzner (cadastrar no :3101/config e rodar `node scorecard-providers.cjs`).

Definition of done: ≥1 modelo externo completa as 9 sessões sem "tool
desconhecida" e sem loop; scorecard salvo; providers que falharem com erro
configurável ficam `enabled:false` com `disabledReason`.

---

## 7. Fluxo de deploy validado hoje

1. Editar no repo do kernel (`C:\Users\Abner\Documents\luna-kernel`) via script node
   (nunca heredoc no soul) + `node --check`.
2. Sincronizar `config/luna-prompt-config.json` → `C:\Users\Abner\.luna\kernel\config\`.
3. `pm2 restart luna-kernel` → checar `pm2 logs luna-kernel`.
4. E2E com `e2e-luna-web.mjs` antes de commitar.
5. Commits curtos em PT, só arquivos relacionados (apagar tmp-*.cjs antes).
6. Subir tudo no PC: `luna` no cmd (luna.bat: docker + pm2 start ecosystem).
7. VPS: sync seletivo via git/ssh — nunca sobrescrever repo do VPS inteiro
   (build context dele é fonte própria; ver skill vps-tailscale).

## 8. Pendências externas (não são código)

- Basic auth em `/luna` (Caddy no VPS) — aguardando senha sudo do nexo.
- 12 API keys novas — dependem do Abner criar contas.
- Docker Desktop do PC pode travar após reboot (WSL) — se :5433/:3000 caírem,
  subir manual antes de testar.
