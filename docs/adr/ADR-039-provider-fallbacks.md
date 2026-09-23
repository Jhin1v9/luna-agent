# ADR-039 — Fallbacks de provider: nunca mais offline por quota

Data: 2026-09-23
Status: aceito

## Contexto

A quota semanal da conta Kimi (Coding Plan) esgotou e matou o cérebro da
Luna no meio de um incidente real: o `pi` CLI do operador respondeu
`403 weekly usage limit` (evidência ao vivo 2026-09-23). Diagnóstico do
estado do repo na ocasião:

- `FallbackAdapter` (Kimi→Gemini) já existia e o orchestrator já o usava —
  mas só no orchestrator; worker (classify/summarize), whatsplay (auto-
  reparo) e watchdog usavam `KimiApiAdapter` puro.
- O `.env` estava com o primário INVERTIDO (gemini como LLM_*) porque a
  quota da Kimi tinha caído antes — configuração de emergência manual.
- O modelo Gemini configurado (`gemini-3-flash`) não existia mais na API
  (404; `gemini-2.5-flash` foi descontinuado para usuários novos) — o
  modelo válido é **`gemini-3.6-flash`** (validado com curl ao vivo).
- O live brain (HANDOFF_LIVE + canal admin) só tinha o Kimi CLI — sem
  reserva nenhuma.

## Decisão

### FAST brain — Kimi (primária) → Gemini (reserva)

- `createAdapter({mode:'kimi-api'})` agora devolve `FallbackAdapter`
  automaticamente quando `GEMINI_API_KEY` existe no ambiente (worker,
  whatsplay, watchdog e orchestrator passam a ter a reserva sem wiring
  próprio). Sem a key: comportamento histórico, falha explícita.
- Só cai pro Gemini em erro de QUOTA/rate (regex 403/401/429/quota/rate
  limit); timeout/rede/500 sobem — são bugs, não quota.
- UMA tentativa no Gemini; se falhar com 401/400/403 a reserva é marcada
  quebrada (não insiste) e o erro sobe com as duas causas.
- Reserva resolve credencial/base/modelo de `GEMINI_*` por padrão —
  `LLM_*` aponta para a primária e nunca vaza para o adapter do Gemini.
- Sem fallback silencioso: hook `onFallback` → log explícito
  `fallback: kimi-api→gemini-api, motivo: …` + evento
  `router.provider.unavailable` publicado pelo orchestrator.
- `usage_entries` registra o provider REAL (`TurnResult.provider` —
  `kimi-api` ou `gemini-api`) — custo por provider separado.

### LIVE brain — Kimi CLI (primário) → Pi (reserva)

- `LIVE_BRAIN_PROVIDER=kimi | pi` no `.env` (default `kimi`). `pi` =
  pi-coding-agent (MIT, `@earendil-works/pi-coding-agent`), instalado
  globalmente nesta máquina (0.87.1, entrypoint
  `dist/bundle/cli.js` — spawn via node direto, sem shim .cmd, mesmo
  problema do kimi-cli ADR-033).
- `PiAdapter` implementa a mesma interface estável (`KimiLiveAdapter`) —
  o worker troca o live brain sem tocar em investigate/admin.
- Guardrail de ouro via em TODO turno: o onboarding
  (`ONBOARDING-LIVE-BRAIN-PI.md`, adaptado do Kimi Work) é prepended no
  prompt — sessões `pi -p` são one-shot.
- Achado ao vivo: com quota esgotada o `pi` imprime o JSON do erro na
  stdout com **exit 0** — o adapter varre stdout por padrão de erro de
  quota/permission e falha explicitamente (nunca entrega texto de erro
  como resposta de cliente).
- O provider do Pi é conta do operador: `pi` → `/login` → NVIDIA NIM →
  colar `nvapi-…` — **ação humana** (build.nvidia.com → Generate API Key).
  O adapter não configura auth; falha explícito sem provider.

### Cadeia final (README)

```
FAST:  Kimi API → (403/429 quota) → Gemini → (falha) → retry/DLQ + Telegram
LIVE:  Kimi CLI → (quota) → Pi (NIM) → (falha) → degradação: FAST absorve
       o básico + alerta Telegram "modo degradado"
```

Degradação do live brain: o FAST absorve HANDOFF leve via TOOL_CALL; a
cascata completa de degradação automática (troca kimi→pi sem intervenção)
fica como evolução futura — hoje a troca é um terno de .env + restart.

## Consequências

- Quota da Kimi não mata mais mensagem de cliente: cai pro Gemini na hora,
  com evento auditável e custo registrado no provider certo.
- Quando a quota da Kimi reseta, ela volta a ser primária SOZINHA (zero
  mudança de config — o fallback só dispara em erro de quota).
- Gemini é o limite do FAST: se as DUAS caírem, comportamento histórico
  (retry → DLQ → redrive + Telegram).
- Pi sem login NIM falha explícito — até o humano colar a `nvapi-…`.

## Verificação

- 8 testes unitários novos de fallback (mock de 403 forçando a troca,
  provider real no resultado, key inválida não insiste, erro não-quota
  sobe) + 8 do PiAdapter (mock de spawn).
- Key Gemini validada com curl real (HTTP 200, `gemini-3.6-flash`).
- Fallback exercitado AO VIVO: com a quota Kimi esgotada, o ciclo real
  caiu pro Gemini e respondeu (evidência nos logs do orchestrator).
