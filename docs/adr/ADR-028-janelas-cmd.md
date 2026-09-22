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
3. **SOLUÇÃO DEFINITIVA (2026-09-22, segunda rodada)** — o boot era via
   `pm2-windows-startup` (Run key → `invisible.vbs` → `pm2_resurrect.cmd`) e o
   VBS já escondia o .cmd. As janelas eram os PROCESSOS FORK: o pm2 7.0.3
   spawna filhos com `detached: true` + `windowsHide: true`, mas no Windows
   `detached` (CREATE_NEW_CONSOLE) ignora o windowsHide — console VISÍVEL a
   cada app/restart (validado: `pm2 restart` num daemon vivo gerou 8 janelas
   node; durante o resurrect do boot, 5).
   **Patch local** em `God/ForkMode.js` (global npm, backup `.bak`):
   `detached: process.platform === 'win32' ? false : true` — sem detached, o
   filho herda o console (escondido) do daemon. Revalidado com varredura de
   janelas (Get-Process MainWindowHandle) durante `pm2 kill` + resurrect
   completo: **zero janelas node/cmd**, 5/5 online. Repetir o patch após
   upgrade do pm2 global (é fora do repo de propósito: ferramenta da máquina).
   Adicional: pós-reboot, subir Docker Desktop + `docker start luna-postgres`
   antes dos daemons sobem — hoje é manual do owner (Docker Desktop não está
   no autostart da máquina).

## Lição operacional

Crash loop de boot (dependência externa fora) + fork mode visível = tempestade de
janelas. O watchdog em duas camadas (ADR-022) se comportou certo: pm2 ressobeu, watchdog
alertou — o problema era a dependência, não a supervisão.
