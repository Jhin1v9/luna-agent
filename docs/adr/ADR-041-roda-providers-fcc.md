# ADR-041 — Roda de providers + FCC local: fim da dependência da assinatura Kimi

Data: 2026-10-12
Status: aceito

## Contexto

A assinatura Kimi (Coding Plan) encerrou e a quota restante já matou o
cérebro da Luna mais de uma vez (evidência ADR-039: `403 weekly usage
limit` no meio de incidente real, eventos de cliente no DLQ). O diagnóstico
do estado atual:

- O FAST brain depende de UMA família de credenciais Kimi (+ reserva
  Gemini) configuradas à mão no `.env` — trocar de provider em emergência
  é edição de env + restart, com espaço pra erro (o `.env` já chegou a
  ficar com o primário invertido por emergência, ADR-039).
- O painel já edita `config/providers.json` da raiz do repo — uma "roda" de
  providers com `id, label, transport, baseUrl, apiKeyEnv, model, models[],
  enabled, priority` — mas o runtime NÃO a consumia: era só documento pro
  painel.
- Existe FCC rodando local em `http://127.0.0.1:8082`: gateway com
  catálogo de providers, API **Anthropic-style** (`POST /v1/messages`,
  header `anthropic-version: 2023-06-01`) — **sem** `/chat/completions.
  Sem auth por default.
- Hoje existe um estoque de APIs OpenAI-compatible grátis ou baratas
  (Gemini, Groq, OpenRouter, GitHub Models, NVIDIA NIM, xAI…) e de
  gateways locais (FCC, Colibri, luna-kernel) — dispersos, sem política
  de uso no runtime.

## Decisão

### Contrato único: `config/providers.json` (editado pelo painel)

- A roda é o ÚNICO lugar onde providers são cadastrados/removidos/reordenados.
  O runtime lê o arquivo; o painel grava. Zero deploy pra trocar a rota.
- `apiKeyEnv` guarda apenas o NOME da env var (nunca o valor) — secrets
  continuam só no `.env`/ambiente (§21; pino redige `apiKey`/`authorization`
  em qualquer profundidade). `apiKeyEnv: null` = provider sem
  Authorization header (gateways locais).
- `transport: 'fcc-local'` e `'anthropic'` existem no schema mas a roda do
  FAST (`RodaAdapter`) filtra `enabled === true && transport === 'openai'`
  e ordena por `priority` (menor = tenta primeiro).

### FAST brain — `RodaAdapter` (opt-in)

- `KIMI_ADAPTER_MODE=roda` ativa o `RodaAdapter` no `createAdapter` do
  `@luna/agent` (orchestrator, worker, whatsplay e watchdog passam a
  consumir a roda sem wiring próprio — todos programam contra
  `KimiLiveAdapter`/`TurnResult`). `LLM_PROVIDER=roda` existe no enum para
  ferramentas que distinguem a família do provider.
- **Default inalterado (`kimi-api` com FallbackAdapter):** a roda é opt-in
  até validação em produção.
- Por provider da roda: `POST {baseUrl}/chat/completions` (mesmo shape do
  `OpenAiCompatAdapter`, `temperature 0`, sem tools), retry 2x, timeout
  60s. Key ausente no env = provider **pulado com log** (não é falha de
  rede, não entra em cooldown).
- Herdado do espírito do ADR-039 — **nunca falha em silêncio**: falha
  (rede/429/5xx) → cooldown de 60s em memória por provider + log
  estruturado `roda: <id> falhou (<causa resumida, SEM key>) → próximo:
  <id>`. Todos falhando = erro explícito com as causas acumuladas
  (200 chars cada, sanitizadas).
- `TurnResult.provider` recebe o `id` real do provider da roda — custo por
  provider separado em `usage_entries` (§9).

### LIVE brain — `FccAdapter`

- `LIVE_BRAIN_PROVIDER=fcc` troca o cérebro vivo (HANDOFF_LIVE + canal
  admin) para o FCC local. Mesma interface estável — o worker troca sem
  tocar em investigate/admin (mesma convenção do `pi`, ADR-039).
- `FccAdapter` fala Anthropic-style: `POST http://127.0.0.1:8082/v1/messages`
  com `anthropic-version: 2023-06-01`, `{ model, max_tokens: 4096,
  messages }`. Modelo default `nvidia_nim/moonshotai/kimi-k3` (override
  `FCC_MODEL`), timeout 5 min (turnos de investigação).
- Stateless por turno: `ensureSession` devolve sessão fixa, `readMessages`
  vazio (documentado, mesmo contrato do pi/kimi-cli).
- 401 = falha explícita pedindo pra checar o FCC (auth ligada no gateway é
  ação humana). Sem 401: sem Authorization header.

## Consequências

- **Secrets continuam só por env** — o JSON da roda nunca carrega valor de
  key; causa de erro é sempre sanitizada antes de logar.
- **O FCC não tem `/chat/completions`** — qualquer provider `fcc-local` na
  roda do FAST é ignorado pelo filtro openai; a rota LIVE usa o
  `FccAdapter` dedicado (Anthropic-style). Não misturar os dois shapes.
- **NIM é lento** (fila da NVIDIA) — fica como backup de prioridade alta
  (número alto), não como primário; a roda existe justamente pra não
  depender dele.
- Cooldown de 60s é em memória e por processo — restart zera (aceito:
  protege contra elo morto sem estado externo).
- Com `KIMI_ADAPTER_MODE=roda`, o FallbackAdapter Kimi→Gemini fica fora do
  caminho do FAST: a redundância passa a ser a própria roda (N providers
  em vez de 2 elos). Validar antes de virar default.

## Verificação

- 7 testes unitários do `RodaAdapter` + 6 do `FccAdapter` (mock de fetch):
  escolha por priority, Authorization pelo `apiKeyEnv`, skip de key ausente
  com log, cooldown após falha, erro acumulado sem secrets, config
  ausente → falha pedindo o painel, mapeamento Anthropic e 401 explícito.
- `pnpm test` (packages/agent: 74 testes) e `pnpm typecheck` passando.
