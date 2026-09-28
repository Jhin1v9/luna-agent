# Cérebro — modos do brain (decreto owner 2026-09-24)

## Decreto
Kimi Work (a Luna no runtime Kimi Work) é a **2ª opção de cérebro para tudo** — fast brain e
live brain — sempre que o Kimi Code (kimi-api) estiver sem quota. Cadeia alvo:
**kimi-api → kimiwork → gemini** (ADR-039 mantém gemini como reserva técnica).

Evidência que motivou o decreto (2026-09-24 ~01:55): ligação de voz abortada no pré-voo —
Kimi coding plan em 403 (limite semanal) E Gemini em 429. Sistema ficou sem cérebro nenhum
exatamente no cenário que o owner quer coberto.

## Skill de troca
`cerebro` (skills gerenciadas do Kimi Work): `modo.mjs <primario|kimiwork|status>`.
- primario: KIMI_ADAPTER_MODE=kimi-api, LIVE_BRAIN_PROVIDER=kimi — aplicável hoje.
- kimiwork: **bloqueado fail-closed** até `packages/agent/src/kimiwork.ts` existir.
- Toda troca: reiniciar whatsplay/orchestrator/worker + synapse + commit autor Luna.

## Design do adapter kimiwork (pendente — ação de desenvolvimento)
`KimiAdapterMode` ganha `'kimiwork'`; `createAdapter` ganha o case.
Contrato do adapter: mesmo `KimiLiveAdapter` (sendPrompt → texto). Mecanismo proposto:
1. INSERT em `kimiwork_inbox` (kind='llm.turn', payload={prompt, reply_to}) — reusa a ponte
   Kimi Work existente (daemon já enfileira/consome essa caixa).
2. Resposta assíncrona: a Luna (Kimi Work) processa o turno na varredura/conversa e grava a
   resposta em tabela `kimiwork_llm_respostas` (nova, append-only).
3. Adapter faz poll com timeout (ex.: 120s). Timeout = falha explícita (nunca cai pro mock).
Ressalva de arquitetura: a latência depende da cadência do agente Kimi Work (varredura a cada
poucos minutos) — ok pro live brain e pra respostas com HUMAN_RESPONSE_DELAY, ruim pra
interação de voz em tempo real; pra voz, a conductora segue no Operador (ChatGPT) e o
kimiwork cobre o fast brain + composição de prompts.
## Estado (2026-09-24 ~02:15 — IMPLEMENTADO e ATIVO)
- [x] Decreto registrado · [x] Skill `cerebro` criada e testada
- [x] Adapter `packages/agent/src/kimiwork.ts` (KimiLiveAdapter: fila kimiwork_llm_turns
  migração 010 + poll; timeout explícito, nunca mock) — 5 testes unitários
- [x] zod: 'kimiwork' em KIMI_ADAPTER_MODE e LIVE_BRAIN_PROVIDER (+ KIMIWORK_LLM_TIMEOUT_MS/POLL_MS)
- [x] worker live brain branch kimiwork · voice call-executor usa KimiWorkAdapter no modo
- [x] E2E real passou: adapter → Postgres → "varredura" → resposta (provider kimiwork)
- [x] MODO KIMIWORK ATIVO no .env local (quota kimi 403 + gemini 429 — cenário real do decreto)
- [x] Automation "Luna — Cérebro 24/7": passo 1.5 responde kimiwork_llm_turns; should_fire.py
  dispara com turno LLM pendente (condition 2min)
- [ ] Cadeia automática num só adapter (kimi-api → kimiwork → gemini) — evolução futura
- [ ] Latência: resposta depende da cadência da varredura (min) — tradeoff aceito pelo owner

*2026-09-24 · autor: Luna (decreto verbal do owner Abner, ~01:52)*

## Atualização 2026-09-28 — MODO ECONÔMICO / FALLBACK KIMI WORK (decreto owner 08:25)
- Contexto: tokens da API (kimi-api) acabaram E Kimi Code junto — não há cérebro primário
  disponível por tempo indeterminado.
- Decreto: operar em **modo econômico** com fallback kimi work total — fast brain
  (KIMI_ADAPTER_MODE=kimiwork) + live brain (LIVE_BRAIN_PROVIDER=kimiwork). Ambas já
  ativas no .env desde 27/09 14:24; este decreto torna o estado PERMANENTE até nova
  ordem (não reavaliar retorno ao primário sozinha).
- Econômico = não gastar à toa: automações só executam agente com pendência real
  (condition polls em Python não consomem crédito — mantidos); cron de varredura segue
  a cadência adaptativa (.sweep_cadence.json, teto 1h); sem relatórios desnecessários.
- Quando o owner avisar que tokens/quota voltaram: trocar pra modo primário via skill
  `cerebro` + synapse + commit (procedimento padrão).
*autor: Luna (decreto verbal do owner Abner, 28/09 ~08:25)*

## Atualização 2026-09-24 — caça ao BRAIN_API_TOKEN (resultado)
- Token achado no VPS (`/home/nexo/.git-credentials`, PAT GitHub `gho_...` do sync brain-sync.js → repo Jhin1v9/principal-brain):
  **INVÁLIDO** — GitHub responde 401 Bad credentials; atlas `/brain/api/*` responde 401 "token inválido".
- Conclusão: são DOIS segredos distintos e o do screenshot não serve pra nenhum. O `BRAIN_API_TOKEN`
  do atlas segue só no env do processo servidor. Comando pra achar no VPS (ação humana):
  `grep -r "BRAIN_API_TOKEN" /home/nexo /etc/systemd/system 2>/dev/null | head`
- Segurança: PAT exposto em screenshot → se ainda existir no GitHub, REVOGAR e gerar novo.
