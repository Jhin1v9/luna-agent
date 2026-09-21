# ADR-023 — HANDOFF_LIVE em F2: espera ao cliente + registro estruturado (degradação explícita)

- **Status:** aceito (2026-09-21, F2 — Bloco 1)
- **Contexto:** o contrato §6 manda que HANDOFF_LIVE dispare uma investigação
  no LIVE brain (Kimi Code, sessão persistente) com budget de rondas e
  timeout de parede. Mas o kimi-web WS segue opaco (ADR-015 — protocolo não
  documentado, sondado ao vivo), e o chat admin é F4.

## Decisão

1. HANDOFF_LIVE (máx 1 por evento, §5.1) executa em F2 como: **resposta de
   espera ao cliente ANTES de qualquer coisa** (§6 cortesia — "Deixa eu
   verificar isso direitinho, já te falo"), publica `router.handoff.live` com
   `{objective, budget: 3, timeout_ms: 600000, context_summary}` e registra
   `router.investigation.pending_live`. A investigação REAL (rondas no live
   brain) entra quando o WS do kimi web for mapeado (F1.3.x) ou com o chat
   admin (F4) — o que vier primeiro.
2. **Nunca** enfileirar um job de investigação que o worker não conseguiria
   executar (viraria DLQ enganosa). Pendência explícita > fila morta.
3. Premissa errada do cliente = sucesso (§6): o FAST corrige na própria
   resposta sem gastar budget — o prompt estruturado instrui isso
   explicitamente e o caso está coberto em testes.
4. `HANDOFF_LIVE` é via de sentido único: se o live brain não resolver, o
   destino é ESCALATE_HUMAN, jamás de volta ao FAST (anti-ping-pong, §5.1).

## Consequências

- Cliente nunca fica em silêncio nem recebe "não sei" cru: sempre ANSWER de
  espera com a persona.
- O resumo estruturado do handoff já está persistido em events/agent_runs —
  o chat admin (F4) consome sem nenhuma mudança de schema.
