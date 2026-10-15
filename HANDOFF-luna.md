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

### Addendum 08:45 (14/10) — WAKE-UP LOOP do HANDOFF consertado: live brain = roda (ADR-042)
- **Sintoma do owner:** "vou dar uma olhadinha" e nunca voltava. Causas reais (tudo verificado ao vivo):
  1. Live brain era `kimiwork`, com **cap de segurança de 12h atingido** — todo HANDOFF_LIVE falhava no sendTurn → escalate pro time, nada pro cliente.
  2. Dedupe semântico usava `router.investigation.dispatched` — pedido que só FOI DESPACHADO (e falhou) bloqueava re-pedidos legítimos pra sempre (3 skips com score 1.0 ao vivo).
  3. 1 job investigate travado 'running' desde 06:20 (kimiwork pollando varredura que nunca vinha).
- **Fix (sua arquitetura, exatamente):** live brain agora pode ser `LIVE_BRAIN_PROVIDER=roda` — a MESMA roda de providers do FAST (github gpt-4o primeiro). Stateless, OpenAI-compatible, com fallback entre providers grátis. Troca = só .env.
  - `packages/shared/config.ts`: enum + `LIVE_BRAIN_RODA_CONFIG` (default `/home/nexo/luna-kernel/roda/providers.json`).
  - `apps/worker/src/index.ts`: branch roda no liveAdapter + `liveHasTools` pro investigate.
  - `apps/worker/src/jobs/investigate.ts`: prompt NOTOOLS pro modo API (sem prometer Write/Edit/Bash; NÃO RESOLVIDO se a tarefa exigir ação real) + dedupe agora só conta `router.investigation.completed` (atendido, não despachado).
- **VPS configurado:** `LIVE_BRAIN_PROVIDER=roda` + `OPENROUTER_API_KEY` no `.env` (faltava lá também — só existia no roda/.env).
- **TESTE DE FOGO ✅:** job investigate manual → roda (gpt-4o) respondeu em ~2s → "O cérebro vivo da Luna voltou a funcionar, e este é o modelo GPT-4 respondendo." → entregue no WhatsApp do Abner (`send_state='sent'`). 9/9 testes do investigate, typecheck PC+VPS verde.
- Limitação honesta do modo roda: sem ferramentas — pesquisa/raciocínio com o contexto que o FAST passa. Ação real (escrever arquivo, ligar, mexer no painel) volta a precisar de kimi-cli/pi/kimi-web-local quando houver quota.

### Addendum 09:55 (14/10) — Live brain roda com BRAÇOS: loop de tools no worker
- **Decreto owner 09:19:** "o live brain deve ver a lista de tools — ler arquivos, editar, criar, tudo igual a Luna".
- **`apps/worker/src/jobs/live-tools.ts` (novo):** runner de tools executado pelo worker — `listTools` (catálogo completo com args, regra de ouro do prompt), `fs.read` (com contagem de linhas), `fs.write`, `fs.edit` (old_string exato), `fs.list`, `fs.grep` (regex recursivo), `shell.run` (timeout 30s, denylist de comandos catastróficos). Path traversal bloqueado fora de `LIVE_BRAIN_RODA_ROOTS` (default: luna-agent, luna-kernel, /opt/nexo-brain).
- **`investigate.ts`:** modo `workerTools` — o modelo conversa em JSON (`{"action":"tool"|"final"}`), o worker executa e devolve o resultado, até 8 rodadas (`LIVE_BRAIN_RODA_MAX_ROUNDS`) + **rodada bônus final** (sem tools, resume com o que aprendeu — anti-escalada por esgotamento). Cada tool vira audit `live.tool.run`.
- **Bug ao vivo na 1ª versão:** modelo gastou as 6 rodadas só lendo e nunca deu final → escalei. Fixes: fs.read agora devolve `lines`, prompt ganhou regra de economia de rodadas, rodada bônus, max 8.
- **TESTE DE FOGO ✅:** "leia HANDOFF-luna.md e diga quantas linhas tem + crie arquivo X" → fs.read + fs.write em ~3s → "O arquivo HANDOFF-luna.md tem 460 linhas. O arquivo .luna-live-tools-test.md foi criado..." → **sent no WhatsApp do Abner**. 23/23 testes (14 novos do live-tools), typecheck PC+VPS.
- Segurança honesta: shell roda como usuário nexo com denylist; não é sandbox de hardware — é guard contra desastre acidental. Toda chamada auditada.

---

## 2026-10-14 11:30 CEST — Grupo Production: fim da msg fixa, updates de progresso, fim do loop de eco

**Diagnosticado ao vivo (DOM do WA Web na build nova + events/outbox/DLQ):**

1. **"Fica falando toda hora" = loop de eco próprio**: mensagem da Luna recém-enviada
   chega ao sweep SEM tail-out e SEM o aria "Tú:" montado (corrida pós-envio) →
   fallback inbound → ela ingeria a própria fala e respondia de novo. Fixes em
   3 camadas: msg-meta status de entrega como sinal de outbound
   (page-scripts.ts, 2 scripts), sweep ignora autor Tú/Você (watcher.ts), eco
   puro (overlap ≥ 0.9) + strip de prefixo "Tú:" (self-echo.ts).
2. **"Lê e não fala nada" = HUMAN_HANDLING** (ADR-026, escalación aberta — por
   design). Conversa voltou pra RESOLVED sozinha.
3. **Msg de espera fixa** → rotação de 6 acks naturais (router.ts HANDOFF_ACKS).
4. **Updates de progresso no investigate** (estilo tool card em texto): 1 no
   início + 1 na primeira tool, com frase por categoria de tool
   (arquivos/solicitação/mensagens/comandos) — worker/src/jobs/investigate.ts,
   sendProgress(), metadata.kind=progress_update.
5. **REGRA OWNER 14/10: rodadas ILIMITADAS** — removida a "ECONOMIA DE RODADAS"
   e o cap de rodadas; único freio é o timeout de parede (payload.timeout_ms,
   default 10min), checado por rodada.

**Teste de fogo (evento publicado via publishEvent, corr_firetest_*):**
HANDOFF_LIVE → ack variado → "deixa eu ver isso direitinho, já volto" →
"deixa eu abrir os arquivos rapidinho" (fs.read) → resposta real (468 linhas,
seção nova confirmada) — **4 mensagens entregues no grupo, todas sent**.

Pendente: investigar rounds do live brain que completam em ~40ms (roda stateless
ADR-042 sem worker-tools — resposta genérica), e a quota 5h do kimi (fallback
kimi-2/gemini também esgota — verificar rotação de providers).

---

## 2026-10-14 ~11:45 UTC — Luna Web ganha braços (tool-alias-resolver) ✅

**Pedido do owner:** a Luna Web estava "burrinha" — o agente do WhatsApp tinha
braços e a web não. Mandou herdar a estrutura de tools.

**Diagnóstico ao vivo (sessão web-test-burra):**
- brainSearch/listTools/dashboardSendWhatsApp JÁ existiam no kernel
  (tool-catalog.cjs + luna-tools.cjs + dispatch na luna-soul.cjs) — a kimi code
  tinha montado isso na madrugada.
- Causa real da mensagem "ferramenta desconhecida": o modelo (Kimi Web)
  **inventou o nome** `sendMessageWhatsApp {to, message}` em vez de usar o
  canônico `dashboardSendWhatsApp {phone, message}`. Qualquer nome não exportado
  caía no "Ferramenta desconhecida" e a Luna ficava sem braços.
- Detalhe: sessões antigas carregam o tool_result de falha no histórico — o
  modelo passa a recusar tentar de novo. **Sessões novas não têm esse fardo.**

**Fix implementado (deploy VPS, kernel):**
- `packages/kernel/tool-alias-resolver.cjs` (NOVO): resolve nomes inventados
  em 4 camadas — 1) exato, 2) alias explícito (~70 aliases: sendMessage,
  sendMessageWhatsApp, enviarMensagem, listTools/tools/ferramentas, shell,
  python, fs.read, edit_file, ls...), 3) match normalizado (lowercase+alfa-num),
  4) contenção única (ex.: listTasks → dashboardListTasks). Ambíguo = não adapta.
- `luna-soul.cjs`: `_handleAction` resolve o nome antes do dispatch e avisa o
  modelo no tool result quando adapta (`[tool 'X' entendida como 'Y']`).
- `luna-prompt-config.json`: hint de listTools no toolResultPrompt e no
  miniReminder (decreto owner 22:25 de 13/10: "se quiser saber suas tools
  execute listTools" em todos os prompts).

**Backups:** luna-soul.cjs.bak-alias-20261014, luna-prompt-config.json.bak-alias-20261014

**Testes E2E (todos passaram):**
1. brainSearch "Abner whatsapp" → achou número comercial +34 685 093 192 ✅
2. **dashboardSendWhatsApp 34685093192 → send_state=sent no Postgres** ✅
   (mensagem "Luna Web com braços funcionando — teste de envio 🌙" entregue)
3. listTools {"search":"whatsapp"} → listou as 5 tools WhatsApp ✅
4. executeShell wc -l → executou (caminho errado do HANDOFF — o certo é
   /home/nexo/luna-agent/HANDOFF-luna.md, NÃO luna-kernel/) ✅
5. dashboardListTasks → 21 tarefas do painel ✅

**Pendente / observações:**
- kimi code tem edições não commitadas em: luna-soul.cjs, luna-tools.cjs,
  tool-catalog.cjs, luna-prompt-config.json, luna-chat-routes.js,
  routes/luna-tools.js, api-bridge.cjs, bridge-factory.cjs (trabalho dela da
  madrugada + meu patch de alias misturado nos dois primeiros). Commitei SÓ o
  tool-alias-resolver.cjs (arquivo novo, 100% meu).
- Modo instant da web roda UMA tool por mensagem do usuário (chatModeNeverLoops
  no loopRules) — para cadeias, o owner manda uma mensagem por passo ou a gente
  revisita o loopRules depois.

---

## 2026-10-14 ~13:15 UTC — Cadeia autônoma de tools na Luna Web (decreto owner) ✅

**Pedido do owner:** quebrar o "1 tool por mensagem" em TODOS os modos (instant e
thinking). A Luna só para quando ELA decidir que a tarefa acabou. Naturalidade
total (incl. crontasks disparando WhatsApp do nada).

**Diagnóstico (3 camadas de causa):**
1. O ENGINE do loop já estava certo: ACTION/PLAN sempre alimenta o resultado de
   volta e continua; só CHAT/DONE puro encerra. Não era engine.
2. A CÂMERA LENTA: o prompt ensinava "UMA tool por mensagem; espere o Tool
   Result" + toolResultPrompt dizia "só chame outra tool se o resultado estiver
   incompleto". Reescrito: CADEIA AUTÔNOMA (continuar até completar tudo),
   anti-padrões proibidos (resposta parcial, pedir confirmação entre passos).
3. A Causa RAIZ descoberta no teste: o transporte ativo é o **ApiBridge
   stateless** (bridge-factory auto → roda:github-models gpt-4o primeiro) — ele
   envia SÓ `{role:user, content:prompt}` sem system message e sem histórico
   server-side. O template toolLoop shipped (`{{miniReminder}}+{{toolResult}}`)
   não incluía {{history}} → o modelo recebia o resultado DA TOOL SEM SABER
   QUAL ERA A TAREFA. Respondia genérico e parava. Por isso "modo stateless
   responde em ~40ms sem tools" (nota da kimi code) — não era limitação da roda,
   era prompt sem contexto.

**Fixes aplicados (kernel VPS):**
- `luna-prompt-config.json`:
  - systemPrompt: [REGRA DE OURO] virou CADEIA AUTÔNOMA + anti-padrões proibidos;
    nova seção [AMBIENTE — VOCÊ ESTÁ DENTRO DA VPS]: acesso TOTAL (qualquer
    caminho, shell, logs, processos, banco) — "não existe fora do workspace".
  - toolResultPrompt: ⛓️ MODO CADEIA ATIVA no topo; próxima tool imediata quando
    a tarefa não estiver completa.
  - prompts.toolLoop e prompts.followUp REESCRITOS autocontidos: persona Luna +
    protocolo JSON + ⛓️ cadeia + {{systemContext}} + {{history}} + input — o
    prompt inteiro precisa ser self-contained porque o ApiBridge é stateless.
- `luna-soul.cjs`: slice de histórico do toolLoop -3 → -12 (a tarefa sobrevive
  a cadeias de ~5 passos); removido path traversal de `_createScript`/`_editFile`
  (decreto owner: VPS inteira é o workspace); fallback do master prompt sem
  [WORKSPACE ISOLATION].
- `luna-tools.cjs`: dashboardSendWhatsApp aceita params.to/target/recipient/
  destinatario (modelos adoram `to`).
- `tool-alias-resolver.cjs`: +aliases messagesendwhatsapp/sendwhatsappmsg.

**Teste E2E definitivo (sessão web-test-cadeia-04, UMA mensagem, zero intervenção):**
executeShell(wc -l → 550) → dashboardListTasks(21 tarefas) →
sendWhatsappMessage(alias→dashboardSendWhatsApp) → **send_state=sent** ✅
Resposta final em persona confirmando tudo.

**Aprendizado-chave:** com transporte stateless, CADA prompt precisa carregar
persona + protocolo + histórico + tarefa. Nada de assumir memória server-side.

**Pendente (pra kimi code / próximos ciclos):**
- Item 1 do radar dela: decidir se o modo stateless fica ou sai (agora que o
  contexto chega completo, ele FUNCIONA — recomendo ficar como principal).
- Chip de provider na UI ainda mostra "Kimi Web" mas o transporte real é
  API/gpt-4o (rótulo da sessão, não do transporte).
- Crontasks disparando WhatsApp espontâneo: pipeline já existe (orchestrator +
  pg_notify); falta agendar tarefas.
- Sessões antigas (pre-fix) carregam tool_result de falha no histórico — o
  modelo se recusa a tentar de novo; usar sessão nova.

---

## 2026-10-14 ~15:00 UTC — Luna enxerga o Workspace Nexo (solicitações dos clientes) ✅

**Pedido do owner:** a Luna não sabia onde estava nem que existia o workspace do
cliente. Queria: ela SABER que está dentro da VPS com todos os arquivos, o nome
do workspace cliente, TODAS as tools do workspace na lista, e o prompt dizendo
"você pode tudo — mapeie o que quiser".

**Descoberta:** o "fui bloqueada fora do permitido" que ela relatou pro owner era
alucinação de sessão antiga (era do prompt pré-fix com WORKSPACE ISOLATION) —
testei viewDirectory('/home') direto na tool e funciona. Ainda assim removi o
que restava de gaiola.

**Implementado (kernel VPS):**
- `workspace-nexo-tools.cjs` (NOVO): 8 tools de autenticação real no portal
  /nexo (login admin NEXO_API_USERNAME/PASSWORD do .env do luna-agent, sessão
  cacheada com re-login automático em 401):
  workspaceListRequests, workspaceGetRequest, workspaceCreateRequest,
  workspaceUpdateRequest, workspaceAddComment, workspaceListProjects,
  workspaceListOrganizations, workspaceListClients.
  Endpoints: /nexo/api/admin/* (mapa na skill solicitacoes-painel).
- Wiring: exports em luna-tools.cjs (spread), dispatch cases na luna-soul.cjs,
  categoria '🗂️ Workspace Nexo — Solicitações' no tool-catalog.cjs (aparece no
  TOOL_INDEX automaticamente), aliases solicitacoes/pedidos/solicitacao no
  tool-alias-resolver.cjs.
- luna-prompt-config.json [AMBIENTE]: workspace cliente nomeado
  (https://vps.nexo-digital.app/nexo, Ona Dance/Jess, HDM, JR Reformas),
  lista das 8 tools dele, e decreto de mapeamento: "Não existe área proibida.
  Se não souber onde algo está: grep -rn ... /home/nexo".

**E2E (sessão web-test-ws-01):**
1. "pedidos da Jess" → workspaceListOrganizations → achou Ona Dance
   (cmshyy4nq0001eix2h7a8ose8) → workspaceListRequests → **9 solicitações reais
   resumidas** (hero desktop, tienda pixelada, sticker agotado...) ✅
2. "explora /home/nexo" → viewDirectory + shell(alias→executeShell) → listou os
   projetos reais da VPS (luna-agent, luna-kernel, nexo-cms, nexo-ai-proxy...) ✅

**IDs rápidos (do workspace):** Ona Dance org cmshyy4nq0001eix2h7a8ose8 · HDM
org cmtldsn6500067ahwsohd46vr · JR Reformas org cmtinm4vf0001v1q1xu8otif3
(detido também na skill solicitacoes-painel).

## Turno tarde 14/10 — response gate, retry de entrega, crontasks

**FALE ENQUANTO EXECUTA (response gate)** ✅ — O engine JÁ suportava falar+agir
desde v5.2 (luna-soul.cjs: ACTION carrega campo `response` junto com `tool` e o
loop continua), mas nenhum prompt ensinava isso ao modelo. Adicionada seção
"FALE ENQUANTO EXECUTA" no systemPrompt de
luna-kernel/packages/kernel/config/luna-prompt-config.json (backup
.bak-speak-20261014), logo após o bloco CADEIA AUTÔNOMA: o modelo pode incluir
"response" no MESMO JSON da tool — o texto chega ao usuário antes da tool rodar
e a cadeia NÃO é cortada. luna-web reiniciado; smoke test com sessão nova
confirmou persona intacta + cadeia tool→resposta funcionando (pergunta sobre a
Jess → brainSearch → resposta correta: Ona Dance, onadance.com, WooCommerce).

**Retry de entrega WhatsApp** ✅ — apps/whatsplay/src/outbound.ts (backup
outbound.ts.bak-retry-20261014): o deliverOne agora traz m.metadata, ignora
rows com next_retry_at futuro (tanto no pickup quanto no dreno de boot), e no
catch reenfileira com backoff 60s×tentativa (cap 300s, máx 4 retries,
delivery_attempts no metadata) antes de marcar failed — erros de
send_safety/allowlist/blocklist/recusa NÃO são re-tentados (são permanentes).
Motivação: o outbound das 10:39 UTC ficou failed PERMANENTE sem retry nenhum.
tsc --noEmit passou; luna-whatsplay reiniciado.

**Crontasks Kimi Work → Luna** — verificado, o redirecionamento JÁ EXISTE e é
por escrita direta no Postgres do VPS: as automations de varredura rodam agente
local no PC, fazem INSERT em messages (send_state='queued', sender='luna',
metadata chat_id) + pg_notify('luna_outbound', id), e o whatsplay entrega.
Estado "skipped" na lista é NORMAL para gatilho por condição (só dispara com
pendência real). O que o owner não via era resultado visível: delivery vazio,
sem notificação push configurada.

**NÃO TOCAR (kimi code ativa agora):** apps/orchestrator/src/agent/*
(context, handler, router/*, tools-brain) e apps/whatsplay/src/{browser,
discover,index,page-scripts,watcher}.ts — eco das 12:12 UTC ("Tú: ...") e a
latência do inbound (lê contexto, não responde) estão sob trabalho dela no
router. A latência suspeita de sair do gating do router (SILENCE/ANSWER), não
do whatsplay.

**Pendente:** teste de fogo WhatsApp inbound ponta a ponta (mandar msg do
número do Abner e ver resposta), depois que a kimi code fechar o router.


---

## 2026-10-14 16:30 CEST — Kimi Code: fim do "lê e não responde" no privado + allowlist de jid

**Root cause (duas camadas, provadas com dados do banco):**

1. **Escalada presa engolia o privado do Abner**: escalation de 07:22 ("pedido
   explícito de humano") ficou 7h em `notified` sem ninguém do time assumir.
   Enquanto NEEDS_HUMAN/HUMAN_NOTIFIED/HUMAN_NOTIFIED, o handler anexa a
   mensagem e NÃO responde (ADR-026) — o Abner viu isso como "lê e não fala".
   **Fix** (`orchestrator/src/agent/handler.ts`): escalation sem atividade
   humana por 45min (`ESCALATION_STALE_MS`) EXPIRA (status 'expired'), a
   conversa transiciona pra AI_HANDLING e a mensagem corrente segue pelo
   fluxo normal — a Luna volta a responder sozinha. Audit:
   `escalation.auto_expired`.
2. **Allowlist não casava jid vs dígitos puros**: alvo `120363428577835024`
   (chat_id do grupo) recusado contra entrada `120363428577835024@g.us` —
   `endsWith` nunca batia. **Fix** (`whatsplay/src/allowlist.ts`):
   `jidDigits()` extrai os dígitos de jid/número/telefone dos dois lados e
   compara quando ambos têm identidade numérica; match de nome inalterado.

**Verificado (teste de fogo real)**: evento no privado do Abner
(conversa 86f47a7b, presa desde 07:22) → `escalation.auto_expired` →
conversa RESOLVED → resposta gerada e **entregue no WhatsApp (sent
14:28:15 UTC)**. Typecheck limpo nos dois apps; restart sem downtime além
do boot.


---

## 2026-10-14 19:30 CEST — Kimi Code: protocolo de INSISTÊNCIA de escalation (WhatsApp + ligação de voz)

**Reclama do owner:** "escalation to human não respondida → insistir, mandar msg
(ficar gravado), LIGAR pro Abner com prompt montado do contexto. Não é só clicar
um botão. Ninguém recebeu escalation nenhuma."

**O que existia vs o que faltava:**
- `escalation-tick` (worker, 60s) tinha SLA follow-up — mas o canal era SÓ
  Telegram, e Telegram do time NUNCA foi configurado → `alert()` caía num log
  error. **Ninguém recebia nada, por isso.**
- `voice.call` (job → evento → NOTIFY `voice_call_requests` → executor no
  whatsplay) existia e funciona: CallBrief {destinatario, autorizador, motivo,
  objetivo}, pré-voo do operador, placeVoiceCall, conductora.
- chat_registry estava VAZIO (registryCheck fail-closed recusava qualquer alvo).

**Implementado:**
1. `packages/database/src/escalation-alert.ts` — `alertOwnerWhatsApp()`: TODO
   alerta de escalation agora vai como DM da Luna pro Abner (messages + NOTIFY
   luna_outbound + audit `escalation.whatsapp_alert`). Gravado em messages.
2. `worker/src/jobs/escalation-tick.ts`:
   - alert() duplica pro WhatsApp do owner em TODOS os estágios;
   - NOVO estágio 3 (REGRA OWNER): escalation CRITICA/ALTA segue sem atendimento
     após o follow-up de SLA + 5min → enqueue `voice.call` com CallBrief montado
     do contexto (reason + últimas 3 falas do cliente) → DISPARA LIGAÇÃO DE VOZ
     pro Abner. Uma vez (metadata voice_call_placed) + cinto created_at < 1h;
   - NOVO estágio 0: expiração — escalation 'notified/handling' sem atividade
     há 45min EXPIRA (espelha ESCALATION_STALE_MS do handler) ANTES dos demais
     estágios. Misfire real no boot 17:10 (6 ligações de escalation velha de
     uma vez) motivou o estágio 0 + a janela de 1h. Contido: 11 antigas expiradas
     manualmente.
3. `orchestrator/src/agent/handler.ts` — `escalate()` agora alerta no WhatsApp
   do owner NA CRIAÇÃO (além do Telegram se configurado).
4. Seed chat_registry: Abner (individual, role allowed, hint 'Pai').
5. `whatsplay/src/index.ts` — spawn do chrome-voice (:9340) ganhou flags de
   plataforma (ozone wayland) + anti-throttling; sem isso o Chrome morria no
   boot do VPS e o pré-voo esgotava.

**Status do teste de chamada:** dispatch → registry → pré-voo TODOS OK.
Último gate: o ChatGPT do Operador está **DESLOGADO** ("Iniciar sesión" —
screenshot /tmp/chatgpt-state.png). O pré-voo recusa discar sem operador
(decreto: "não vou discar sem operador de voz") — comportamento correto.
**AÇÃO DO OWNER (única coisa que falta):** logar no chatgpt.com dentro do
chrome do VPS (perfil ~/.luna/chrome-voice, porta CDP 9340) — RustDesk ou o
stack VNC (luna-vnc, Xvfb :98). Depois do login, repetir: enqueue job
voice.call com brief → liga de verdade. Script de teste pronto:
apps/worker/voice-call-test.ts.

**Gatilho de voz REAL configurado por escalation:**
criação → DM imediata → +10min (ALTA) follow-up → +5min LIGAÇÃO → 45min sem
humano → expiration (Luna volta a responder sozinha).

## Turno noite 14/10 — fim da busca lixo: JID de grupo nunca mais polui a caixa

**Sintoma (screenshot owner 19:48):** caixa de busca do WA Web parada com
"120363411799534605" e "No se encontró ningún chat, contacto ni mensaje" — a
Luna re-tentava JIDs de grupo na busca a cada ciclo do sweep (~12s), porque a
busca do WA NÃO indexa JID (só nome/número). Resíduo ficava horas na tela.

**Causa raiz (3 camadas):**
1. WHATSAPP_INGEST/OUTBOUND_ALLOWLIST continha dois JIDs crus de grupo
   (120363428577835024@g.us, 120363411799534605@g.us) — o sweep chamava
   readConversation(jid) → openChat pesquisava os DÍGITOS → lixo garantido.
2. Buraco do fix de 13/10 no outbound: isGroupJid só olhava row.address; JID de
   grupo vindo como DÍGITOS puros do metadata.chat_id (prefixo 120363) era
   vestido de @s.whatsapp.net e tratado como contato (msg 646af5fe 10:39 UTC).
3. O WA Web atual REMOVEU o atributo data-id das rows da lista — o resolver de
   JID→nome pelo DOM não tem mais âncora (fiber probe não achou props de chat).

**Fixes aplicados (apps/whatsplay):**
- `watcher.ts` (backup .bak-groupname-20261014): extractAndIngest abre pelo
  chat_name (título do badge scan), JID só fallback — grupo se abre por nome.
- `browser.ts` GUARD (backup .bak-emptyguard-20261014): após digitar o termo,
  se o WA disser "sem nenhum resultado" (texto 'ningún chat'/'no se encontró'
  ou zero rows com cell-frame-title), APAGA o termo lixo e aborta na hora —
  mata o loop de ~60s que deixava número podre na caixa.
- `browser.ts` GROUP-JID (backup .bak-groupjid-20261014): openChatInner com
  @g.us/120363 tenta resolver o título pelo data-id e abrir por nome; fora da
  lista = falha LIMPA, jamais cai na busca por dígitos.
- `outbound.ts` (backup .bak-groupdigits-20261014): isGroupJid cobre address
  @g.us, chat_id @g.us e dígitos ^120363; resolve nome em chat_registry →
  contact_name → conversations.metadata.chat_name; sem nome = failed explícito
  'grupo não resolvido' SEM retry.
- `index.ts` (backup .bak-spawnguard-20261014): spawn do chrome-voice ganhou
  handler .on('error') — path inexistente não derruba mais o processo no boot
  (os 3530 ENOENT históricos de 13/10 eram isso; env já tem path Linux certo).
- `.env` (backup .env.bak-allowlist-20261014): removidos os 2 JIDs crus de
  grupo das DUAS allowlists. Cobertura não muda (JID nunca conseguia abrir —
  entregava zero); se algum grupo precisar de ingest, adicionar o NOME.

**Validação:** tsc --noEmit OK; whatsplay reiniciado 2×; guard capturou os 2
JIDs lixo na primeira execução e abortou limpo; após limpeza da allowlist, 2
ciclos de sweep seguidos só com 'mensagem nova' por nome — zero busca lixo,
restarts estáveis (1835 = só os meus reinícios).

**Pendente:** mapear JID→nome dos grupos de verdade (React fiber da lista não
expôs props; data-id morto no build atual) e repopular chat_registry
(kind='group') pra outbound de grupo resolver nome automaticamente.

## Turno noite 14/10 (continuação) — Diretório WhatsApp: contatos e grupos no brain

**Pedido do owner:** sistema de contatos e grupos onde a Luna navega e pega
dados, tudo ligado no brain.

**O que foi criado:**
- **Migração 016** (`packages/database/migrations/016_wa_directory.sql`,
  DDL aplicado): tabela `wa_group_members` (grupo → membros com nome e admin).
- **`apps/whatsplay/scripts/harvest-wa-directory.mjs`**: colhe da sessão WA
  viva via CDP :9333 o model-storage (IndexedDB) — stores chat/contact/
  group-metadata/participant (o DOM atual não expõe mais data-id; essa é a
  fonte real de jid→nome, telefone, descrição de grupo, membros e admins).
  Grava 3 saídas de uma vez: chat_registry (só allowlist — registry é
  operacional, role só aceita allowed/blocked), wa_group_members (todos os
  grupos), e o doc do brain.
- **Brain:** `/opt/nexo-brain/knowledge/whatsapp-diretorio.md` (diretório
  completo navegável: 20 contatos com número/JID/allowlist + 5 grupos com
  descrição/dono/membros), linkado no index.md; changelog registrado.
- Wrapper `/home/nexo/tmp-patch/run-harvest.sh` (envs do .env sem sourcing).

**1ª colheita:** 7 chats allowlisted no registry (5 grupos, Abner×2 — decreto
+ LID consolidados com o mesmo telefone, Enoque), 26 membros em 5 grupos.

**Decisão importante:** chat_registry NÃO virou agenda — só entra allowlist
(role allowed/blocked alimenta fluxos de envio; marcar neutro como 'blocked'
seria perigoso). O diretório COMPLETO mora no doc do brain + wa_group_members.
Contatos aparecem em par @lid + @s.whatsapp.net (modo LID do WA — normal).

**Como a Luna usa:** o doc do brain ensina — consultar membros por SQL, número
por registry/diretório, e ATUALIZAR rodando o harvester via executeShell.

## Turno noite 14/10 (crontasks) — varredura-geral morta + scheduler bugado

**Sintoma (owner):** dia inteiro sem a Luna ir aos grupos/responder — "crontasks
não estão dando certo".

**Diagnóstico:**
1. `automation_372ac5b9` (Varredura menções e turnos 24/7): último run em
   12/10 19:54Z. Último condition-run com resultado: 09/10 — crash do runner
   python exit 3221225794 (0xC0000142, STATUS_DLL_INIT_FAILED). O script
   (should_fire.py) está SANO — testado manualmente, fail-closed correto.
2. `automation_27b0babd` (negócios + projetos): SAUDÁVEL — polla a cada 1min
   sem parar (condition-runs a cada minuto).
3. Comparação dos triggers: IDÊNTICOS. Testes feitos: re-save do trigger
   (AutomationUpdate) → exatamente UM poll (~1min depois) e silêncio depois;
   disable→enable → nada; criar automação NOVA (automation_f5c70c00, restore
   integral da antiga, should_fire.py copiado p/ assets/conditions/) → ZERO
   polls em 10+ min, enquanto a antiga saudável continuava pollando no mesmo
   instante.

**Conclusão: bug do scheduler do app Kimi Work — só honra automações cujo
agendamento foi registrado no boot do app; (re)registros posteriores são
ignorados (o update dispara 1 avaliação síncrona e nunca re agenda).** Remédio:
REINICIAR O APP KIMI WORK (fechar e abrir) — o scheduler reconstrói o registry
e a automação nova (f5c70c00, já enabled) passa a pollar.

**Estado deixado:**
- `automation_372ac5b9` DESABILITADA (backup do restore; deletar depois do
  restart validar a nova).
- `automation_f5c70c00-dfb5-454e-bc21-01c203c8e1b6` ("Luna — Varredura de
  menções e turnos (24/7)", restore integral: mesmo prompt/trigger/workspace)
  ENABLED, aguardando restart do app pra começar a pollar.
- should_fire.py copiado para assets/conditions/ da nova.

**Importante (expectativa do owner):** as varreduras são 100% por EVENTO
(decreto 2026-10-05: nada de cron com tempo) — a Luna só age quando existe
pendência REAL (msg/turno/solicitação nova). Ela NUNCA vai "ir nos grupos por
conta própria" sem um gatilho; se o owner quer rodadas proativas periódicas,
é mudança de desenho (ex.: turno 'rodada proativa' a cada X) — conversar.

**Harvest do diretório WhatsApp agendado:** cron VPS `17 6 * * *` →
/home/nexo/tmp-patch/harvest-cron.sh (log em /home/nexo/logs/harvest-wa-directory.log).

---

## 2026-10-14 noite — WhatsApp tools de verdade + caso Elias resolvido

### Feito
1. **Kernel: 5 whatsapp tools novas** (`luna-kernel/packages/kernel/whatsapp-tools.cjs`, padrão workspace-nexo-tools):
   - `whatsappListContacts {search?}` — diretório individual (chat_registry)
   - `whatsappListGroups {search?}` — grupos + nº de membros (wa_group_members)
   - `whatsappGroupMembers {group}` — membros de um grupo
   - `whatsappSendMessage {to, message}` — aceita NOME, jid ou número; GRUPO INCLUÍDO (resolve chat_key @g.us no registry). Enfileira pelo protocolo oficial (org→client→conversation, INSERT 'queued' + pg_notify('luna_outbound'))
   - `whatsappAllowContact {name, phone?, note?}` — PROTOCOLO DE ONBOARDING (decreto owner): add nas envs WHATSAPP_*_ALLOWLIST do .env do luna-agent + chat_registry + `pm2 restart luna-whatsplay --update-env`
   - Registradas em: luna-tools.cjs (require+exports), luna-soul.cjs (dispatcher), tool-catalog.cjs (categoria '🟢 WhatsApp — Diretório & Envio'), tool-alias-resolver.cjs (aliases PT; aliases de envio antigos agora apontam pra whatsappSendMessage). Backups `.bak-watools-20261014`.
   - **Testadas com sucesso**: envio pro grupo Production por nome = `sent` 19:38; envio pro Abner por nome = `sent` 19:39; whatsappAllowContact (com contato fictício, limpeza feita depois); catálogo renderiza (INDEX_OK).
2. **Patch outbound.ts (allowlist de grupo por nome)** — `refusedByAllowlist(target)` usava o jid do grupo e a allowlist tem NOMES ('🏆Production - 2026🙏🏻') → toda msg de grupo morria 'fora da allowlist'. Agora `const allowTarget = isGroupJid ? sendTarget : target;` (backup `.bak-allowtarget-20261014`, tsc OK). Era o bug do chat web-mv8hij51.
3. **Prompt do kernel reescrito** (`config/luna-prompt-config.json`, backup `.bak-whatsapp-20261014`, 6245→7161 chars): seção [WHATSAPP] agora ensina o fluxo guiado (listar → escolher → enviar) e [PROTOCOLO — CONTATO NOVO NO PRIVADO]: apresentar-se → perguntar nome → entender contexto → whatsappAllowContact → brainSaveOutcome.
4. **Caso Elias (pai do owner) — pipeline INGEST OK**:
   - Causa: allowlist tinha só "Pai" mas o match é por nome exato — o título real do chat era 'Elias Pessoal' (e o 'Elias Superclim Servicios' tinha msg não-lida visível na lista).
   - Fix: ambos adicionados nas duas allowlists (backups `.env.bak-elias-20261014`, `.env.bak-elias2-20261014`) + chat_registry. Ingest do Superclim confirmado 19:46:49 (msg "Oí luna" caiu em `messages`).

### Pendente / zona Kimi Code
- **SILENCE do FAST calou a resposta ao Elias** (handler.ts:395 — 'a mensagem não contém uma solicitação'). É DECISÃO DO MODELO (Gemini), sem env de override. Pedir à Kimi Code: prompt/gating do FAST nunca calar contato em privado allowlisted — contato não identificado = disparar o protocolo de onboarding (perguntar o nome).
- **Owner: REINICIAR O APP KIMI WORK** — automação f5c70c00 (varredura) só ativa no boot do app.
- whatsplay continua com restarts crônicos (1838) — sweep pode morrer no meio do ciclo; vale olhar a estabilidade da página WA.
- Kimi Code estava ajustando o whatsapp (watcher/browser) — conferir conflitos com os patches de allowlist/outbound antes de merge.

---

## 2026-10-14 noite — tools de providers no kernel + merge VPS↔PC + organização

### Tools dashboardConfigProvider (kernel 1ff856e)
- `packages/kernel/dashboard-providers-tools.cjs` — 5 exports: router `dashboardConfigProvider` + `dashboardListProviders` / `dashboardSetProviderKey` / `dashboardAddProvider` (preset ou custom) / `dashboardRemoveProvider`.
- Ponte com o painel :3101 `/api/config` (GET lista providers+keyStatus; POST actions save/set-key/add-provider/remove-provider). Auth opcional: se `LUNA_API_KEY` estiver no ambiente do painel, POST exige `Authorization: Bearer`.
- Painel (`apps/painel/lib/providers.ts`) aceita `role` ('conversa'|'coding'|'ambos') e `disabledReason`; campos desconhecidos viram console.warn (forward-compat, agent ad23ab1).
- BUG real encontrado no teste: painel devolve `keyStatus.configured`, a tool lia `keyStatus.present` → tudo "sem key". Corrigido (`configured ?? present`). Testado no VPS: 29 providers listados, openrouter 🔑 sk-or-•••2b3c, fcc-local 🔑 ok.
- Aliases PT no tool-alias-resolver (providers/listaproviders/rodaproviders/configproviders/addprovider/novoprovider/setkey/setapikey/salvarkey/removeprovider), categoria '⚙️ Painel — Providers & Roda' no tool-catalog.

### Instalador (agent 21d08c6)
- `scripts/install/`: install.sh (Linux) + install.ps1 (Windows, BOM UTF-8) + README com um-liners (Linux: `curl ... | bash`; Windows: `irm ... | iex`).
- Sem hardcoded: clona kernel+agent, sobe Postgres docker (porta 5433), migra, instala deps, pm2 ecosystem, build painel+kernel. Opção de importar .env + roda/providers.json + perfil Chrome WhatsApp (~/.luna/chrome-whatsapp).

### Merge VPS↔PC (o grande trabalho da noite)
- O VPS tinha ~26 arquivos modificados SEM commit (hotfixes da kimi-code feitos DIRETO no VPS: voice.call, fix grupo JID, retry com backoff no outbound, rodadas ilimitadas no investigate, progresso WhatsApp). O PC tinha commits não-puxados (painel, instalador, migração 016).
- Resolução: wip commit local (608d922) → merge (945e416) → resolução de conflito arquivo a arquivo. **Veredito em TODOS: a versão VPS era supersede** (decreto owner 14/10 "SEM LIMITES DE INTERAÇÃO" + fixes de bug ao vivo), EXCETO watchdog (só CRLF) e providers.json (só formatação).
- investigate.ts: VPS tem loop ILIMITADO por wall-clock (10min) + progresso WhatsApp (sendProgress/pickProgress) + repasse origem_conversation_id pro voice.call; origin tinha maxRounds=6 + "economia de rodadas" (versão mais velha). Ficou a do VPS.
- outbound.ts: VPS tem resolução de grupo por NOME (contact_name → chat_registry → conversations.metadata.chat_name, failed explícito sem retry) + retry com backoff (máx 4, não aplica pra bloqueio de segurança) + next_retry_at; origin tinha isGroupJid simples. Ficou a do VPS (superset).
- watcher.ts: abertura de chat pelo TÍTULO visível (decreto 14/10 19:48 — JID não indexa na busca do WA) + isSelfMsg (SELF_AUTHOR). Teste atualizado (e7cd65b): readCalls espera 'Pai'/'Fora Do Escopo', ingest continua pelo chat_id.
- live-tools.ts (voice.call): estava UNTRACKED no VPS; salvo em /tmp, merge trouxe a versão origin, voice.call re-aplicado por cima. Segue UNTRACKED (trabalho em andamento da kimi-code).
- Normalização watchdog CRLF→LF (f24fe4a). Organização da raiz do PC: 68 tmp-* + logs → tmp/ (ignorada), scripts de operação → scripts/ (vps-cp, vps-run, read-session, scorecard), e2e → tests/, tmp-LUNA_API.md → docs/LUNA_API.md (02b56bc). .membrane/ e tsbuildinfo adicionados ao .gitignore.
- Estado final: PC == VPS == origin (agent 02b56bc, kernel 1ff856e). typecheck OK em todos os apps. Testes whatsplay: 150/154 — 4 falhas, sendo 2 de voz (call-conductor captureTranscript, operator-session readLatestReply) PRÉ-EXISTENTES no origin (zona kimi-code, arquivos src/voice/* não tocados pelo merge).
- Processos reiniciados no VPS: luna-whatsplay, luna-worker, luna-watchdog (online).

### Pendências
- kimi-code: 2 testes de voz falhando no origin; voice.call ainda não commitado (untracked no VPS); SILENCE do FAST.
- Owner: reiniciar o app Kimi Work (automação f5c70c00 parada desde ontem).

---

## 2026-10-14 madrugada — listTools na FAST + call.respond (arquitetura da chamada)

### FAST WhatsApp ganha consciência das próprias tools (agent a9fc28a)
- `orchestrator/src/agent/router/tools.ts`: nova tool `listTools` + `TOOL_CATALOG` (descrição/args de todas as 18 tools: conversation.recent, client.summary, brain.search, brain.client_ficha, voice.call_place, nexo.* x12). Testada no VPS — catalogo completo volta como resultado.
- `structured.ts` (prompt da FAST): bloco LISTTOOLS no system prompt — "em dúvida de qual tool usar, chame TOOL_CALL listTools"; destaca as de WhatsApp (conversation.recent relê msgs, voice.call_place liga, brain.search acha qualquer info).
- `router.ts`: mensagem pós-tool agora permite encadear OUTRA tool (não manda parar no JSON final) — alinhado com decreto "sem tool paro tool paro". Loop segue com tope de 5 iterações (TOOL_CALL_MAX_ITERATIONS).
- Orchestrator reiniciado no VPS; typecheck OK; 27/27 testes do router passando.

### call.respond — a Luna fala na chamada via tool (kernel 2122215 + agent a9fc28a)
- Mistério do auth RESOLVIDO: o "Não autorizado" da kimi-code vinha da porta **3500** (dashboard ANTIGO server.js, que tem requireAuth). O luna-server real roda na **3458** (config.PORTS.luna) e o POST /api/chat é ABERTO (CORS permissivo, zero guard) — confirmado com POST real: `{"ok":true,"sessionId":"web-mv8lc9oe-sfuk","status":"processing"}` e roundtrip de mensagens. O adaptador do call-executor fala com 127.0.0.1:3458 SEM token.
- **Kernel** `call-response-tools.cjs`: tool `callRespond` (aliases call.respond/responderchamada/falarluna) — valida texto, `pg_notify('call_responses', {texto, origem})`. Registrada no dispatcher/catálogo (categoria '📞 Chamada — Operador'). Loader de pg com candidatos (mesmo padrão luna-tools).
- **whatsplay** `index.ts`: LISTEN call_responses → OperatorSession.connect() → ensureChatGptTab() → sendText("📟 Luna → Operador: ...") — mesmo caminho que call-conductor.ts:318 já usa em produção. No ar: log confirma "ouvindo NOTIFY call_responses".
- FALTA (próximo passo, zona kimi-code): o adaptador `LunaWebChatAdapter` no @luna/agent (fala com /api/chat da 3458) + o call-executor usar ele como conductorLive com priming do prompt ("Abner está em chamada, mando transcrições, anota no brain, responde via call.respond") + relay de captions da chamada como mensagens da sessão. Com call.respond + LISTEN prontos, a ponta de saída já está funcional.

### Estado
- PC == VPS == origin: kernel 2122215, agent a9fc28a. whatsplay + luna-web + orchestrator reiniciados e online.
- Teste de fogo do call.respond: a próxima chamada real (a sessão conductor precisa existir — hoje o KimiWebLocalAdapter antigo segue como conductor até o adaptador novo).



---

## 2026-10-14 — v14.1: fim da amnésia da Luna Web (reidratação stateless)

**Dor do owner:** a Luna Web esquecia TUDO entre mensagens (mandou o nº da namorada e na msg seguinte ela não sabia), e `brainWrite` caía em "Ferramenta desconhecida".

**Root cause (2 achados):**
1. A roda de APIs (gemini/openrouter/nvidia/github-models...) é STATELESS — a ApiBridge manda `messages:[{user: prompt}]` puro, sem thread. O follow-up/tool-loop do `_buildContext` mandava só 10 linhas de histórico e NENHUM system prompt → amnésia estrutural.
2. `systemPrompt` do loopContext nem é enviado pela bridge — só `prompt` vai no `messages[]`. Qualquer fix tem que entrar DENTRO do prompt.

**Corrigido (kernel a39c177, deploy no VPS + restart luna-web):**
- `_buildContext`: quando `options.provider !== 'kimi'` (roda), o follow-up reidrata o system COMPLETO (persona + memórias + brain + TOOL INDEX + master prompt) e carrega 30 eventos de histórico; o tool-loop leva header leve (persona + TOOL INDEX + instrução de continuar) + 12 eventos recentes.
- `tool-alias-resolver.cjs`: `brainWrite`, `escreverNoBrain`, `salvarNoBrain`, `gravarNoBrain`, `notarNoBrain`, `anotarNoBrain`, `memorizarNoBrain`, `addBrain`, `brainSave` → `brainSaveOutcome`; `lerBrain`/`brainRead` → `brainRead`; `buscarNoBrain`/`brainSearch` → `brainSearch`.
- Erro de tool desconhecida agora ensina: "Execute listTools {} ou toolInfo {name}".
- `buildToolIndex()`: categorias viram H1 nítido (`# BRAIN`, `# WHATSAPP — DIRETÓRIO & ENVIO`, `# SHELL`, `# WORKSPACE NEXO — SOLICITAÇÕES`...) — owner pediu seções BRAIN // WHATSAPP // BASH // POWERSHELL.

**Teste de fogo (passou):** POST 3458 sessão `web-teste-memoria` — msg 1: "minha namorada é Ana Paula, +34 633 34 48 34" → ela chamou `brainSaveOutcome` SOZINHA e confirmou. Msg 2 (sem nenhuma dica): "qual o nome da minha namorada e o telefone?" → **"Sua namorada é Ana Paula e o telefone dela é +34 633 34 48 34. ❤️📞"** ✅

**Estado:** PC == VPS == origin kernel a39c177. Roda com 15 providers, head `roda:github-models (gpt-4o)`.

**Próximo passo (decreto owner pendente):** desacoplar kimi hardcoded — live/fast brain/operador/Kimi Code/Kimi CLI devem participar da RODA como providers (já existe `roda:kimi-coding` na fila; falta o default do sistema deixar de ser 'kimi' e bridge-factory resolver tudo via roda). Envolver `bridge-factory.cjs` + default de `options.provider` nas rotas do dashboard.


---

## 2026-10-14 (noite) — v14.2: a RODA virou a via principal (decreto owner)

**Contexto:** owner decretou "TIRA ISSO O LIVE BRAIN, O FAST BRAIN, O OPERADOR. nada deve depender mais de uma só api. kimi code, kimi cli. NÃO! eles devem participar todos da roda de api com prompt". O `providers.json` da roda já tinha `kimi-coding` (api.kimi.com/coding/v1, openai-transport) como provider e as chaves `fastBrain: "kimi-coding"` / `liveBrain: "roda-vps"` (lidas por `packages/agent/src/roda.ts`).

**O que mudou (kernel b1342cb, deployado no VPS):**
1. **Default dinâmico** — `defaultProvider()` no luna-soul: `'roda'` quando `resolveApiRoda()` resolve ≥1 provider, `'kimi'` (CDP) só quando NENHUMA roda existe na instalação. Override: `LUNA_DEFAULT_PROVIDER`. Substitui os 9 fallbacks `options.provider || 'kimi'`. Nas rotas web, `DEFAULT_WEB_PROVIDER` ('roda') pra sessões novas e reads.
2. **Detecção stateless por ground truth** — o label da sessão podia ser 'kimi' enquanto a ponte real era RodaApiBridge. Agora `isStatelessApi` olha `bridge.canSteer() === false` (RodaApiBridge) em vez de confiar só no label. Log: `[LUNA-PROMPT] stateless-rehydrate ON kind=followUp headerBytes=20734` ✅
3. **Fixes de runtime achados no caminho:**
   - `luna_chat_sessions` NÃO existia no PG do VPS → error loop a cada save. DDL salvo em `packages/kernel/001_luna_chat_sessions.sql` e tabela criada no banco.
   - `RodaApiBridge.setPersistent()` noop — o heartbeat do painel chamava e estourava a cada ciclo.
4. **Aliases brain ampliados** (a39c177): brainWrite/escreverNoBrain/salvarNoBrain/gravarNoBrain/anotarNoBrain/memorizarNoBrain/addBrain/brainsave → brainSaveOutcome; lerBrain/brainRead → brainRead; buscarNoBrain/brainSearch → brainSearch. Erro de tool desconhecida agora ensina listTools/toolInfo.

**Testes de fogo (todos passaram):**
- Memória: msg1 "namorada Ana Paula +34..." → brainSaveOutcome sozinha; msg2 sem dica → respondeu certo.
- Cross-session: Thor salvo na sessão A; sessão B perguntou "quem é o Thor?" → ela respondeu "cachorro, mascote do Abner" (via BRAIN CONTEXT reidratado + brainSearch encadeado sozinha).
- Sessão nova nasce com provider 'roda', roda 15 providers, head github-models (gpt-4o).

**Pendências conhecidas:**
- **Busca do brain com relevância fraca** pra notas recém-gravadas (save funciona, search não ranqueia a nota nova no topo — o nexo-brain é zona da Kimi Code).
- Lado agent (`@luna/agent`): live/fast brain/operador — as chaves fastBrain/liveBrain já existem no providers.json; falta o agent consumir a roda em vez do KimiAdapter direto quando configurado. Zona Kimi Code.
- WhatsApp da Luna: Kimi Code consertou o whatsplay (DOM novo do WA Web) — msgs outbound OK; inbound é o teste de fogo restante.

**Estado:** PC == VPS == origin kernel b1342cb. luna-web no ar na 3458 com a roda completa.


---

## 2026-10-15 — Bug ao vivo: Luna calada no WhatsApp por ~11h + busca do brain impecável

**Bug do "lê e não responde" (owner: "mandei várias e ela nada"):** desde 20:33 de 14/10 toda mensagem do Abner caía em
`HUMAN_HANDLING ativo — mensagem anexada à escalación, sem resposta automática`. Causa raiz: a auto-expiração de
escalada (45 min, Kimi Code) marcava a escalation como `expired`, mas a CONVERSA ficava em `HUMAN_NOTIFIED` pra
sempre — o gate só olhava escalations ABERTAS (notified/handling), não achava nenhuma, e engolia todo inbound.
**Fix (agent 5a90228, handler.ts):** gate ativo SEM escalada aberta = estado preso → transição pra `AI_HANDLING` +
audit `escalation.stale_gate_recovered`; a mensagem corrente segue o fluxo normal. As 2 conversas presas foram
destravadas manualmente no DB.

**Busca do brain impecável (decreto owner, principal-brain 6989247 + 70586e9 + afe334c):**
- `searchAtlas`: match por INÍCIO DE PALAVRA (regex `(^|[^a-z0-9])token`) — elimina falso-positivo clássico
  "thor" casando dentro de "au-thor" (era o motivo da busca do Thor ranquear errado); substring crua vira fallback
  fraco (8 pts). Corpo inteiro de cada nota pesquisado a fundo (antes: só título/resumo). Insensível a acentos
  (NFD). Excerpt cortado em volta do match real. Bônus de frase inteira.
- **Reindexação imediata:** os 3 endpoints de escrita (`/api/learning/outcomes`, `/api/memory/notes`,
  `/api/synapses/record`) agora rodam `regenerate()` inline (~0,3s) — nota nova pesquisável NA HORA, sem esperar
  o ciclo do synapse (antes: só no dia seguinte). Compose ganhou mount vivo do `server.mjs` (mesmo padrão do `atlas/lib`).
- Teste de fogo: save "código 724" → search "724" na hora → nota no topo ✅ | search "Thor" → as 2 notas do Thor no
  topo com excerpt ✅ | "author" não polui mais o "Thor" ✅

**Pendências:** sweep do whatsplay com retry ruidoso num chat fantasma ("34999999999") — não bloqueia (deeplink
fallback funciona) mas polui log; inbound de fogo pós-fix depende de nova msg do owner. Lado agent (live/fast brain
consumindo a roda) segue zona Kimi Code — `live-tools.ts` com WIP dela (stash preservado no VPS).

## 2026-10-15 (tarde) — v14.3 do luna-kernel: README profissional + install anywhere

**Contexto:** owner vai baixar o luna-kernel no PC Linux do pai — precisava estar perfeito.

**Commits (local, já pushado pro GitHub `Jhin1v9/luna-kernel` main):**
- `06e3400` — v14.3:
  - **README.md reescrito do zero** (605 linhas): banner, arquitetura ASCII, instalação Linux one-liner /
    Windows / manual, **todas as 161 tools documentadas em tabelas** (geradas programaticamente do
    `tool-catalog.cjs` — fonte de verdade), presets gratuitos da roda, variáveis de ambiente, troubleshooting
    (incl. `pm2: command not found` do PATH do node24), estrutura do repo.
  - **db.js: auto-migração no boot** — `ensureChatTables()` com `CREATE TABLE IF NOT EXISTS luna_chat_sessions`
    fire-and-forget logo após a criação do pool. Instalação do zero nunca mais morre com
    "relation luna_chat_sessions does not exist" (era o gap do install-anywhere).
  - **install.cjs: wizard completo** — pergunta `BRAIN_INTERNAL_URL` (default :4321) + `BRAIN_API_TOKEN`,
    gera `config/providers.json` com 5 presets gratuitos (gemini prio 10, github-gpt4o 20, openrouter 30,
    nvidia-nemotron 40, **pollinations sem key** prio 90 enabled — funciona sem nenhuma key), escreve
    `LUNA_RODA_CONFIG` nos .env e adiciona `OPENROUTER_API_KEY`/`NVIDIA_API_KEY`/`GITHUB_TOKEN` comentadas.

**Decisão:** VPS NÃO foi tocado (decreto owner: "a do vps deixa lá funcionando"). O v14.3 é pra instalações
novas (PC do pai). Se quiser a auto-migração na VPS: `cd ~/luna-kernel && git pull && pm2 restart luna-server`.

**Tool index regerado via:** `node tmp-dump-tools.cjs` → `buildToolIndex()` do tool-catalog (retorna string
formatada, não array — `collectAllTools` não é exportado).

**Pendências seguem:** sweep whatsplay chat fantasma; lado agent (roda no @luna/agent) zona Kimi Code.

**Envio manual no grupo (decreto owner):** anúncio do instalador v14.3 + README entregue no grupo
"🏆Production - 2026🙏🏻" (`send_state='sent'` às 06:59 UTC). Mecânica usada: insert direto na tabela
`messages` do Postgres da VPS (conv `e88e2095…`, metadata.chat_id `120363424730639134@g.us`) +
`pg_notify('luna_outbound', id)` — o whatsplay entregou em ~24s (human-delay + navegação). Grupo já
estava na `WHATSAPP_OUTBOUND_ALLOWLIST` exata, então passou no guardrail de dev.

## 2026-10-15 (tarde 2) — v14.4 kernel + v15 agent: ponte Luna Web no FAST

**Decreto owner:** "coloca no catalogo de skills da luna pra quando ela precisar listar as tools
mostrar o msm catalogo da luna web — editar projetos, criar logins, tudo mais".

**Kernel (`730c3a7`, deployado na VPS):**
- `GET /api/luna-web-catalog` — TOOL INDEX idêntico ao do prompt da Luna Web + lista de executáveis
- `POST /api/luna-web-catalog/execute` — {tool, params} roda a MESMA função do loop da soul
- Guardrail: allowlist business-only (dashboard*/workspace*/whatsapp*/brain*/callRespond).
  Shell/arquivos/git NUNCA por HTTP. Auth: requireSystemAuth. Timeout 45s/tool.

**Agent (`808fac5`, mergeado na VPS como `751e068`):**
- `tools-luna-web.ts`: bridge HTTP pro kernel — `lunaWeb.catalog`, `lunaWeb.exec`, e
  `registerLunaWebCatalogProxies` (um proxy por tool executável, MESMOS NOMES da web)
- `listTools` do FAST agora MESCLA o índice do kernel no output
- Env: `LUNA_KERNEL_URL` (default :3458) + `LUNA_KERNEL_TOKEN` (gravado no .env da VPS =
  INTERNAL_API_TOKEN recém-criado no .env do kernel)
- Recuperados da VPS 2 arquivos WIP que o commit `608d922` referenciava sem incluir:
  `escalation-alert.ts` + `live-tools.ts` (com `pool`). typecheck 14/14, orchestrator 27/27.

**Teste de fogo na VPS (14:16 UTC):** GET catalog ok (110 executáveis, índice 10.794 chars) |
dashboardListProjects → 2 projetos ✅ | whatsappListGroups → 5 grupos ✅ | executeShell → 403 ✅ |
sem token → 401 ✅ | log: "proxies do catálogo Luna Web registrados no FAST" ✅

**⚠️ Divergência git:** a VPS tem commits locais da Kimi Code fora do origin
(`dcb500e handoff: sync`, `453d70a`, `a9fc28a`, `02b56bc`, `e7cd65b`...). O merge de hoje
(751e068) uniu origin/main no local. Próximo sync: **push da VPS ou rebase cuidadoso** —
decisão da Kimi Code. Não force nada.

**Pendências:** whatsplay ainda com 1 teste falhando no PC (`browser-reply` OperatorSession —
pré-existente, zona whatsplay); PC do pai ainda não testou o instalador v14.3.

---

## 2026-10-15 12:15 CEST — Kimi Code: "a Luna ignora o Enoque" RESOLVIDO + specs do agentic loop

**Root cause (prova em messages + audit_log):** TODOS os envios pro Enoque
morriam com `destinatário fora da allowlist`. A conversa dele resolve o alvo
pelo NÚMERO (`34689135159@s.whatsapp.net`) mas a allowlist tinha só o NOME
(`Enoque`) — name≠digits nunca casava (nem no matcher antigo endsWith, nem no
novo jidDigits). Por isso "a Luna ignora o Enoque faz eras".

**Fixes aplicados (verificados — 8 mensagens SENT 09:59-10:05 UTC):**
1. `whatsplay/src/allowlist.ts` + `outbound.ts`: `refusedByAllowlist` agora é
   async e resolve entradas-NOME da allowlist pela identidade no
   `chat_registry`/contacts (nome → dígitos do telefone) antes de recusar.
2. Seed chat_registry (formato @c.us): Enoque 34689135159@c.us, Elias Pessoal,
   Elias Superclim. **ATENÇÃO: algo no VPS reescreve o registry periodicamente
   (linhas sumiram entre inserts) — investigar o sync e persistir essas entradas.**
3. .env: `34689135159@s.whatsapp.net` adicionado na WHATSAPP_OUTBOUND_ALLOWLIST.
4. `luna-kernel/packages/kernel/luna-tools.cjs`: bug `m.created_at?.slice is not
   a function` (Date object) — dashboardGetWhatsAppHistory funcionando.

**Voice calls: PIPELINE COMPLETO E PROVADO** (chamadas reais atendidas 20:12 e
20:29 UTC de ontem). Report-back pós-chamada no chat de origem (brief.origem),
tool voice.call no live-tools, investigação wa_recent/solicitacoes na
conductora, prompt do operador com regra de satisfação + convite "fala Luna, ...".

**SPEC — agentic loop DONE marker (pra Vênus implementar no luna-soul.cjs, que
ela está editando):**
1. `buildSystemPrompt` (linha ~396): adicionar seção: "REGRA DE CONCLUSÃO:
   antes de responder, confira se o pedido foi totalmente SATISFEITO; se não,
   continue executando. Só encerre quando satisfeito; ao encerrar, termine a
   resposta com <luna_done/>. Sem o marcador, o sistema vai te mandar continuar."
2. Case `luna_response_complete` (~linha 3115): após cancelStream — se
   `fullResponse` NÃO contém `<luna_done/>` E houve tool call neste turno E
   nudges<3: strip nada, set loopInput="[CONTINUE] Verifique: o pedido já foi
   totalmente satisfeito? Se sim, reenvie a conclusão finalizando com
   <luna_done/>. Se não, CONTINUE executando (uma tool por vez).", rebuild
   context, continue. Se contém: strip o marcador do texto e encerra normal.
3. Resume-on-boot: no init do soul, sessões cujo último evento é tool/action
   sem fechamento assistant → auto-continuar com "continue o que estava fazendo".

**PRÓXIMO (ideia do owner, aprovada por arquitetura):** call brain = SESSÃO
LUNA WEB (mesmo núcleo das outras pontas): adaptador KimiLiveAdapter falando o
contrato /api/chat da 3500, sessão "conductor" primada com o decreto, tool
`call.respond` no catálogo web → pg_notify('call_responses') → whatsplay
LISTEN → chat do operador. Substitui o FallbackAdapter cego na conductora.

---

## 15/10 (tarde) — Port completo da branch superclim pro main (agent + kernel)

Pedido do owner: "ve a branch nova do principal brain, luna kernel e luna
agent, branch superclim, copia tudo que tem de diff, os extras. Lê o codex.md
e traz as mudanças positivas."

### Resultado

**luna-agent** (7 commits novos, `ea077e0..3a47b4f`):
- `d61f711` v15.1 — leva 1: contatos no painel (GET/POST/DELETE + chat_registry),
  panel-guard (mutex sweep vs envio), portabilidade (homedir/fileURLToPath em
  discover/probe/readcheck/selector-memory/voice/bridge/operator-preflight),
  apiChainAdapter preguiçoso + brain.watch no worker, escalation-tick +
  escalation-alert configurável via `LUNA_ESCALATION_CONTACT` (default Abner),
  ecosystem.superclim.config.cjs.
- `2702a9c` v15.2 — delivery fixes: health da página por `#pane-side` (meta
  noscript existe no HTML saudável também), recover por `goto(WA_URL)` em vez
  de `reload()` (reload preservava `?_fb_noscript=1` e travava no fallback),
  número direto 8-15 dígitos resolve sem JID.
- `d773e34` v15.2b — providers.ts com `RuntimeStatus`: probe local por
  provider (fcc-local→/admin/api/models, kernel→:3458/health, timeout 1.5s,
  só 127.0.0.1/localhost); card "instalado e online / local indisponível"
  no painel. Catálogo de 29 providers do main mantido (--ours).
- `2f635a8` v15.3 — painel avançado (aba "Configs avançadas da Luna",
  token = LUNA_API_KEY no sessionStorage): edição dos 3 prompts
  (whatsapp/web/caller), gestão de owner/allowlist/blocked, catálogo de tools
  por camada. Caller prompt lido do arquivo `.luna-config/caller-prompt.md`
  (sobe diretórios, cache por mtime, placeholders {{caller}}/{{contexto}}).
- `7ada13d` v15.4 — aprovação de contatos novos pelo owner: desconhecido
  gera solicitação em `contact_approval_requests`; owner responde
  `sim <id>` / `não <id>`; aprovado entra com autorização temporária e a Luna
  pede nome+telefone (tool `contact.register` exige phone com DDI nesse caso).
  **MUDANÇA DE SEMÂNTICA DO DECRETO ADR-020:** o chat_registry virou a
  autoridade de ingestão (watcher.isAllowed) — allowlist vazia NÃO bloqueia
  mais quem está registrado; ela só restringe adicionalmente. Desconhecido
  continua fail-closed e vira approval. Migrações 020 (registry owner) e 021
  (approvals) — RODAR `pnpm migrate` NA VPS E NO PC.
- `3a47b4f` — suíte de testes alinhada (registry fake no watcher, kill-switch
  `LUNA_CALLER_PROMPT=off`, mocks pane-side/goto). typecheck 14/14, unitários
  verdes exceto `operator-session > readLatestReply` (falha pré-existente,
  confirmada no commit anterior — não é regressão).

**luna-kernel** (`93eb358`): comando local `/ajuda` no /api/chat — lista os
acessos da instalação (Luna Web, Painel, Atlas, health/ready) sem chamar
provider. Neutralizado (sem "Superclim").

**Ficou de fora de propósito:** persona/identidade Superclim, remoção do
`.brain`, política registry-only do whatsapp outbound sem deeplink (na máquina
deles deeplink quebra com `_fb_noscript=1`; no VPS funciona — fix da Kimi
Code mantido), remoção do colibri-local (main tem 29 providers mais rico).

**Atenção VPS:** o luna-agent da VPS tem commits locais fora do origin (não
force-push, não puxe ainda). O deploy do port na VPS fica pra quando o owner
quiser — envolve `git pull` + resolver divergência + `pnpm migrate` (020/021).

### LEARNING_POSITIVE

```yaml
action: "Porte de branch paralela (superclim) via cherry-pick -n + resolução por união, com neutralização de marca (Superclim→Nexo) e verificação de regressão por worktree no commit pré-porte"
observed_gain: "6 commits de features maduras (aprovação de contatos, painel avançado, runtime status, health fixes do WA Web) integrados em ~1h sem quebrar o main; regressões de teste isoladas e corrigidas com mocks mínimos"
user_signal: "owner pediu explicitamente 'copia tudo que tem de diff os extras' e 'traz as mudanças positivas' — a branch white-label provou ser laboratório de features que valem pro produto principal"
repeat_when: "houver branch paralela white-label ou experimental com commits à frente do main e pedido de port"
do_more_of: "sempre que portar, procurar resíduos de marca com grep antes do commit final; comparar suíte de testes pré/pós via worktree pra separar regressão de falha pré-existente; documentar mudança de semântica de decreto (ADR-020) no HANDOFF"
```

---

## 15/10 (fim da tarde) — Modo GOAL (decreto owner: "API stateless executa e morre")

Idea do owner: classificar o GOAL de cada mensagem; live brain segura a missão
enquanto fast brain executa; API só "dorme" quando o goal fecha.

**Implementado no kernel (`e3ba552`, pushed):**
- `apps/dashboard/luna-goal.js` — orquestrador do LADO DE FORA do soul (Vênus
  segue livre no luna-soul.cjs). Fluxo:
  1. **Classificador** (1 chamada barata, provider 'roda'): devolve JSON
     {goal, type: responder|agir, done_criteria, resumo}. Falhou → goal
     genérico (não trava o usuário).
  2. **Goal trivial** (responder): 1 turno normal e acabou.
  3. **Loop de missão** (até `LUNA_GOAL_MAX_TURNS`, default 8): cada turno é um
     turno normal de processMessageStream com `skipUserEventStorage` — o prompt
     da missão carrega JÁ FEITO/AINDA FALTA embarcado (é assim que a API
     stateless "lembra": o contexto viaja em cada chamada; as respostas de cada
     turno entram no histórico persistido). Conclusão = marcador `<goal_done/>`
     na resposta (mesmo padrão do `<luna_done/>` que a Vênus está colocando no
     soul). Turno que falha (API caiu) vira progresso e o loop reenvia com o
     erro no contexto — é o "live brain re-prompta a API parada".
  4. **Teto atingido**: turno de síntese final (traz o que conseguiu/faltou).
- `luna-chat-routes.js`: `mode: 'goal'` aceito na API + comando local
  `/goal <pedido>`. O soul recebe 'thinking' (goal é modo de orquestração, não
  de soul). Cancelamento entre turnos respeita myStreamMeta.
- Estado do goal fica em `session.goal` (diagnóstico, sobrevive no
  sessions.json). Smoke test cobrindo: parse do comando, classificação
  tolerante, loop completo com goal_done no turno 2, timeout no teto com
  síntese, goal trivial.

**Próximos passos naturais (v2, quando o whatsplay estabilizar):**
- Gatilho automático: toda msg do WhatsApp/grupo passa pelo classificador; se
  type=agir → encaminha pro modo goal sem o usuário precisar do /goal.
- Classificador no provider liveBrain e executor no fastBrain (distinção
  explícita das camadas, como o owner desenhou).
- Expor o progresso do goal em evento dedicado ('goal_start'/'goal_progress')
  em vez de 'system', com renderização própria no frontend.
