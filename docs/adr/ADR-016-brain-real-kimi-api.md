# ADR-016 — Resposta de cliente NUNCA vem do mock; brain real = Kimi API

- **Status:** aceito (2026-09-21, F1.4) — decreto do owner
- **Contexto:** a F1.3 introduziu o `MockKimiAdapter` (dev/testes) como modo
  default. Decreto: **resposta a cliente nunca pode vir do mock** — produção
  responde com a Kimi API real (fast brain, §7.2, REST estável de chat
  completions), que tem function calling nativo e é o workhorse do sistema.

## Decisão

1. `KimiApiAdapter` (`mode: 'kimi-api'`) implementa o fast brain de verdade:
   `POST {KIMI_API_BASE_URL}/chat/completions`, parse de
   `choices[0].message.content` + `usage` (vira `usage_entries`, §23), timeout
   60s, sem retry escondido (o dispatcher já faz retry → DLQ).
2. **Sem fallback silencioso.** Key ausente (`KimiApiMissingKey`), 401, timeout
   ou resposta malformada → o turno FALHA. O handler não grava resposta
   parcial, o evento retenta e vai pra DLQ com motivo. Cair pro mock em
   silêncio é proibido.
3. **Guarda de boot:** `assertProductionAdapter` — `NODE_ENV=production` com
   `KIMI_ADAPTER_MODE=mock` derruba o orchestrator na subida.
4. Mock permanece para testes (marcado `[mock-luna]`) e como modo explícito de
  dev — nunca como destino de fallback em runtime.

## Estado da key

Em 2026-09-21 **não há `KIMI_API_KEY` disponível** no ambiente (verificado:
env, `.env`, config do kimi CLI). O adapter real está implementado e coberto
por testes unitários com fetch injetado (7 testes) + testes de integração do
fluxo com adapter estilo kimi-api. **Pendente para ligar:** criar a key na
console da plataforma, colocar em `.env`, setar `KIMI_ADAPTER_MODE=kimi-api`.
Critério de aceite F1.4 fica PARCIAL até essa key existir (ver relatório).

## Consequências

- `KimiLiveAdapter` agora tem 3 modos; a interface (`ensureSession/sendTurn/
  readMessages`) não mudou — ADR-015 mantido.
- Custos passam a ser reais (§23 já tem o usage ledger no banco).
