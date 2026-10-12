# PLANO FUSÃO API — kernel Luna com fast-brain via APIs grátis

> Documento-mãe da Fase 1 da fusão. Contexto consolidado em 2026-10-12.
> **Como usar num chat novo (Kimi Code, Codex, eu):** cole este arquivo inteiro e diga
> "execute o PLANO FUSÃO API da fase X". Os repos são github.com/Jhin1v9/luna-kernel
> (público) e github.com/Jhin1v9/luna-agent (público).

---

## 1. CONTEXTO (o que o agente precisa saber)

- **Dono:** Abner (Nexo Digital). Máquina: Windows 10, Xeon E5-2697A v4, 32 GB RAM,
  RX 580 8GB. LLM local: colibri (http://127.0.0.1:8000/v1) rodando qwen3-coder-30b-a3b.
- **luna-kernel** (repo): a Luna que conversa e opera o PC. Hoje o cérebro dela chega
  via `kimi-bridge.cjs` = Playwright/CDP no Kimi Web (frágil: DOM, login, anti-bot).
  Existe uma refatoração LOCAL com `packages/kernel/luna-web` (Svelte) + protocolo
  `<tool_calling>` que **não está no GitHub** (FASE 0 = push obrigatório).
- **luna-agent** (repo): orchestrator/worker/Postgres/event-bus. JÁ tem o padrão
  multi-provider no `KimiAdapter` (ADR-039: FAST Kimi API→Gemini; LIVE Kimi CLI→Pi/NIM).
  Painel Next.js (:3101) com página "Cérebro/Modo" que escreve no .env de forma atômica
  — é o padrão da página de config do kernel.
- **Kimi Code** (CLI @moonshot-ai): instalado global, roda como `luna-kimiweb` (web :58629).
- Assinatura Kimi Code **encerrada** — CDP no Kimi Web é o caminho que está morrendo.

## 2. OBJETIVO

Substituir Playwright/CDP como transporte principal do kernel por **APIs grátis
OpenAI-compatible com fallback chain**, mantendo CDP como última rede de segurança:

```
pedido → api-bridge.cjs
            ├─ NVIDIA NIM   (grátis, oficial)  ─ 429/5xx?
            ├─ Groq         (grátis, oficial)  ─ 429/5xx?
            ├─ Gemini API   (grátis, oficial)  ─ 429/5xx?
            ├─ OpenRouter :free               ─ 429/5xx?
            ├─ localhost-multi-ai*            ─ 429/5xx?   (*relay grátis do GH, se OpenAI-compatible)
            └─ kimi-bridge CDP (legado)       ← última rede
```

*localhost-multi-ai = aquele repo estilo "claude-free" que o Abner viu: abre navegador
em localhost com Grok/várias IAs. Só entra na corrente se expuser endpoint OpenAI-like.
Instável/ToS → bônus, nunca dependência.

## 3. ARQUITETURA

### 3.1 api-bridge.cjs (NOVO, ~300 linhas)
- Implementa a MESMA interface que o soul já consome:
  `connect()`, `sendMessage()`, `sendMessageStream()` yieldando
  `{type: thinking_delta|response_delta|action_detected|done|context_limit}`,
  `newChat()`, `cancelStream()`, `canSteer()` (API → false).
- POST `{baseUrl}/chat/completions` stream:true; map:
  `delta.reasoning_content`→thinking_delta · `delta.content`→response_delta ·
  `delta.tool_calls`→action_detected (estruturado!) · fim→done.
- Retry 3x exponencial; timeout 10min (exceção justificada no ADR);
  rotação de provider em 429/5xx com cooldown por provider.

### 3.2 providers.json (config, editável pela UI)
```json
[
  { "id": "nvidia",  "baseUrl": "https://integrate.api.nvidia.com/v1",
    "apiKeyEnv": "NVIDIA_API_KEY", "model": "qwen/qwen3-coder-480b-a35b-instruct",
    "priority": 1, "enabled": true },
  { "id": "groq",    "baseUrl": "https://api.groq.com/openai/v1",
    "apiKeyEnv": "GROQ_API_KEY", "model": "llama-3.3-70b-versatile",
    "priority": 2, "enabled": true },
  { "id": "gemini",  "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "apiKeyEnv": "GEMINI_API_KEY", "model": "gemini-2.5-flash",
    "priority": 3, "enabled": true },
  { "id": "openrouter", "baseUrl": "https://openrouter.ai/api/v1",
    "apiKeyEnv": "OPENROUTER_API_KEY", "model": "deepseek/deepseek-chat-v3-0324:free",
    "priority": 4, "enabled": true }
]
```
O localhost-multi-ai entra como entrada extra com baseUrl=http://127.0.0.1:<porta>/v1.

### 3.3 bridge-factory.cjs
Provider config tem `transport: "api"` → ApiBridge; senão → KimiBridge (CDP).
Seleção por env `LUNA_TRANSPORT=api|cdp|auto` (auto = API primeiro, cai pro CDP).

### 3.4 Página de Config real (kernel)
Mesmo padrão da página "Cérebro/Modo" do painel do agent:
- lista providers com toggle ligado/desligado, ordem (priority)
- campo pra colar API key → grava no `.env` do kernel com escrita atômica
  (tmp + rename, igual ao envSet que já existe no agent)
- botão "testar" por provider (GET /models ou 1-token completion)
- mostrar status da corrente (qual provider ativo, cooldowns)

## 4. FASES

### FASE 0 — Versionar o kernel refatorado (GATE, sem isso nada anda)
1. [ ] No PC do Abner, na pasta do kernel com `packages/`: `git remote -v`,
     `git status`, `git branch -a` — descobrir por que `packages/kernel/luna-web`
     dá 404 no GitHub (não pushed? outro remote? outra branch?)
2. [ ] Push do packages/ + interface Svelte pro GitHub
3. [ ] AGENTE (Kimi Code/IA): ler packages/kernel do repo e mapear a interface
     real do soul refatorado (protocolo <tool_calling>, estrutura de pacotes)
     ANTES de escrever qualquer bridge

### FASE 1 — api-bridge.cjs (MVP)
1. [ ] providers.json com NVIDIA NIM (key: build.nvidia.com → NVIDIA_API_KEY no .env)
2. [ ] api-bridge.cjs + bridge-factory.cjs; v1 mantém protocolo de texto do soul
3. [ ] Teste: `LUNA_TRANSPORT=api node luna-cli.cjs` → mesmas tools, sem Chrome
4. [ ] Definition of done: writeFile/executeShell executam com ToolGuard, dashboard
     mostra tools, zero intervenção de CDP

### FASE 2 — Fallback chain + tool-calling nativo
1. [ ] Adicionar Groq/Gemini/OpenRouter ao providers.json (keys no .env)
2. [ ] Rotação automática (429→próximo, cooldown 60s, marca provider esgotado)
3. [ ] Tool-calling nativo (tools:[] OpenAI) → action_detected estruturado;
      parser JSON vira fallback só pro CDP
4. [ ] localhost-multi-ai: se o Abner achar o repo dele e o endpoint for
     OpenAI-compatible, adicionar como provider priority 5 (enabled:false até testar)

### FASE 3 — Config page real
1. [ ] Página "⚙️ API Providers" no painel (padrão Cérebro/Modo): toggles,
       ordem, colar keys → .env atômico, botão testar
2. [ ] Status da corrente visível (provider ativo, cooldowns, último erro)

### FASE 4 — Consolidação
1. [ ] Comparativo CDP vs API (qualidade de resposta, tok/s, custo zero)
2. [ ] Decisão documentada em ADR: CDP vira legado/fallback-of-fallback
3. [ ] Kimi Code CLI segue como live brain (HANDOFF já existe no agent)
4. [ ] colibri permanece como fallback 100% offline

## 5. REGRAS

1. Escrita no .env: sempre tmp+rename atômico (padrão do agent)
2. Secrets: só por env, nunca em log/commit (pino redaction já existe no agent)
3. CDP não morre: fica como último provider da corrente
4. Relays grátis não-oficiais: never a dependency, sempre enabled:false até teste
5. Um bridge, N providers: tudo OpenAI-compatible, zero código por provider extra
6. Sem a FASE 0 (push), nenhuma fase seguinte começa

## 6. PENDÊNCIAS (Abner)

- [ ] Rodar os 4 comandos git no kernel local e colar a saída
- [ ] Criar NVIDIA_API_KEY em build.nvidia.com e colocar no .env
- [ ] (Opcional) Achar o repo do "localhost multi-IA" e confirmar se tem endpoint OpenAI
- [ ] Groq + Gemini keys (1 min cada, grátis)

## 7. COMO RETOMAR

Cole este arquivo + diga: "PLANO FUSÃO API, fase X". O agente deve ler o plano
e o repo ANTES de escrever código. Estado atual: FASE 0.

---

## 8. ESTADO 2026-10-12 (sessão Kimi Code)

- **Roda de providers (config/providers.json no luna-agent, editável pelo painel ⚙️ Configurações):**
  rotação por priority, tudo grátis: 1 pollinations (sem key) → 2 gemini → 3 kimi-coding → 4 open-webui (hub local, docker 127.0.0.1:3000, hospeda pollinations+colibri) → 5 github-models → 6 fcc-local (FCC :8082, NVIDIA) → 7..12 cerebras/sambanova/mistral/together/zai-glm (presets, ligar ao criar key) → 99 colibri (offline).
- **FCC:** instalado via uv (free-claude-code), Admin :8082, MODEL=nvidia_nim/moonshotai/kimi-k3, MODEL_FALLBACKS=[nemotron-3-super-120b-a12b, deepseek-v4.1-flash]. Endpoint Anthropic /v1/messages (sem /chat/completions).
- **Open WebUI:** docker open-webui :3000, admin luna@nexo.local, API key em OPENWEBUI_API_KEY, OpenAI-compat em /api/v1.
- **Regra de arquitetura (owner):** modelos CONVERSACIONAIS executam tools via luna kernel (protocolo [[action]] em texto — não dependem de tool calling nativo). LIVE brain usa o kernel quando o modelo não tem tool calling. FAST brain: se não conseguir falar com o LIVE ("pergunto pro live brain" → sem resposta), ele MESMO executa ("olhei e respondi") — degradação em 2 níveis, nunca falha silencioso.
- **Pending:** FccAdapter no worker (LIVE via FCC de verdade), api-bridge no kernel (Fase 1), wiring roda no runtime do agent.
