# ADR-018 — Gemini como fast brain INTERINO para teste

- **Status:** aceito como medida provisória (2026-09-21, decreto do owner)
- **Contexto:** ADR-016 determinou que resposta de cliente nunca sai do mock e
  que o fast brain oficial é a Kimi API (§7.2). A key da plataforma Kimi
  ainda não existe no ambiente, e o owner decretou: usar **Gemini como fast
  brain interino para teste agora** (endpoint OpenAI-compatible).

## Decisão

1. Novo modo `gemini` no `KimiLiveAdapter` (`GeminiAdapter`,
   `packages/agent/src/gemini.ts`) — MESMA interface estável e MESMAS
   garantias do kimi-api: sem fallback pro mock, key ausente = falha explícita
   (`ApiKeyMissing`), usage → `usage_entries` (§23).
2. Implementação compartilhada: `OpenAiCompatAdapter` (chat completions) com
   `KimiApiAdapter` e `GeminiAdapter` como subclasses finas (só defaults de
   base URL/model/key env diferem). Interface não mudou — ADR-015 mantido.
3. `assertProductionAdapter` permite `gemini` (é brain real); `mock` continua
   proibido em produção.
4. Config: `GEMINI_API_KEY`, `GEMINI_BASE_URL` (default
   `https://generativelanguage.googleapis.com/v1beta/openai/`), `GEMINI_MODEL`
   (default `gemini-2.5-flash`). Key só via `.env` (gitignored, pino redige).
5. `loadDotEnv` agora procura `.env` do cwd para cima (apps acham o do root).

## INTERINO — significa

- Gemini NÃO substitui a decisão arquitetural (§7.2/ADR-002): quando a key da
  plataforma Kimi existir, `kimi-api` volta a ser o modo de produção e o
  `gemini` sai de circulação (ou vira alternativa configurável, decisão do
  owner na época).
- Custos e classificação de uso já contam separados: `usage_entries.provider`
  registra `gemini-api` vs `kimi-api` — comparável diretamente.

## Estado da key (2026-09-21)

A `GEMINI_API_KEY` gravada no `.env` pelo owner foi **rejeitada pelo endpoint
Google** (HTTP 400 `INVALID_ARGUMENT: "Invalid Auth key."`, nos dois headers
`Authorization: Bearer` e `x-goog-api-key`) e também não é aceita pelos
endpoints Moonshot (401). O formato da key (52 caracteres, prefixo que não é o
`AIzaSy` típico de keys do Google AI Studio) sugere key de outro serviço,
truncada ou revogada. Adapter coberto por 3 testes unitários com fetch
injetado. **Pendente do owner:** reemitir/verificar a key no Google AI Studio
e atualizar o `.env` — aí o modo `gemini` liga sem nenhuma mudança de código.
