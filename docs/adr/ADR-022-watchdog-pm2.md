# ADR-022 — Watchdog geral + pm2: supervisão em duas camadas

- **Status:** aceito (2026-09-21, F1.5)
- **Contexto:** §20 manda watchdog geral independente (restart → persiste →
  Telegram) e §31 manda "Luna inicia automaticamente". O PC do owner tem pm2
  (7.0.3) instalado.

## Decisões

1. **Duas camadas, sem duplicar restart**: pm2 é o supervisor de processos
   (ressobe qualquer daemon que crashar; `pm2 save` persistido). O watchdog
   geral (`apps/watchdog`) é o supervisor de SAÚDE: checa /health do
   orchestrator, heartbeats do banco (migração 005, `service_heartbeats`,
   escritos por cada daemon a cada 15s com meta rica: state/pageAlive/
   session), DB (SELECT 1) e Chrome (via pageAlive). Estados HEALTHY /
   DEGRADED / FAILED / DOWN (função pura `evaluateServices`, testada).
2. **Quem restarta o quê**: daemon caiu → pm2 ressobe (crash). O watchdog,
   quando `LUNA_PM2_MANAGED=1` (ecosystem), só ALERTA — dois supervisores
   reiniciando gera processos duplicados (aconteceu na F1.5: watchdog spawnou
   worker fora do pm2; corrigido e documentado aqui). Sem pm2 (standalone),
   o watchdog volta a restartar sozinho (código mantido).
3. **Ecosystem pm2 com node direto**: `interpreter: node` no cli.mjs do tsx,
   args como array (caminho tem espaço — split de string quebrava), cwd por
   app. Shims CMD no meio (cmd/pnpm) sumiam com o stdout no Windows (log
   preso, diagnóstico F1.5).
4. **pino-pretty movido para @luna/logging** com caminho absoluto via
   `createRequire(import.meta.url)` — target nominal não resolvia com cwd
   variável (pm2/crash observado na F1.5).
5. **Self-test (§20)** no watchdog: ao boot + a cada 6h — DB, Brain
   (.brain acessível + selector memory), Git, storage (% livre), WhatsPlay
   (heartbeat), browser (pageAlive), Kimi (1 chamada mínima). Resultados em
   `activity_log`; falhas → incident + Telegram (ou falha explícita logada).

## Pendências registradas

- **Auto-start no boot do Windows**: `pm2 startup` exige terminal admin —
  pendente do owner. Até lá, após reboot da máquina os daemons sobem com
  `pm2 resurrect` (dump salvo) ou manualmente.
- Telegram (TELEGRAM_BOT_TOKEN/TELEGRAM_TEAM_CHAT_ID) ainda não configurado —
  todos os caminhos de alerta registram a falha explicitamente nos logs.
