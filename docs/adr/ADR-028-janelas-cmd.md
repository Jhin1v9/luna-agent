# ADR-028 — Janelas de CMD: crash loop (Docker fora) + fork mode visível no Windows

- **Status:** aceito (2026-09-22 — diagnóstico do relato do owner)
- **Sintoma:** janelas de CMD abrindo toda hora executando node.

## Causa raiz (dupla)

1. **Crash loop real**: o Docker Desktop estava fora (máquina reiniciou/sessão encerrou) →
   Postgres inacessível → TODOS os daemons falham no boot (`postgres unreachable at boot`)
   → pm2 restart a cada ~4s → dezenas de processos piscando (restart counts de 34–45).
   Adicionalmente o `apps/worker/src/index.ts` estava **corrompido com bytes NUL**
   (escrita interrompida de uma sessão anterior) — crash de parse do tsx em loop,
   independente do Postgres.
2. **Fork mode visível**: pm2 em fork mode no Windows, quando o daemon pm2 foi iniciado
   de um terminal interativo, spawna os processos filhos com console herdado — cada
   restart vira um flash de janela.

## Correções aplicadas

1. Docker Desktop relocalizado + `luna-postgres` de volta; worker/index.ts restaurado do
   git (NULs) + wire da escalação F5 reaplicado limpo; bug `make_interval(mins => text)`
   no tick corrigido (cast ::int). Sistema estável: heartbeats frescos, zero FATAL.
2. `restart_delay: 4000` no ecosystem limita a frequência de qualquer loop futuro.
3. **Mitigação das janelas (pendente de instalação one-time do owner/admin)**: rodar o
   pm2 daemon como serviço Windows (`pm2-windows-service` ou NSSM) ou iniciar o daemon
   via wrapper hidden (VBS/PowerShell -WindowStyle Hidden) — assim os filhos fork não
   herdam console visível. Até lá: reiniciar o pm2 de um prompt já minimizado.

## Lição operacional

Crash loop de boot (dependência externa fora) + fork mode visível = tempestade de
janelas. O watchdog em duas camadas (ADR-022) se comportou certo: pm2 ressobeu, watchdog
alertou — o problema era a dependência, não a supervisão.
