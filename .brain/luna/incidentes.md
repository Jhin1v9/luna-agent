## 2026-09-27 10:38 HVR — INCIDENTE RECUPERADO: stack fora ~7h (madrugada)

- Último checkpoint saudável: 03:18 HVR (commit 0582e25). Entre 03:18 e 09:58 HVR a máquina parou de executar crons (sleep/hibernação) e o Docker Desktop morreu.
- 09:58 HVR: sweep detectou orchestrator DOWN (connection refused) + Postgres DOWN.
- Diagnóstico: pm2 vivo com 4 processos em crash-loop (400+ restarts cada, backoff) por Postgres fora; luna-kimiweb stopped; distro docker-desktop WSL2 Stopped; engine Docker não subia no primeiro Start-Process (10:00).
- Ação: wsl --shutdown + kill Docker Desktop + reinício limpo às 10:25. Engine OK 10:38, luna-postgres Up.
- pm2 restart all 10:38 → todos online; /health 200 /ready 200 às 10:39. pm2 save feito.
- GAP não coberto: boot automático pós-sleep — ADR-038 (kimi web standalone + boot) segue pendente; Docker Desktop não auto-inicia após hibernação.

## 27/09 — foto inbound do Enoque (Production) nao capturada
- Evento 09:27 chegou so com texto; image_path null e nada em apps/whatsplay/inbound-media/
- Codigo do fix (2f7b15d) esta no ar; suspeita: seletor img[src^="blob:"] em page-scripts.ts:81 falha quando imagem fora da viewport (lazy-load) ou imagem citada/quoted
- Workaround ate corrigir: pedir pro time mandar os nomes dos repos como texto

## 27/09 16:38 HVR — fila kimiwork_inbox parada ~23 min
- Último processamento: 14:18:28Z; sweep das 16:38 encontrou 4 pending >20min (14:18–14:20Z) e 19 pending no total, com mensagens ainda chegando (last_received 14:41Z)
- Orchestrator /health e /ready: 200/200 — o travamento é do pipeline de processamento (automação Geral), não do serviço HTTP
- Ação: grupo do Telegram alertado (decreto owner: fila >20min → alerta). Não respondi mensagem nenhuma (escopo da Geral)
- Próximo passo: se na próxima sweep ainda houver pending >20min, verificar logs do worker/orchestrator e pm2
- **Update 16:48 HVR:** causa raiz confirmada — NÃO é crash. pm2 jlist: unstable_restarts=0 em todos, último start 14:19 HVR. Último done-process 14:18Z (16:18 HVR): turnos kimiwork presos "aguardando varredura" (logs do worker), coerente com cérebro em modo kimi work total desde 14:24 (quota Kimi Code esgotada). Recuperação depende da quota ou da troca de volta ao modo primário. Grupo avisado com causa raiz.
