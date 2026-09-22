# ADR-030 — Auto-gatilho do heal: DOWN persistente dispara runHeal (com plano registrado)

- **Status:** aceito (2026-09-22 — pendência do F7 fechada)
- **Contexto:** o self-test/watchdog detectavam degradação, e o runHeal (F7)
  existia, mas não estavam ligados.

## Decisão

1. O worker, a cada ciclo do tick (60s), roda `autoHealTick`: serviço PRÓPRIO
   com heartbeat ausente/velho por **3 ciclos consecutivos** (anti falso
   positivo) → se existe **HEAL PLAN registrado** (fix determinístico,
   registrado em código com commit + review) → dispara `runHeal` com todas as
   proteções (whitelist, gate typecheck+testes, LKG, rollback, máx 3).
2. DOWN sem plano → **nunca palpite de código**: restart é responsabilidade do
   pm2 (supervisor), e o incidente fica pendente de diagnóstico assistido
   (humano/IA — ADR-029). O gate de testes existe justamente pra impedir que
   "tentativa sem entendimento" vire deploy.
3. `HEAL_PLANS` começa VAZIO em produção: o registro de um plano é ato
   deliberado (o da prova F7 serviu de validação do mecanismo).

## Consequências

- A rede de segurança agora fecha sozinha pra classes de falha com fix
  conhecido; o resto escala pra humano com contexto — exatamente §16.
