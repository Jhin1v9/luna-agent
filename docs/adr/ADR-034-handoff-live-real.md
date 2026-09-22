# ADR-034 — HANDOFF_LIVE real: investigação por job (fecha a degradação ADR-023)

- **Status:** aceito (2026-09-22, plano P2 — ponte FAST↔LIVE)
- **Contexto:** até aqui o HANDOFF_LIVE (§5.1) publicava o evento e entregava
  a cortesia de espera, mas nada investigava (degradação registrada no
  ADR-023). Com o KimiCliAdapter (ADR-033) o live brain ficou viável.

## Decisão

1. **Router → job**: no HANDOFF_LIVE (máx 1/evento, §5.1), além do evento
   `router.handoff.live`, o router enfileira `job_type='investigate'`
   idempotente por evento (`investigate:<event_id>`), `max_attempts=1` — as
   rondas são a estratégia de retry; reexecutar o job re-investigiria do
   zero. Budget de rondas e timeout de parede vêm de
   `INVESTIGATE_BUDGET_ROUNDS` (default 3) e `INVESTIGATE_TIMEOUT_MS`
   (default 600_000) — config versionada no mesmo espírito das routes.
2. **Worker executa** (`jobs/investigate.ts`) com o KimiCliAdapter: sessão
   `investigate:<job_id>` (persistente entre rondas via `-c`), cada ronda
   recebe objetivo + contexto acumulado + achados das rondas anteriores; a
   última ronda pede a RESPOSTA FINAL. Timeout de parede conferido entre
   rondas.
3. **Entrega no MESMO thread**: a conclusão vira `messages` outbound
   (`queued`) + `pg_notify('luna_outbound')` — o caminho de send-safety do
   whatsplay (allowlist, espera humana, confirmação de envio). Sem via
   paralela.
4. **Falhas → ESCALATE_HUMAN (§6)**: timeout, ronda falha após rondas ok,
   budget esgotado ou "NÃO RESOLVIDO" declarado pelo live brain →
   `escalations` (ALTA) com resumo das rondas + evento
   `router.investigation.exhausted` + alerta Telegram. Ronda 1 falha com
   zero rondas → o erro propaga (job.failed → visibilidade).
5. **Eventos §11**: `router.investigation.round` (por ronda, com achado),
   `router.investigation.completed`, `router.investigation.exhausted` —
   todos via EventBus (events+outbox+idempotency na mesma tx).
6. **Autonomia**: `LIVE_AUTONOMY` (none|yolo|auto, default yolo) vira flag
   do CLI (-y/--auto). Investigações precisam rodar ferramentas sem
   interação; o escopo do que pode ser tocado é o do próprio CLI + cwd do
   repo (o prompt orienta, ADR-035 endurece o canal admin).

## Consequências

- A degradação ADR-023 fica histórica: HANDOFF tem fim real agora.
- Cada ronda spawna o CLI (~2-9s + trabalho); budget 3 → investigação de
  até ~10 min de parede. Aceito para o volume esperado (handoffs raros).
- A resposta final passa pelo sanitize/unwrap da fila outbound (texto
  limpo, sem envelope JSON — regressões do ciclo anterior).
