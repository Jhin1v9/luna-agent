## 2026-09-27 10:38 HVR — INCIDENTE RECUPERADO: stack fora ~7h (madrugada)

- Último checkpoint saudável: 03:18 HVR (commit 0582e25). Entre 03:18 e 09:58 HVR a máquina parou de executar crons (sleep/hibernação) e o Docker Desktop morreu.
- 09:58 HVR: sweep detectou orchestrator DOWN (connection refused) + Postgres DOWN.
- Diagnóstico: pm2 vivo com 4 processos em crash-loop (400+ restarts cada, backoff) por Postgres fora; luna-kimiweb stopped; distro docker-desktop WSL2 Stopped; engine Docker não subia no primeiro Start-Process (10:00).
- Ação: wsl --shutdown + kill Docker Desktop + reinício limpo às 10:25. Engine OK 10:38, luna-postgres Up.
- pm2 restart all 10:38 → todos online; /health 200 /ready 200 às 10:39. pm2 save feito.
- GAP não coberto: boot automático pós-sleep — ADR-038 (kimi web standalone + boot) segue pendente; Docker Desktop não auto-inicia após hibernação.
