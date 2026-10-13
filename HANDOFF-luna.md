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
