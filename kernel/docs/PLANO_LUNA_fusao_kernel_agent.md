# PLANO LUNA — Fusão kernel × agent (monorepo + dual brain + modo API)

> Documento-mãe da fusão. Escrito em 2026-10-11 a partir da leitura dos repos
> públicos Jhin1v9/luna-kernel e Jhin1v9/luna-agent (AGENTS.md) + brain (ORQUESTRADOR.md,
> OPERACAO_AGENTES.md) + setup colibri local do Abner.
> **Como continuar num chat novo:** cole este arquivo inteiro + o AGENTS.md do luna-agent
> e peça "continue o PLANO LUNA da fase X".

---

## 1. CONTEXTO (por que isso existe)

- Assinatura Kimi Code **encerrada**. Hoje o Abner opera com:
  - **Venus** (modelo local via colibri) passando pelo Aider → erra, manda tools como
    texto no chat em vez de executar.
  - **colibri + qwen3-coder-30b-a3b** rodando local (CPU ~1,5–3 tok/s; RX 580 Vulkan
    gera saída corrompida — sem Resizable BAR, caminho não-medido).
- Problema raiz: Aider depende de tool-calling nativo do modelo; modelo pequeno erra.
  A **luna-kernel já resolveu isso de outro jeito**: `luna-soul.cjs` detecta ação,
  executa e não envia texto (`_handleAction`, parseTagResponse, ToolGuard).
- Ideia-mãe: **fundir as duas Lunas num monorepo**, sem misturar código:
  cada Luna com suas próprias tools, um **cérebro individual** e um **cérebro compartilhado**,
  e ela sabendo quem é (IDENTITY) e que tem os dois cérebros.

## 2. ARQUITETURA ALVO

```
luna/                                ← monorepo único (pnpm workspaces, TS strict no agent,
│                                       kernel .cjs preservado na Fase 1 — "Simple Until
│                                       Complexity Is Earned" AGENTS.md regra 1)
├── apps/
│   ├── web/                         ← kernel: interface Svelte (porta 3458)
│   ├── telegram/                    ← kernel: adapter @lunanexobot
│   ├── orchestrator/                ← agent: HTTP + event bus/outbox (porta 3100)
│   └── worker/                      ← agent: poll jobs + reaper de locks
├── packages/
│   ├── soul/                        ← IDENTITY.md + system prompt builder (quem ela é)
│   ├── brain-local/                 ← CÉREBRO INDIVIDUAL: sessões/memória (Postgres do agent)
│   ├── brain-shared/                ← CÉREBRO COMPARTILHADO: client do principal-brain
│   │                                   (sync, BLS, 8 personalidades, ORQUESTRADOR.md)
│   ├── kernel-core/                 ← luna-kernel como pacote (soul, kimi-bridge, tools, guard)
│   ├── agent-core/                  ← KimiAdapter → vira ProviderAdapter (Kimi/NVIDIA/local)
│   ├── events/                      ← Event Envelope universal (createEvent/validateEvent)
│   ├── database/                    ← pg pool, migrator, outbox, DLQ, idempotency
│   ├── tools/                       ← writeFile/executeShell/tool-guard como SCHEMAS OpenAI
│   ├── api-bridge/                  ← NOVO: transporte OpenAI-compatible (NVIDIA NIM etc.)
│   └── logging/                     ← pino com redaction de secrets (§21)
└── brain/                           ← instância do principal-brain (versionada!)
```

### 2.1 Papel de cada cérebro

| | FAST BRAIN | LIVE BRAIN |
|---|---|---|
| Quem | `luna-agent` orchestrator | `luna-kernel` (operadora do PC) |
| Transporte | **API NVIDIA NIM** (tool calling nativo) | **API NVIDIA NIM** (tool calling nativo) + CDP legado |
| Função | pensamento estratégico, roteamento, jobs, consenso | execução: shell, arquivos, browser, validação, visualização |
| Tools | `send_to_live_brain` (MAMIS/1 via evento), consultar brain-shared, criar jobs | tools do kernel COM ToolGuard + schemas OpenAI nativos |
| Memória | brain-local (Postgres `events`, sessões) | brain-local (SessionManager JSONL → migrar pra events) |
| Fallback | colibri local (Venus/qwen30b) quando offline | modo CDP legado do kimi-bridge |

### 2.2 O protocolo fast↔live (MAMIS/1, já definido no brain)

```
MAMIS/1
ROLE: LIVE-BRAIN (kernel @ Abner-PC)
GOAL: executar patch delimitado no projeto X
SCOPE: packages/database + apps/worker
INPUTS: diff proposto + testes esperados
OUTPUT: resultado dos testes + arquivos alterados
DONE: typecheck + pnpm test:unit verdes
RISK: modelos 30B — VERIFIER revisa tipos complexos
```

Entrega via Event Envelope universal (`createEvent`, `EventBus.publish` grava
`events`+`outbox`+idempotency key na MESMA transação — regra 6 do AGENTS.md).

### 2.3 Contrato de identidade (packages/soul/IDENTITY.md)

```markdown
# LUNA — CTO da Nexo Digital
Eu sou a Luna. Membro da equipe Nexo, opero via kernel (web/telegram) e agent (orchestrator).
Tenho DOIS cérebros:
1. MEU (brain-local): minha memória de sessões, decisões que EU tomei, histórico com a equipe.
2. COMPARTILHADO (brain-shared): padrões, anti-patterns, personalidades, conhecimento de
   domínio de TODA a equipe (CODEX, KIMI, eu).
Regra: antes de agir, consulto o ORQUESTRADOR do cérebro compartilhado.
Depois de agir, registro no brain-local e disparo brain:sync:principal.
Nunca escrevo no compartilhado sem consenso (protocolo do ORQUESTRADOR.md).
```

## 3. O QUE JÁ FOI VERIFICADO NOS REPOS (leitura real)

### luna-kernel (v5.x, arquivos na raiz)
- `README.md`: Web + Telegram + Kimi Bridge; Node puro `.cjs`; WebBridge primário porta 10086;
  perfil Chrome persistente; Playwright CDP.
- `kimi-bridge.cjs` (~2.500 linhas): interceptação CDP Fetch domain, parse SSE, snapshot-diff,
  modos instant/thinking/agent/swarm, **já importa `getProviderApiPatterns` do provider-loader**
  (gancho de API já previsto), auto-login Google, gestão de cookies.
- `luna-soul.cjs`: loop msg→context→bridge→parse→`_handleAction`→resposta;
  `parseKimiResponse` com 8 estratégias + jsonrepair (parser é transport-agnostic);
  ToolGuard + path validation + secret scrubbing; ProjectHealthValidator (screenshot);
  META mode, PLAN mode read-only, SUGGEST; smart compaction com checkpoint (limite do
  thread do Kimi Web); SessionManager JSONL; EventBus interno; TurnManager;
  protocolo de tools: code blocks JSON `{"response"|"tool"|"script"}` e tags `[[action]]`.
- **Interface pública do bridge** (o que um `ApiBridge` precisa implementar):
  `connect()`, `disconnect()`, `sendMessage()`, `sendMessageStream()` yieldando
  `{type: thinking_delta|response_delta|action_detected|done|context_limit,...}`,
  `newChat()`, `cancelStream()`, `recoverSession()` (noop ok), `canSteer()` (API → false).

### luna-agent (v3, via AGENTS.md enviado pelo Abner)
- Node 24 · TS strict · pnpm workspaces · PostgreSQL 16 (pg puro) · pino · zod · vitest.
- Porta 3100; `/health` `/ready` `/metrics`; migrator; outbox; DLQ; idempotency; audit.
- `packages/agent`: KimiAdapter (interface estável + mock + kimi-web REST) → **renomear
  ProviderAdapter**, adicionar transporte NVIDIA.
- **ADR-015**: kimi web REST verificada; sendTurn WS experimental ficou em modo mock.
- Regras-chave: secrets nunca em logs (redaction de authorization/password/token/apiKey/
  secret/cookie); config só via env validada com zod; migrações append-only; commits em
  português curtos.

### principal-brain
- `ORQUESTRADOR.md`: CODEX+KIMI principais; BLS (patterns/anti-patterns/decisions);
  catálogo de subagentes WEB_SCOUT/CODE_SCOUT/SURGEON/VERIFIER/REVIEWER/SYNTHESIZER;
  **"Execução real de subagentes: 🔴 Não implementado"**; comunicação MAMIS/1.
- ⚠️ `.brain/` (learning, memory, knowledge) **não está commitado** — BLS local só na
  máquina do Abner. Fase 0 inclui versionar.
- ⚠️ `PLANO_ESTRATEGICO.md` amarrado ao TPV Sorveteria — desatualizado vs. Luna.

### Infra local do Abner
- colibri: `http://127.0.0.1:8000/v1` (OpenAI-compatible), modelo `qwen3-coder-30b-a3b-colibri`,
  ~19 GB em `C:\colibri-models`. Xeon E5-2697A v4 (16c/32t), 32 GB RAM, RX 580 8 GB
  (Vulkan → saída corrompida; usar CPU). ~1,5–3 tok/s.
- Aider: `aider --model openai/<modelo> --openai-api-base http://127.0.0.1:8000/v1`.

## 4. FASES

### FASE 0 — Preparação (1 sessão)
1. [ ] Versionar `.brain/` no principal-brain (patterns.json, decisions.md, sessions/)
2. [ ] Abner envia docs locais do kernel que não estão no repo (GUIA humano, AGENTS.md do kernel)
3. [ ] Criar `docs/adr/ADR-016-modulo-api-nvidia.md` no luna-agent (modo API é decisão de arquitetura)
4. [ ] NVIDIA API key: conta em build.nvidia.com → key em `.env` (NVIDIA_API_KEY), nunca commitar
5. [ ] Confirmar modelo NVIDIA alvo (sugestão: `qwen/qwen3-coder-480b-a35b-instruct` p/ execução,
       `deepseek-ai/deepseek-r1` p/ raciocínio)

### FASE 1 — Modo API no kernel (resolve "tools no chat") ✅ ALTA PRIORIDADE
O Venus/qwen30b "manda tools como texto" porque o Aider depende de tool-calling nativo.
No kernel isso é resolvido pela camada de ação — mas com API **nativa** fica perfeito:
1. [ ] `api-bridge.cjs`: implementa a interface do bridge via POST `{baseUrl}/chat/completions`
       (stream SSE). Map: `delta.reasoning_content`→thinking_delta, `delta.content`→response_delta,
       `delta.tool_calls`→action_detected (estruturado!), fim→done.
       Retry 3x exponencial em 429/5xx. Timeout 10 min (exceção à regra "sem timeout",
       justificada no ADR).
2. [ ] `bridge-factory.cjs`: se provider config tem `api.baseUrl`+`apiKeyEnv` → ApiBridge,
       senão KimiBridge (CDP). Seleção: campo `transport: "api"|"cdp"` no provider JSON.
3. [ ] `providers/nvidia.json`: transport api, baseUrl `https://integrate.api.nvidia.com/v1`,
       modelos acima.
4. [ ] V1 mantém o protocolo JSON-em-texto do soul (zero mudança no orquestrador);
       V2 liga tool-calling nativo (Fase 2).
5. [ ] Teste: `node luna-cli.cjs` com LUNA_TRANSPORT=api → mesmas tools, sem DOM, sem login.

**Definition of done:** kernel responde, executa writeFile/executeShell com ToolGuard ativo,
dashboard mostra tools bonitinho, zero干预ção de Chrome/CDP.

### FASE 2 — Tool-calling nativo + registry compartilhado
1. [ ] Extrair schemas OpenAI das tools do `luna-tools.cjs` (60+ tools) → `packages/tools/`
2. [ ] ToolGuard vira wrapper de execução (path validation, secret scrubbing, confirmação)
3. [ ] Kernel: enviar `tools: [...]` na request; mapear `delta.tool_calls` → `_handleAction`
       direto (parser JSON vira fallback p/ modo CDP)
4. [ ] Agent: `ProviderAdapter` genérico (Kimi REST / NVIDIA / colibri local) — ADR-015 atualizado
5. [ ] Fallback chain: NVIDIA → OpenRouter free → colibri local (offline) → Kimi Web CDP

### FASE 3 — Monorepo (sem misturar)
1. [ ] `pnpm-workspace.yaml`; mover luna-agent → `apps/orchestrator`+`apps/worker`+`packages/*`
2. [ ] Mover luna-kernel → `apps/web`, `apps/telegram`, `packages/kernel-core`
       (preservar history: `git subtree add` ou `git filter-repo`)
3. [ ] AGENTS.md na raiz unificando as regras (as 7 regras do v3 + regras do kernel)
4. [ ] Orchestrator e kernel se falando via EventBus (não import direto)

### FASE 4 — Dual brain + identidade
1. [ ] `packages/soul/IDENTITY.md` (§2.3) carregado em TODO system prompt
2. [ ] `packages/brain-shared`: sync com principal-brain (git pull do .brain versionado)
3. [ ] `packages/brain-local`: tabela `memory` (sessões, decisões, preferências da Luna)
4. [ ] Tool `send_to_live_brain` (fast→live) e `report_to_fast_brain` (live→fast) via MAMIS/1
5. [ ] Registrar `LOCAL_CODER` (colibri/Venus) no SUBAGENT_REGISTRY do brain como
       `SURGEON-local` — sinapse que falta hoje
6. [ ] Subir docs: ORQUESTRADOR atualizado (Luna entra como operadora), PLANO_ESTRATEGICO
       desvinculado do TPV

### FASE 5 — Qualidade de vida
- [ ] Dashboard unificado (health do orchestrator + status do kernel + custo/tokens NVIDIA)
- [ ] Métricas Prometheus das chamadas de API (custos, latência, 429s)
- [ ] Upgrade futuro: RTX 5060 Ti 16GB → roda 30B local rápido; 3090 usada disparou de preço
      (€850–1000 em out/2026) — fora de cogitação
- [ ] Testes de integração: fast brain delegando job pro live brain (vitest + Postgres luna_test)

## 5. REGRAS INEGOCIÁVEIS (de todos os docs lidos)

1. Secrets nunca em logs/env commitado — redaction pino (§21) + zod loadConfig
2. Event Envelope universal p/ todo evento; publish na mesma tx (events+outbox+idempotency)
3. Migrações append-only; nunca editar aplicada
4. Simple Until Complexity Is Earned — cola = tabela jobs + worker
5. Default single-agent; subagente só com gatilho real (OPERACAO_AGENTES.md)
6. Brain compartilhado: escrita só via consenso/sync; brain-local: append-only por sessão
7. Commits em português, curtos
8. Cérebro compartilhado SEMPRE versionado (lição da Fase 0)

## 6. DECISÕES PENDENTES (Abner)

- [ ] Modelo NVIDIA definitivo (coder vs r1 vs híbrido por tarefa?)
- [ ] O "Venus" é qual checkpoint/arquitetura exatamente? (docs locais do kernel)
- [ ] Telegram continua no kernel ou migra pra `packages/channels` do agent?
- [ ] GPU nova entra quando? (muda prioridade do fallback local)
- [ ] O luna-agent no GitHub é privado (404) — manter privado ou abrir?

## 7. COMO RETOMAR ESTE PLANO NUM CHAT NOVO

Cole: este arquivo + `AGENTS.md` do luna-agent + `ORQUESTRADOR.md` do brain e diga:
> "Continue o PLANO LUNA. Estamos na Fase __. Os repos são
> github.com/Jhin1v9/luna-kernel e github.com/Jhin1v9/luna-agent (privado)."
A IA deve ler este plano ANTES de propor código.

---
*Status: Fase 0–1 em aberto. Próxima ação concreta: Fase 1, item 1 (api-bridge.cjs).*
