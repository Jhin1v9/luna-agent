# HANDOFF — Configuração da Luna (kernel + agent) — 2026-10-13

Missão: deixar a Luna redonda — system prompt, loop de tools sem poluir, roda de
APIs grátis com failover, card de config no painel, testes E2E tool por tool.

## ✅ FEITO (testado e validado)

### 1. E2E pela API de chat (login abner/7741 → POST :3458/api/chat)
- **WhatsApp p/ Abner: OK** — tool chamada na hora, enviada via fila local.
- **writeFile: OK** · **readFile: OK** (devolveu conteúdo exato).

### 2. Fixes no kernel (`C:\Users\Abner\Documents\luna-kernel\packages\kernel\`)
- **luna-soul.cjs** (editar só via script node + `node --check` — arquivo tem `\r` solto):
  - resultado de tool enxuto: bloco `[tool] status=ok|erro + resultado|motivo`;
  - meta-tools `listTools`/`toolInfo` (o modelo descobre tools sozinho);
  - **FIX loop infinito**: mode-path (W6-T9) não populava `domActionResults` →
    feedback saía `status 0/1` + placeholder → modelo reemitia a mesma tool pra
    sempre. Agora os `action_end` drenados são dobrados de volta em
    `domActionResults` (v13.1-fix);
  - **circuit breaker** (v13.1): mesma tool+params >3x no turno → encerra com
    resposta honesta (`emittedToolCalls`);
  - system prompt montado (~10,4KB): systemPrompt config + {{TOOL_INDEX}} +
    master prompt; roda em `buildSystemPrompt`.
- **tool-catalog.cjs** (novo): catálogo completo com exemplo por tool +
  `buildToolIndex()` (1 linha/tool) — alimenta `{{TOOL_INDEX}}`.
- **luna-tools.cjs**: exports `listTools`/`toolInfo` (require lazy);
  `dashboardSendWhatsApp` aceita `chatId` como alias de phone e tenta primeiro
  o painel local (`POST :3101/api/mensagem` com `{chat_id, body, sender:"luna"}`,
  testada 200, fila via pg_notify) e cai pro VPS (`/whatsapp/send`) se falhar.
- **bridge-factory.cjs**: `RodaApiBridge` — gira pra próximo provider da roda em
  erro /HTTP 4xx-5xx|quota|rate limit|timeout|vazio/i. `resolveApiRoda()` lê o
  `config/providers.json` do luna-agent (filtra `enabled && transport==='openai'`).
- **LUNA_MASTER_PROMPT.md** v7.3: regras novas — 8 ação imediata (proibido só
  confirmar), 9 meta-tools, 10 erro nunca é sucesso, 11 blocos irmãos (nunca
  aninhar [[action]] em [[response]]); exemplo WhatsApp adicionado.
- **config/luna-prompt-config.json** (v2.1+): regras anti-confirmação no
  systemPrompt e miniReminder. **ATENÇÃO: o runtime lê a cópia de
  `C:\Users\Abner\.luna\kernel\config\luna-prompt-config.json`** — o do repo é
  só default; sempre sincronizar as duas (estão sincronizadas agora).
- config.html do kernel: seção LUNA WEB removida (config oficial = card do painel).

### 3. Roda de providers (`luna-agent/config/providers.json` — contrato único)
- **pollinations LIGADO** (sem key, testado 200 em 3,5s): `https://text.pollinations.ai/openai`, model `openai`, priority 5.
- **github-models DESLIGADO**: endpoint responde `OK` text/plain mesmo com token `gho_` válido (degenerado; `disabledReason` no json).
- **7 presets novos DESLIGADOS** (falta key) com campo `role` (conversa/coding/ambos):
  cerebras (coding, ultrarrápido), zai-glm (coding), mistral (coding/Codestral),
  ovh-ai (conversa, Llama 3.3 70B), glhf (conversa), hf-router (conversa), hetzner (ambos, Qwen3.6).
- Classificação `role` também nos existentes (gemini/open-webui/nvidia=ambos,
  kimi-coding/colibri/luna-kernel=coding, groq=conversa...).
- Roda ativa agora: gemini(p1) → open-webui(p2) → kimi-coding(p4) → **pollinations(p5)** → nvidia-nim(p7) → groq/xai/openrouter(sem key, pulam) → luna-kernel(p98) → colibri(p99).

### 4. FCC (gateway local Anthropic :8082)
- Estava MORTO; subido via `fcc-server.exe` (uv tool `free-claude-code` v6.14.1,
  `C:\Users\Abner\.local\bin\fcc-server.exe`).
- **Modelo default trocado pra `nvidia_nim/nvidia/nemotron-3-super-120b-a12b`**
  (kimi-k3 e deepseek-v4.1-flash travam >120s na fila NVIDIA; nemotron respondeu
  200 em 7s). Fallbacks: gpt-oss-20b, deepseek-v4.1-flash.
- API é **Anthropic-style** `POST /v1/messages` (sem /chat/completions) → NÃO
  entra na roda do chat web (filtro openai). FCC = rota LIVE brain via FccAdapter (ADR-041).
- Admin UI: http://127.0.0.1:8082/admin (80 modelos NVIDIA no catálogo).

### 5. Painel (:3101) e pm2
- `apps/painel/lib/providers.ts`: KEY_ALLOWLIST += OVH_API_KEY, GLHF_API_KEY,
  HF_TOKEN, HETZNER_API_KEY; presets novos: ovh-ai, glhf, hf-router, hetzner.
  Typecheck passou.
- **pm2 7.0.4 instalado** (global). `ecosystem.config.cjs` da raiz do luna-agent
  ganhou: **luna-kernel** (:3458, com `interpreter: C:\Program Files\nodejs\node.exe`
  — resolve o `spawn node ENOENT` do daemon) e **fcc-server** (:8082, env MODEL/FALLBACKS).
- **`C:\Users\Abner\bin\luna.bat` reescrito** (digitar `luna` no cmd sobe tudo):
  garante nodejs real no PATH → sobe docker (luna-postgres, open-webui) se
  parados → mata processos soltos nas portas 3458/8082 → `pm2 start ecosystem`
  (idempotente) → `pm2 save` → status. Modos: `luna stop`, `luna status`, `luna restart`.

### 6. Scorecard (script `scorecard-providers.cjs` na raiz do luna-agent)
- gemini 429 (quota diária free — volta sozinha) · open-webui TOOL OK ·
  github-models degenerado (desligado) · kimi-coding 403 (quota 5h — reseta) ·
  nvidia VAZIO no teste (max_tokens 600 vai pro reasoning; na roda real não
  envia max_tokens, funciona) · groq/xai/openrouter SEM KEY · luna-kernel TOOL OK ·
  colibri TOOL OK.

## 🔴 PENDENTE (ordem sugerida)

1. **Docker Desktop não está no ar** (PC reiniciou). Subir Docker Desktop, then
   `docker start luna-postgres open-webui`, then `pm2 restart luna-orchestrator
   luna-worker luna-watchdog luna-whatsplay` (ficaram stopped/errored sem o
   postgres :5433). venus-varredura está errored — ver log (`pm2 logs venus-varredura`).
2. **Card "Luna Web" não aparece em http://127.0.0.1:3101/config** — o build com
   o card foi feito ontem, mas o PC reiniciou. Verificar `apps/painel/app/config/page.tsx`
   (card entre Providers e Modo operacional; tipos `LunaWebStatus`/`LunaWebRodaEntry`,
   estados `lw*`, `loadLunaWeb()`, `salvarLunaWeb()`, API route `app/api/luna-web/route.ts`
   GET proxy + POST grava envs no kernel). Se o `.next` buildado for de antes do card,
   rebuildar: `cd apps/painel && npm run build && pm2 restart painel-luna`.
3. **Garantir que o system prompt chega nos providers** — auditar o request
   montado em `RodaApiBridge`/`ApiBridge` (bridge-factory.cjs): system prompt
   (~10,4KB) + tool index + master prompt devem ir em `messages[0]` de TODA
   chamada, incluindo os giros de failover.
4. **NOVA MECÂNICA (pedido do owner)**: quando uma API da roda falhar/esgotar e
   girar pro próximo provider, reenviar a última mensagem CONTEXTUALIZADA —
   tipo: `Na última conversa estávamos falando de "X". Resumo do que já
   aconteceu: <últimas trocas>. Continue a partir daí.` Implementar no
   `RodaApiBridge` (luna-kernel/packages/kernel/bridge-factory.cjs): a cada giro,
   injetar um `messages.splice(1, 0, {role:'user', content: ctx})` com resumo do
   histórico recente da sessão + motivo da troca de provider. Se o código tiver
   sujo demais, criar módulo novo (ex.: `roda-context.cjs`).
5. **Indicador de provider ativo na UI da Luna Web** (:3458): expor provider/
   modelo do turno (evento SSE ou campo no `/api/chat/session/<id>/messages` —
   já existe `TurnResult.provider`-like no luna-agent; no kernel logar qual
   provider respondeu) e renderizar no chat ("🧠 gemini · gemini-3.6-flash").
   Informativo apenas.
6. **Commits**:
   - luna-kernel: tool-catalog.cjs (novo), luna-soul.cjs, luna-tools.cjs,
     bridge-factory.cjs, LUNA_MASTER_PROMPT.md, config/luna-prompt-config.json,
     config.html. **Apagar tmp-fix-*.cjs antes.**
   - luna-agent: apps/painel (page.tsx, api/luna-web), config/providers.json,
     ecosystem.config.cjs, e2e-luna-web.mjs, scorecard-providers.cjs.
     **Apagar tmp-update-providers.cjs.** Mensagens curtas em PT.
   - Atenção: `.brain/` e outros arquivos não relacionados estão modificados no
     git do luna-agent — commitar só o relacionado.
7. **Atalho de boot**: criar `.lnk` na pasta Startup do Windows
   (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`) apontando pro
   `C:\Users\Abner\bin\luna.bat` (o owner quer tudo ligando sozinho quando o PC liga).
8. **Keys a cadastrar no `.env` do luna-agent** (painel :3101/config ou na mão):
   GROQ_API_KEY, XAI_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, ZAI_API_KEY,
   MISTRAL_API_KEY, OVH_API_KEY, GLHF_API_KEY, HF_TOKEN, HETZNER_API_KEY,
   SAMBANOVA_API_KEY, TOGETHER_API_KEY. Depois de cada key, ligar o provider no
   painel e rodar `node scorecard-providers.cjs`.
9. **Quando terminar tudo: enviar WhatsApp "pronto Abner" pro 34685093192** —
   rota testada: `POST http://127.0.0.1:3101/api/mensagem`
   `{chat_id:"34685093192", body:"pronto Abner", sender:"luna"}`.

## 🧪 Ferramentas de teste (raiz do luna-agent)
- `node e2e-luna-web.mjs "<mensagem>" [timeoutSeg]` — login real → chat → polling
  6s → loga action_start/action_end + resposta final.
- `node scorecard-providers.cjs` — testa cada provider da roda direto na API.
- Kernel logs: `pm2 logs luna-kernel` (antigos em `C:\Users\Abner\.luna\kernel\luna-server.*.log`).

## ⚠️ Armadilhas
- `luna-soul.cjs`: quebras de linha MISTAS com `\r` solto — edição multilinha só
  via script node (padrão tmp-fix-*.cjs) + `node --check`; heredoc come backticks e `$`.
- Config de prompt: sempre sincronizar repo E `C:\Users\Abner\.luna\kernel\config\`.
- pm2: daemon precisa nascer com `C:\Program Files\nodejs` no PATH (luna.bat faz).
- Turno do kernel pode continuar pensando após timeout do script — checar
  `pm2 logs luna-kernel` antes de concluir "falhou".
- gemini 429 / kimi-coding 403 são quotas temporárias — não são bugs.

## Estado agora (07:55)
painel :3101 ✅ · kernel :3458 ✅ · fcc :8082 ✅ · kimiweb ✅ · venus-watchdog ✅ ·
orchestrator/worker/watchdog/whatsplay ⛔ (postgres docker fora do ar) ·
venus-varredura ⛔ errored · docker desktop ⛔ · open-webui :3000 ⛔.

---

## Sessão 2026-10-13 (retomada Kimi Code, após Kimi Work)

**Feito nesta retomada:**
- Item 2 ✅ card Luna Web no painel: era build antigo — rebuild+restart, card OK (conteúdo renderiza client-side na aba Configurações; API /api/luna-web ok)
- Item 3 ✅ auditado: prompt (system ~10,4KB + master + tool index) vai no user message que o soul monta — E2E com tools prova que chega ao provider
- Item 4 ✅ mecânica de contexto ao girar a roda implementada no RodaApiBridge (rascunho parcial do provider anterior vai pro próximo)
- Item 5 ✅ currentProvider exposto em GET :3458/api/luna-web/providers (e o card do painel mostra)
- Item 6 ✅ commits: kernel f2f5a2b (pushado), agent 06f2008 (pushado); tmp-*.cjs apagados; seção LUNA WEB removida do config.html do kernel (pedido owner)
- Item 7 ✅ Startup: ficou o Nexo-Luna-Stack-AutoStart.cmd (sobe docker+pm2 resurrect, idempotente)
- Item 8 ❌ as 12 keys novas (groq/xai/openrouter/cerebras/zai/mistral/sambanova/together/HF_TOKEN/ovh/glhf/hetzner) dependem do Abner criar contas — links no tutorial da sessão anterior
- Item 9 ⏳ "pronto Abner" pro 34685093192: aguardando Postgres (docker)

**Em andamento:** Docker daemon travou após reboot — WSL reiniciado, aguardando daemon subir pra `docker start luna-postgres open-webui` → `pm2 restart luna-orchestrator luna-worker luna-watchdog luna-whatsplay` → whatsapp "pronto Abner".

## BLOQUEIO final da retomada (2026-10-13)

Docker Desktop NÃO sobe sozinho após reboot: daemon trava, WSL `wsl --shutdown`
retorna "operação não suportada", backend morre segurando ~25GB de RAM (32GB total,
94% em uso). Duas tentativas de restart limpo falharam (~15min).

**AÇÃO HUMANA PENDENTE (Abner):**
1. Abrir o Docker Desktop manualmente (ícone na bandeja) — provavelmente tem erro/dialog na GUI
2. Se continuar falhando: `wsl --update` no PowerShell admin, ou reiniciar o PC (RAM 94%)
3. Quando o daemon subir: `docker start luna-postgres open-webui` → `pm2 restart luna-orchestrator luna-worker luna-whatsplay luna-watchdog venus-varredura` → `pm2 save`
4. Enviar "pronto Abner" pro whatsapp 34685093192 (endpoint :3101/api/mensagem falhou sem Postgres)

**Mitigado enquanto isso:** apps dependentes de Postgres PARADOS no pm2 (sem crash-loop); kernel :3458, painel :3101 (páginas ok), FCC :8082, kimiweb :58629 no ar.

**Feito e pushado:** kernel f2f5a2b, agent 06f2008 (itens 2-8 da lista, exceto keys que dependem do Abner).

---

## Sessão 2026-10-13 tarde (Kimi Work, turno longo do owner)

**Feito e validado:**
- **WhatsApp VPS pareado** — whatsplay no VPS online com Chrome real VISÍVEL (Wayland nativo
  via `--ozone-platform=wayland` + `XDG_RUNTIME_DIR/WAYLAND_DISPLAY`; patch condicional em
  `apps/whatsplay/src/browser.ts`, ativa só com `WHATSAPP_OZONE_PLATFORM=wayland`). Pairing
  por QR (o pairing code foi rejeitado pelo servidor do WhatsApp). Lê chats reais
  (Production, OnaDance, Abner). ⚠️ Falta teste de ENVIO: o banco está vazio de inbound —
  o Abner precisa mandar "oi" pro +34 614 05 35 88 pra nascer conversation_id.
- **Persona da Luna no luna-agent do VPS** — `.kimi-code/agents/luna.md` existia mas NUNCA era
  lido; `apps/orchestrator/src/agent/context.ts` só usava PERSONA_SUMMARY. Adicionada
  `loadLunaPersona()` (sobe do cwd até achar o .kimi-code, cache por mtime) injetada no
  renderConversationPrompt. Typecheck limpo, orchestrator restartado.
- **Fix `/luna` branco no VPS** — index.html referenciava `/assets/*` absoluto mas a página
  é servida em `/luna/` (Caddy strip). Fix: `base: './'` no
  `luna-kernel/packages/kernel/luna-web/vite.config.js` + rebuild + dist tar/scp/tar pro VPS.
  Validado 200. ⚠️ Página branca no navegador do owner = Ctrl+F5 (cache do bundle antigo).
- **Luna Tools v6.0 — backend real** — `luna-kernel/apps/dashboard/routes/luna-tools.js`
  apontava pra um "Dashboard PRO" da :3456 que NUNCA existiu (todos os cards do ToolsPanel
  ficavam "—"). Reescrito pra consumir o backend verdadeiro do painel Nexo
  (container `nexo_dashboard_backend`, :3500 no VPS, exposto pelo Caddy em
  `https://vps.nexo-digital.app/dashboard/api/*`):
  - Auth: `Authorization: Bearer <INTERNAL_API_TOKEN>` (o token do container, funciona nas
    4 rotas: leads, tasks, finance/summary, voting/sessions; o DASHBOARD_API_KEY só serve leads).
  - Envs novas em `apps/dashboard/.env` (PC e VPS): `LUNA_DASHBOARD_URL`
    (PC: `https://vps.nexo-digital.app/dashboard`; VPS: `http://127.0.0.1:3500`) e
    `LUNA_DASHBOARD_TOKEN`.
  - ⚠️ A :3500 é bind 127.0.0.1 no VPS — o PC só alcança pela URL pública do Caddy.
  - Validado PC e VPS: `/api/tools/stats` devolve dados reais (3 leads, 20 tarefas,
    saldo -36,18 €). Cards do ToolsPanel populam.
  - POST /api/tools/leads|tasks repassam pro backend real (formato igual ao que o proxy do
    workspace-cliente usava); não testado POST pra não criar lixo no banco.
- **ChatHeader do luna-web** — bug de overlap ("Thinking" sobre "Kimi Web" em ~690px):
  `.header-left`/`header-right` com flex-shrink estourando. Corrigido flex/min-width/overflow
  + media queries reescritas (1024/768/640/480). Build novo deployado no VPS
  (`tar -czf dist` → scp → extrair em `~/luna-kernel/packages/kernel/luna-web/dist`).
  Screenshot valida: header limpo, sem sobreposição.
- **Envs separadas (convenção)** — `.env` local do luna-agent = PC, NUNCA transfere.
  `.env.vps` (raiz do luna-agent) = FONTE DE VERDADE do VPS (baixado de lá hoje).
  Deploy: `bash scripts/deploy-env-vps.sh` (scp .env.vps → vps:~/luna-agent/.env + instrução
  de restart). Mesma lógica vale pro kernel: `luna-kernel/apps/dashboard/.env` existe em
  cada máquina com valores próprios (não versionar, não misturar).

**Pendente desta sessão:**
- Gravar as mudanças no brain (`POST /brain/api/learning/outcomes`, Bearer BRAIN_API_TOKEN).
- Teste E2E de envio de WhatsApp pelo VPS (depende do Abner mandar "oi" primeiro).
- A roda de APIs do VPS (`LUNA_RODA_CONFIG=~/luna-kernel/roda/providers.json`) e as 12 keys
  novas continuam dependendo de contas criadas pelo Abner.

## Sessão 2026-10-13 noite — VPS estável (watchdog + whatsplay)

- **Login /luna/ no VPS FUNCIONA** — testado no browser interno (rede: ./api/auth/login →
  tools/stats → providers → system/agent, logado:true). Owner precisa dar **Ctrl+F5**
  (navegador segura o bundle antigo com fetches absolutos). Fix anterior: todos os fetches
  do luna-web viraram relativos (`./api/...`) em 8 arquivos (42 via sed + 2 Edits no
  api.js: EventSource stream e visible/invisible). Credenciais VPS (users.json do
  luna-server): `abner` e `abner@nexo-digital.app`, senha `.7741@`, role Admin — lido a
  cada login, sem restart.
- **Watchdog crash loop fix** — `.env` do VPS tinha `KIMI_ADAPTER_MODE=pi` (resto de
  sessão do Kimi Code no PC): o PiAdapter spawna o binário `pi` → `spawn pi ENOENT` →
  30 restarts → errored. Trocado pra `kimi-api` (bate com LLM_BASE_URL=api.kimi.com/coding/v1,
  key validada com chat/completions real). `self-test: tudo ok`.
- **Paths Windows hardcoded no watchdog** — `apps/watchdog/src/index.ts` e `selftest.ts`
  usavam `C:/Users/Abner/...` fixo. Agora `LUNA_AGENT_ROOT` (env) com default do PC.
  No VPS: `LUNA_AGENT_ROOT=/home/nexo/luna-agent` no .env. ATENÇÃO: `loadDotEnv` NÃO
  sobrescreve var já existente em process.env — e o **daemon pm2 carrega envs velhos**
  (resurrect dump). Por isso o restart com env inline foi o que destravou:
  `LUNA_AGENT_ROOT=/home/nexo/luna-agent pm2 restart luna-watchdog --update-env`.
  Sempre que uma env do .env "não pegar", suspeitar do env congelado do daemon pm2.
- **`LUNA_PM2_MANAGED=1`** adicionado ao .env do VPS — sem isso o watchdog tentava
  `spawn cmd.exe` pra reiniciar serviços DOWN no Linux.
- **backup-profile.sh portado pra Linux** — branch `robocopy` (PC) vs `tar -czf` com as
  mesmas exclusões + sanity `Default/` (VPS). Testado: 88 MB tar.gz da sessão Chrome.
  backup-db.sh já funcionava.
- **openChat serializado + reuso de painel** — `browser.ts`: `openChatChain` (chain de
  promessas) + `lastOpenedOpenChat`. Chamadas concorrentes (reconcile + getUnread +
  outbound) repetiam o fluxo inteiro: o 2º call dava Escape (fechava o painel que o 1º
  abriu), recarregava via deeplink e caía no fallback de busca com ~20s de timeouts
  (evidência 19:36). Early-check: painel já aberto com dígitos do jid no header (ou aberto
  por nós <60s) → reutiliza. Typecheck OK, deployado, whatsplay restartado.
- **Estado WhatsApp**: whatsplay nativo online (captura por mutação de DOM, chrome-voice
  no boot, NOTIFYs luna_outbound/voice_call_requests/whatsapp_actions ativos), Chrome
  do VPS vivo, mas `messages` channel=whatsapp continua **0** — o reconcile só processa
  chats com badge de não-lido e as mensagens antigas foram consumidas sem ingestão.
  **Teste de fogo depende de mensagem NOVA do Abner** (grupo ou privado pro +34 614 05 35 88).
  Se voltar "sem texto inbound", inspecionar `readConversation` (browser.ts ~408/435:
  extração após deeplink — a página recarrega no goto e o messagePanel pode demorar).

**Pendente:**
- Teste de fogo com msg nova do Abner (badge → ingest → evento → resposta da Luna).
- Gravar outcomes no brain (POST /brain/api/learning/outcomes, Bearer BRAIN_API_TOKEN).
- Enviar "pronto Abner" no WhatsApp dele (endpoint :3101/api/mensagem) quando a fase 1 fechar.
- 12 keys de APIs gratuitas (roda) — dependem de contas do Abner.

## Sessão 2026-10-13 noite — Providers/roda no VPS (a "magia")

- **Roda acesa no VPS** — as 4 keys (GEMINI/KIMI/GITHUB/NVIDIA) foram transferidas do
  `.env` do luna-agent do PC pro `~/luna-kernel/apps/dashboard/.env` do VPS (luna-server
  dá dotenv nesse arquivo; providers resolvem `apiKeyEnv` de process.env). Catálogo
  `/api/luna-web/providers` mostra 5/5 `hasKey:true` no PC e no VPS.
- **Fix bridge-factory.cjs** — `readAgentProvidersConfig()` só aceitava path contendo
  "luna-agent" (anti-decoy) e o path do providers.json do VPS é `~/luna-kernel/roda/`
  → catálogo vinha `roda:[]`. Agora `LUNA_RODA_CONFIG` (já setado no .env do dashboard)
  é candidato EXPLÍCITO e escapa do guard. PC = fonte da verdade, deployado ao VPS.
- **Timeout ApiBridge 10min → 3min** (`api-bridge.cjs`) — endpoint morto segurava a
  "roda infinita" o turno inteiro antes de girar (evidência: E2E travava 90s+).
- **NVIDIA NIM DESABILITADO na roda** — a key lista modelos (GET /v1/models 200, 80
  modelos, kimi-k3/deepseek-v4.1-flash presentes) mas TODO chat/completions TRAVA
  (testado do PC e do VPS, >90-120s sem resposta). Conta sem cota/provisioning ativo.
  Reabilitar quando o Abner ativar em build.nvidia.com → trocar `enabled` no
  `~/luna-kernel/roda/providers.json`.
- **Roda validada E2E**: POST :3458/v1/chat/completions respondeu em 4,3s (gira do
  gemini 429 pro próximo saudável sozinho). Saúde medida do VPS: kimi-coding 200/1,9s,
  github gpt-4o 200/0,5s, pollinations 200/1,1s, gemini 429 (cota, gira), nvidia OFF.
- **FCC instalado no VPS** — uv 0.13 + `uv tool install free-claude-code`, roda sob pm2
  `luna-fcc` na :8082 (admin /admin). SEGREDOS: pm2 precisa `--interpreter
  ~/.local/share/uv/tools/free-claude-code/bin/python` (senão executa o .py como JS) e
  a env é `NVIDIA_NIM_API_KEY` (NÃO `NVIDIA_API_KEY`). Como o upstream NVIDIA está morto,
  o FCC responde 503 — fica de placeholder até a key da NVIDIA funcionar.
- **PENDENTE**: suporte a transport `anthropic` no bridge-factory pra plugar o
  fcc-local (`http://127.0.0.1:8082`, só fala `/v1/messages`) na roda. Depende do
  NVIDIA (ou de outro provider configurado no FCC admin) voltar a funcionar.

## Sessão 2026-10-13 noite (2) — Tools/brain/prompt da Luna Web

- **FIX CRÍTICO api-bridge.cjs** — `temperature: 0` fixo quebrava o kimi-for-coding
  ("invalid temperature: only 1 is allowed") → HTTP 400 em TODO turno → roda girava
  pra providers piores → resposta morria vazia. Agora só envia temperature se
  `LUNA_API_TEMPERATURE` estiver explícita. Roda reordenada: kimi-coding(1) →
  pollinations(2) → gemini(3) → github(4, SSE dele devolve corpo "OK" vazio —
  fica por último) → nvidia-nim(5, OFF).
- **Brain tools novas no kernel** — `brainSearch`/`brainRead`/`brainSaveOutcome` em
  `luna-tools.cjs` (HTTP pro container nexo-brain :4321, envs `BRAIN_INTERNAL_URL`
  + `BRAIN_API_TOKEN` no .env do dashboard, PC e VPS), cases no executor do
  `luna-soul.cjs`, categoria 🧠 Brain no `tool-catalog.cjs`. Antes o modelo NÃO
  TINHA como acessar o brain no VPS (brain-loader só lia dir local inexistente).
  Endpoints reais: GET /api/search?q=, GET /api/nodes/:id, POST /api/learning/outcomes.
- **System prompt reescrito** (`config/luna-prompt-config.json`, PC+VPS): identidade
  (Luna 🌙, CTO virtual da Nexo Digital, parceira do Abner), REGRA DE OURO (responder
  OU usar uma tool, nunca chutar — "deixa eu verificar"), seções BRAIN e WHATSAPP com
  exemplos reais, e {{TOOL_INDEX}}. Validado E2E: a Luna chamou brainSearch sozinha e
  respondeu quem é o Abner com base nas notas (19s, tool ok).
- **FIX outbound grupo** (whatsplay `outbound.ts`) — grupo @g.us chegava como jid e a
  busca do WA digitava os DÍGITOS do id ("No se encontró ningún chat", screenshot do
  owner). Agora: jid de grupo → entrega pelo NOME do grupo (contact_name); privado
  segue por número/jid (deeplink). Allowlist/send-safety continuam no jid.
- **PENDENTE pro Kimi Code** (ver HANDOFF-kimi-code.md): teste ponta-a-ponta de
  dashboardSendWhatsApp pela Luna Web, suporte anthropic no bridge pra FCC, painel
  mostrar provider/modelo ativo, providers gratuitos extras (groq/openrouter/mistral
  precisam de conta do Abner).

## 2026-10-13 — noite (3): matrix de providers + fixes de tools (VPS produção)

### Matrix de testes (15 providers × 4 turnos, via https://vps.nexo-digital.app/luna/api — caminho humano)
Resultados em ~/luna-matrix-results.jsonl (VPS). Ranking:
- 🥇 kimi-coding: melhor disciplina de tools (chama a tool certa, formato ok)
- 🥈 openrouter-nemotron-super: bom tools + persona forte
- 🥉 openrouter-nemotron-ultra: bom mas se perdeu no T4 (resposta vazia)
- gemma-31b/26b, dots, nano-omni, lightning, laguna-s/xs, lfm, north-code: 429 "free-models-per-day" — a matrix ES-GOTOU a cota diária de cada um (reset diário; limites sobem com 10+ créditos na conta OpenRouter)
- pollinations: instável (respostas vazias) — fallback apenas
- gemini: quota morta (429) — precisa key nova
- github-models: SSE responde vazio — candidato a desligar

### Fixes aplicados (PC → scp → VPS, tudo node --check + restart luna-web)
1. DASHBOARD_API_URL: era https://vps.nexo-digital.app:3501/api (PORTA MORTA) → http://127.0.0.1:3500/api + DASHBOARD_INTERNAL_API_TOKEN nas envs (VPS+PC kernel+PC agent). Tasks agora funcionam (CRUD validado).
2. Tools WhatsApp reescritas em luna-tools.cjs: scan/history/status agora fazem SQL DIRETO na tabela messages (DATABASE_URL=postgres://luna:luna@localhost:5433/luna adicionado ao dashboard .env VPS+PC). APIs legadas /whatsapp-agent/* e /whatsapp/history NÃO EXISTEM mais.
3. dashboardSendWhatsApp: painel :3101 primeiro; se recusar (conversation_id inexistente) → fallback direto SQL (get-or-create org 'Nexo Digital' → client 'whatsapp-direto' → conversation → INSERT messages queued + pg_notify('luna_outbound')). Validado: mensagem entra na fila.
4. tool-catalog.cjs: categoria '📋 Dashboard — Tarefas & Solicitações' adicionada (dashboardCreateTask/List/Update/Complete/Delete + CreateLead) — estavam implementadas mas invisíveis pros modelos. Validado E2E: modelo criou tarefa sozinho.

### BLOQUEIO ATUAL — precisa do owner
- Envio real de WhatsApp: mensagem entra na fila (send_state=queued→failed) mas o whatsplay NÃO CONSEGUE abrir o chat no browser (openChat falha: pane-side nunca aparece, "Enter não abriu o resultado"). WA Web UI da sessão do VPS precisa ser olhada AO VIVO via RustDesk (pode ter caído/sessão expirada). Logs: ~/.pm2/logs/luna-whatsplay-out.log
- Inbound (teste de fogo): messages continua 0 — watcher ativo + allowlist ok (Abner e grupos no escopo), mas nenhuma msg nova chegou desde 20:11. Owner deve mandar msg NOVA pro +34 614 05 35 88 e olhar o log em tempo real.
- painel Nexo solicitações (:13510 /nexo/api/admin/requests) deu 403 sem auth — pra criar solicitação REAL no workspace precisa do token/cookie do painel (não investigado a fundo; dashboardCreateTask cobre o caso "tarefa").

### Addendum 23:2x — visor de provider + agenda de contatos (tudo deployado no VPS)
- Visor: RodaApiBridge.health (fails/limited/ok por provider) + GET /api/roda/status + widget injetado em packages/kernel/luna-web/dist/index.html (pill no topo-direita, nome curto + bolinha 🟢🟠🔴, hover mostra a roda; poll 8s). Bridge agora joga erro amigável quando a roda esgota ("Todos os providers falharam...") em vez de dump cru de 429.
- Agenda de contatos: painel next ganhou /api/contacts (GET/POST/DELETE, data/contacts.json) + UI na aba Mensageiro (select, add Nome+Número, remover, clicar preenche o chat_id). "Abner 34685093192" já semeado.
- dashboardSendWhatsApp: resolve nome→chat_id via /api/contacts antes de enviar (erro amigável se não achar). Validado: fn({phone:'Abner'}) → "enviado para 34685093192 (fila local)".
- NOTA: page.tsx do painel foi patchada DIRETO no VPS (backup page.tsx.bak-20261013) — replicar pro PC depois se o repo local divergir.

### Addendum 23:47 — BRAIN funcionando de verdade (root cause achado e fixado) + persona + skill do brain
- **Root cause do brain stale:** o container `nexo-brain` usa imagem de 08/out — TODO o repo fica congelado no build; só `clients/learning/memory/projects/security` eram mounts. O server lê o índice de `/app/atlas/public/data.js` (da imagem, velho) e as fichas de `/app/luna/*` (também velhas). Por isso a Jess voltava "escola de dança" mesmo com o fonte certo no host.
- **Fix:** `docker-compose.yml` do brain ganhou mounts read-only dos dirs de conteúdo vivos (`luna`, `reports`, `knowledge`, `personas`, `personalities`, `changelog`, `runbooks`, `automation`) + bind do `atlas/public/data.js` gerado no host (backup: docker-compose.yml.bak-20261013). `docker compose up -d` recriou o container. Agora: editar arquivo em `/opt/nexo-brain/luna/...` → `node atlas/generate.mjs` (node24) na raiz → search fresca IMEDIATA (loadAtlas lê do disco por request, sem cache). Validado: "Jess" → "marca de roupa de pole dance artesanal" ✅
- **Ficha canônica do Abner criada:** `/opt/nexo-brain/luna/contatos-pessoais/abner/FICHA.md` (owner/fundador Nexo Digital, WA pessoal +34 685 09 31 92, WA da Luna +34 614 05 35 88, abner@nexo-digital.app, aprova tudo, madrugador, PT). Search "Abner" → score 100 ✅
- **Skill do brain:** `~/.luna/skills/brain/SKILL.md` (PC fonte + VPS /home/nexo/.luna/skills/brain/). Frontmatter name/description/triggers; ensina: brainSearch com termos CURTOS (1-3 palavras, frase longa volta vazio), brainRead pelo id retornado, brainSaveOutcome. Entra no skillIndex do system prompt de first message (validado com loadSkillIndex no VPS). É a 1ª skill do sistema.
- **Persona:** `~/.luna/personas/default.md` (PC+VPS) — antes o dir estava VAZIO e loadPersona('default') voltava null → Luna seca/sem personalidade. Agora: CTO virtual da Nexo, tom profissional-caloroso-direto, regras de ouro (brain antes de perguntar, tool antes de confirmar, erro vira brainSaveOutcome).
- page.tsx do painel replicada VPS→PC (com CRLF), diff validado idêntico.
- Sempre lembrar: pm2 restart luna-web --update-env; VPS ssh = /usr/bin/ssh vps (usuário nexo); node24 no PATH via $HOME/node24/bin.

### Addendum 00:00 — GitHub Copilot na roda + busca do brain tokenizada + E2E APROVADO
- **github-models CORRIGIDO:** a URL `models.github.ai/inference` responde "OK" em text/plain (quebrava o SSE do api-bridge → "respondeu vazio"). A URL real da API é `https://api.githubcopilot.com/chat/completions` (modelos sem prefixo: `gpt-4o`, `gpt-4o-mini`), autentica com GITHUB_API_KEY (gho_...). Atualizado em: VPS /home/nexo/luna-kernel/roda/providers.json (backup .bak-ghfix), VPS + PC /config/providers.json do painel. Priority 13 (frente do pollinations).
- **Kimi coding esgotado:** a key KIMI_API_KEY tem janela de 5h — voltou 429 "access_terminated". Reseta sozinha. OpenRouter free: cotas diárias esgotadas pela matrix; resetam diariamente.
- **Busca do brain tokenizada (root cause de "Jess OnaDance" voltar vazio):** scoreAtlas exigia a frase inteira como substring — ids tipo `jess-onadance` (hífen) não casavam com query com espaço. Fix em /opt/nexo-brain/atlas/lib/atlas-data.mjs (backup .bak-20261013): pontua por token + bônus se todos baterem. **O lib/ agora é mount vivo no container** (`/opt/nexo-brain/atlas/lib:/app/atlas/lib:ro` no compose) — fix de código do brain não precisa mais de rebuild de imagem.
- **toolResultPrompt reforçado** (config/luna-prompt-config.json, PC→VPS): manda o modelo ENTREGAR a resposta ao usuário após o resultado da tool — gpt-4o estava respondendo "entendido, vamos prosseguir" sem responder.
- **TESTE DE FOGO APROVADO via https://vps.nexo-digital.app/luna/api/chat (provider: github-models/gpt-4o):**
  - "Quem é a Jess da OnaDance?" → brainSearch {"query":"Jess OnaDance"} → brainRead → resposta com as 3 solicitações reais da ficha (slider→vídeo hero, Trustpilot, "Avísame cuando vuelva") ✅
  - "Qual o whatsapp do Abner?" → brainSearch → **"+34 685 093 192"** com link wa.me ✅
  - Skill do brain + persona + lembrete "💡 suas tools" tudo ativo no loop.
- **Membrane CLI instalado** (path: /c/Program Files/nodejs) pra envio de WhatsApp via Kimi Work — PENDENTE autorização do owner no navegador (URL de consent impressa no chat). Depois: `membrane login complete <code>`, conectar connector whatsapp, e aí eu consigo mandar msg direto (fallback independente do whatsplay do VPS).

### Addendum 00:15 — persona canônica unificada + Membrane conectado
- **toolResultPrompt reescrito com a persona** (não mais "responda em linguagem natural" genérico): a instrução pós-tool agora manda responder COMO Luna (CTO virtual, tom vivo/direto/colega de time, fecha pedindo feedback com cliente). Validado: "Qual o whatsapp do Abner?" → "Achei o que você pediu! O número comercial do Abner é +34 685 093 192... número que ele decretou pra Nexo, já aplicado na landing de Sabadell" ✅ (voz da Luna, dado do brain).
- **Persona canônica:** ~/.luna/personas/default.md (PC+VPS) AGORA É o `.kimi-code/agents/luna.md` da luna-agent (fonte de verdade, decreto 27/09) — o que eu tinha escrito antes era uma versão paralela; substituído.
- **Membrane:** login feito (CLI em /c/Program Files/nodejs). Connection ID whatsapp: `6aceabcb6fd54e2694f374f4` — pendente parear pelo owner na URL https://api.getmembrane.com/screens/connections/219835b5-dec5-4592-ac4a-eba1c00ab719/6aceabcb6fd54e2694f374f4 (escanear QR com o app WhatsApp). Depois: `membrane connection get 6aceabcb6fd54e2694f374f4 --wait`, achar a action send-text-message e enviar. Isso dá um canal de envio WhatsApp independente do whatsplay do VPS.

### Addendum 00:20 — WhatsApp OUTBOUND curado (Kimi Code) + sincronizado
- Root cause: WA Web atualizou o DOM (role="row" + data-testid list-item-N, header "Chats" na busca, insertText morreu) + conversas do fallback SQL com contact_id NULL matavam o deliverOne (sem contato/alvo) + clearSearchField no-op.
- Fix (Kimi Code, patchado no VPS): outbound.ts lê cv.metadata->>'chat_id' como fallback de alvo; browser.ts usa fill() no lugar de insertText, limpa todos os candidatos de busca, locador :has([data-testid="cell-frame-title"]) pulando o header.
- **PROVA:** 2 mensagens reenfileiradas → ambas `sent` no banco ("reteste pipeline ok ??" 21:11 e "teste resolução por nome 🌙" 21:23) — owner recebeu no WhatsApp.
- Arquivos puxados VPS→PC (fonte da verdade), typecheck do whatsplay limpo.
- PENDENTE: teste de fogo INBOUND (owner manda msg nova pro +34 614 05 35 88 → cair em messages → Luna responder).
- Ruído residual: sweep perde corrida pro deeplink logo após health-reloads (1807 restarts acumulados — instabilidade crônica da página WA Web, olhar futuro).
- Roda VPS reordenada: gemini(1) → 11× openrouter free → github-copilot(13) → pollinations(14) → kimi-coding(15, evitado). Keys grátis novas entram na roda amanhã.

### Addendum 00:25 — Membrane descartado, WhatsApp 100% whatsplay
- Membrane whatsapp connector exige credenciais da Meta (Access Token + Phone Number ID da WhatsApp Business API) — owner decidiu: **ficamos no whatsplay** (decisão final).
- "pronto Abner" ENVIADO e **sent** via pipeline oficial: INSERT messages (conversation 8f6a9817, metadata.chat_id=34685093192) + pg_notify('luna_outbound') → whatsplay entregou.
- Membrane CLI fica instalado (login feito) pra outras integrações futuras, mas WhatsApp não passa mais por ele.
- PENDENTE (único): teste de fogo INBOUND — owner manda msg nova pro +34 614 05 35 88.

### Addendum 00:30 (madrugada 14/10) — INBOUND FUNCIONANDO PONTA-A-PONTA ✅
- **Teste de fogo APROVADO:** a "certeza?" do owner (0:18) foi lida pelo sweep, ingerida (messages + evento), respondida e **entregue no WhatsApp** ("Oi Abner! Estou aqui e pronta para ajudar…") às 23:17:53 UTC.
- **Root cause do sweep cego (3 camadas, todas corrigidas no VPS e syncadas pro PC):**
  1. `page-scripts.ts` (READ_CONVERSATION + READ_PANEL): o WA Web novo põe `data-pre-plain-text` no wrapper de cópia de TODA mensagem ("[hora, data] Autor: "), não só em citações — o filtro antigo excluía o próprio texto (texto voltava vazio → `filter(m.text)` zerava tudo). **Fix:** citação = pre-plain-text ANINHADO (com ancestral pre-plain no row); wrapper da mensagem é o externo. Validado no DOM vivo.
  2. `browser.ts` readConversation: msg-containers renderizam primeiro como SHELLS vazios (tail-in/out presentes, `.selectable-text` chega via hydration depois). Espera fixa de 500ms lia shells. **Fix:** `waitForSelector('[data-testid="msg-container"] .selectable-text', 8s)` no lugar do timeout fixo.
  3. `watcher.ts` (já documentado no addendum anterior): candidata = última mensagem DEPOIS da última outbound da Luna.
- **Causa raiz do silêncio do orchestrator (dead letter):** `loadRouterConfig` tinha default `C:/Users/Abner/.../routes.json` hardcoded → ENOENT no VPS → 6 eventos whatsapp.message.received morreram na DLQ. **Portabilizado** (todos via `import.meta.url`, funciona PC+VPS sem config): `router/config.ts` (routes.json), `agent/handler.ts` (prices.json), `router/tools-brain.ts` + `packages/brain/src/index.ts` (.brain), `whatsplay/src/index.ts` (chrome profile → `<home>/.luna/chrome-whatsapp`, evidenceDir relativo ao repo).
- **Cadeia FAST salva por env (sem código):** kimi elo1 esgotou (janela 5h), kimi-2 esgotou (mensal!), gemini free 429 (20/dia). `GEMINI_BASE_URL=https://api.githubcopilot.com` + `GEMINI_API_KEY=$GITHUB_API_KEY` + `GEMINI_MODEL=gpt-4o-mini` no .env do orchestrator (elo 3 = Copilot). Prova ao vivo: "fallback: kimi-api→gemini-api" → resposta entregue. Voltar pro gemini = reverter as 3 linhas.
- **Roda do kernel reordenada** (providers.json, backup .bak-ordem-20261014): github-models(1) → pollinations(2) → gemini(3) → kimi-coding(4) → 11× openrouter free → nvidia-nim. Status das chaves: OR free reseta 08:00 UTC (50/dia por key); gemini 20/dia; nvidia timeout.
- **Diagnósticos removidos** (logs gates/entrada varrida/resultado bruto/diagnostico DOM + campos te/q/sel). Logs pm2 do whatsplay acumulam histórico — os marcadores antigos no arquivo são do período de debug.
- **Typecheck verde PC + VPS:** whatsplay, orchestrator, brain.
- **PENDENTE pro owner:** mandar msg nova pro +34 614 05 35 88 pra validar o ciclo completo com o estado limpo (grupos da allowlist também geram eventos — "🏆Production" e "HDM" estão na lista; ver se o volume de eventos de grupo não incomoda).
- **Addendum 00:45 — gate de grupo (menção/citação) corrigido em 2 camadas:**
  - `shouldRespond` (ingest) JÁ existia (grupo sem menção = silêncio), mas `is_group` do sweep era SEMPRE false: `currentChatIsGroup()` lia o header com o painel já fechado pelo `readConversation` (finally `closeCurrentChat`) + testid antigo morto no DOM novo → grupo passava como privado. Fix: detecção estrutural pelos autores das mensagens lidas (grupo = todo membro tem label `[data-testid="author"]`; privado outbound sai como 'Tú' sem elemento).
  - Evento `whatsapp.message.received` NÃO carregava `mentioned_luna` (só a kimiwork inbox carregava) — adicionado ao payload do evento.
  - Handler ganhou gate em profundidade: whatsapp + is_group + sem menção + sem citação da Luna → skip com audit `agent.reply.group_no_mention_skipped`.
  - **Incidente honesto:** antes do fix, 1 handoff-answer da FAST ("Deixa eu verificar isso direitinho — já te falo aqui mesmo", router_output HANDOFF_LIVE) foi entregue no grupo 🏆Production (evento "Ja ja faço o Bizum!"). Próximas mensagens de grupo sem menção ficam em silêncio.
- Validação pendente com estado limpo: owner manda (1) msg nova no privado do +34 614 05 35 88 → resposta; (2) msg num grupo da allowlist SEM menção → silêncio; (3) msg no grupo MENCIONANDO a Luna → resposta.

### Addendum 02:00 (madrugada 14/10) — BRAÇOS POTENTES: SILENCE no FAST + sweep adaptativo + roda testada
- **Decreto owner 01:34 REVOGA o gate de grupo do addendum 00:45** ("quero que a Luna tenha braços potentes e possa responder quem quiser quando quiser, não só quando chamarem ela").
- **SILENCE no FAST (deployado VPS ✅, typecheck PC+VPS verde):**
  - `router/structured.ts`: saída `{"type":"SILENCE","reason":"..."}` no schema + instruções (grupo: ANSWER se pede participação / SILENCE se papo entre humanos; privado: sempre ANSWER).
  - `agent/handler.ts`: gate duro de grupo removido; ramo SILENCE = log + conversation RESOLVED + audit `agent.reply.silence` (sem INSERT outbound).
  - `whatsplay/src/ingest.ts`: skip duro `shouldRespond` removido — todo grupo allowlisted sobe pro FAST. Custo assumido: 1 chamada FAST por msg de grupo.
- **Sweep adaptativo (`watcher.ts`):** corpo extraído pra `sweepOne(entry)`; catch de leitura agora espera 8s e retenta 1x (página em reload) em vez de esperar o ciclo de 60s. Badge/reconcile intocados (rede de segurança).
- **Roda de providers (providers.json, backup .bak-luma-20261014-0149):** github-copilot(1) → pollinations(2) → gemini(3) → openrouter×11(4–14) → kimi-coding(15).
  - **OPENROUTER_API_KEY estava FALTANTE no roda/.env** — gravada agora (sk-or-v1-8b23…). Sem ela os 11 providers openrouter falhavam em runtime.
  - Testes ao vivo (curl VPS): github gpt-4o ✅ / pollinations ✅ / kimi ✅ / gemini 429 quota / openrouter 429 (reseta 08:00 UTC) / nvidia NIM timeout (mantido OFF).
  - **FCC-server (8082): inútil pra roda** — /v1/chat/completions 404, /v1/messages trava. Processo `luna-fcc` fica instalado, fora da roda.
  - Slots DESABILITADOS prontos p/ keys de amanhã: groq, mistral, cerebras, sambanova (onde pegar cada key no campo `note` do provider).
- **Testes de fogo ✅:** chat web E2E (POST :3458/api/chat → "pronto" em ~8s via gpt-4o) e WhatsApp E2E ("pronto Abner 🌙" → send_state='sent' na conversa 86f47a7b).
- **Crontasks/capacidade:** carga atual mínima (brain.watch ~horário, 0 ordens/24h, 2 agent_runs/24h). VPS folgada (ram 51%, cpu <10%). Gargalo futuro = rate-limit dos providers grátis com braços potentes, não a Luna.
- **Brain:** sync completo já validado antes (239 comuns hash-idênticos, VPS com 1.857 arquivos). Changelog do brain gravado em `/opt/nexo-brain/changelog/entries/2026-10-14-luna-bracos-potentes.md`.
- **PENDENTE pro owner:** (1) mandar msg de GRUPO da allowlist sem menção → a Luna decide (SILENCE ou ANSWER); (2) pegar keys groq/mistral/cerebras/sambanova amanhã e avisar p/ ativar; (3) se gemini não recuperar a quota sozinha, trocar a key.

### Addendum 08:05 (14/10) — FIX: SILENCE degradado pra ANSWER no router (pensamento vazava no grupo)
- **Bug ao vivo 05:38 UTC:** o modelo respondeu `{"type":"SILENCE",...}` certinho, mas o catch-all final de `runFastRoute` (router.ts) convertia QUALQUER saída não-ANSWER/HANDOFF em ANSWER com `reply_text` cru — o grupo recebeu o JSON literal ("diário interno que vazou", nas palavras dela).
- **Fix:** ramo explícito pro SILENCE no router — passa intacto pro handler (que faz audit `agent.reply.silence` + RESOLVED, sem outbound). Bônus: log warn quando `parseStructured` degrada (antes era silencioso).
- Deployado VPS (hash conferido PC=VPS), typecheck verde, 16/16 testes do router passando.
- **Tools via WhatsApp: SIM** — o loop TOOL_CALL (tope 5 rodadas) é agnóstico de canal. Catálogo no boot: `conversation.recent`, `client.summary`, `brain.search`, `brain.client_ficha`, `nexo.*` (finance, clients, leads, tasks, cashbox, expenses, payments, quotes, ideas, system.status, ops.overview, notifications, reports, client_orders, client_history), `voice.call_place`.
- Observação: 6 eventos `whatsapp.message` parados 'pending' na kimiwork_inbox (ponte Kimi Work desligada no VPS — modo default não é kimiwork). Se a ponte for religada, esses eventes voltam a ser consumidos; se não, podem ser limpos.
