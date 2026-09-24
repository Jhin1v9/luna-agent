# ADR-040 — Kimi Work como cérebro (modo `kimiwork`)

- Status: aceito (decreto owner verbal, 2026-09-24 ~02:00)
- Decreto: "implementar kimi work é a ideia primária... pra poder trocar pro kimi work msm
  sem quota e quando trocar vc fica responsavel de tudo e as cron task sempre mandando pra
  vc verificar tudo e responder tudo e fazer o fluxo inteiro."

## Contexto
2026-09-24 ~01:55: ligação de voz abortou no pré-voo — Kimi Coding Plan 403 (limite semanal)
e Gemini 429. Sistema ficou 100% sem cérebro no cenário exato que o owner quer coberto.
Até então as opções de cérebro eram todas API externa paga (kimi-api, gemini, kimi-cli, pi).

## Decisão
1. Novo modo `kimiwork` no `KimiAdapterMode` (`@luna/agent`): a Luna do Kimi Work (agente
   no workspace, acionada por cron/Automation) vira cérebro de fast brain E live brain.
2. Transporte: tabela `kimiwork_llm_turns` (migração 010). O adapter INSERTa o turno
   (idempotency_key única) e faz poll até `status='answered'`; timeout = falha explícita
   (nunca cai pro mock — ADR-016).
3. Quem responde: o agente Kimi Work, na varredura/cron, por UPDATE direto na tabela
   (`response`, `status='answered'`, `answered_at`). Varredura passa a drenar
   `kimiwork_llm_turns` junto com a `kimiwork_inbox`.
4. Mesma interface estável `KimiLiveAdapter` — orchestrator, worker (investigate/live)
   e voice (composição do prompt do Operador no call-executor) programam contra ela e
   não sentem a troca. Troca de modo = só `.env` (skill `cerebro`).
5. Latência: depende da cadência da varredura (minutos). Aceita pelo owner como tradeoff
   do cenário "sem quota" (lento > quebrado). Interação de voz em tempo real continua com
   a conductora no Operador (ChatGPT) — kimiwork cobre composição de prompts e cérebro
   geral.

## Configuração
- `KIMI_ADAPTER_MODE=kimiwork` (fast brain) · `LIVE_BRAIN_PROVIDER=kimiwork` (live brain)
- `KIMIWORK_LLM_TIMEOUT_MS` (default 180_000) · `KIMIWORK_LLM_POLL_MS` (default 2_500)

## Consequências
- Quota externa zerada deixa de ser ponto único de falha total.
- A varredura do Kimi Work ganha responsabilidade crítica: responder turnos pending
  (além da inbox whatsapp.message/call.incoming).
- Fallback intermediário automático (kimi-api → kimiwork → gemini num só adapter) fica
  como evolução futura; hoje a troca é por modo explícito (skill `cerebro`).

*2026-09-24 · autor: Luna*
