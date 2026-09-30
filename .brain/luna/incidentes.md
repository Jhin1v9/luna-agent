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
- **Resolvido 17:07 HVR:** processamento da fila retomou (last done-process 15:07Z, 0 pending >20min). Duração do incidente: ~49 min (16:18→17:07 HVR). Causa: turnos kimiwork presos durante a janela de quota esgotada do Kimi Code.

## 27/09 17:38 HVR — fila parada novamente (recorrência da quota)
- Last done-process voltou a estagnar em 15:18:14Z (17:18 HVR); 3 pending >20min às 17:38 (msgs do Elias com as definições do app Eduardo + msg do Enoque).
- As definições do Elias JÁ foram capturadas pela sessão paralela (commits 5deb736/05f9d8b às 17:06–17:18) — conteúdo não está perdido.
- Mesma causa raiz dos turnos kimiwork presos (modo kimi work / quota). Grupo já ciente — sem re-alerta para evitar spam; monitorar próxima sweep. Se persistir >1h, re-alertar como recorrência.
- **Update 17:48 HVR:** parada persiste — 30 min sem processamento, todos os 5 pending agora >20min. Ainda dentro do critério de re-alerta (>1h). Próxima sweep decide.
- **Update 18:17 HVR:** 1h de parada — recorrência confirmada, NÃO se recuperou sozinha (diferente do incidente 16:18). Fila crescendo: 11 pending, 5 >20min. Grupo re-alertado (prometido no critério >1h).

## 27/09 18:50 HVR — causa raiz definitiva da fila: turnos do kernel kimi-code presos
- runner.state.json do agente main: 2 kernel_turns ATIVOS há ~2h (started 16:41:55Z e 16:44:16Z),
  kernel=kimi-code, providerModel=unknown (quota Kimi Code esgotada — turnos nunca completam).
- Um deles (turno 136, conv ae77d4af) é EXATAMENTE a conversation da automação Geral —
  por isso todo run da Geral é "deferred: conversation busy (user turn in progress)" e o
  kimiwork_inbox não drena (last process 15:18Z).
- Modo kimi work no .env JÁ ESTAVA ATIVO (KIMI_ADAPTER_MODE=kimiwork, LIVE_BRAIN_PROVIDER=kimiwork,
  desde 14:24). O gargalo não é a env — é a quota do provider Kimi Code segurando turnos no desktop.
- Destrave depende de: quota voltar (turnos completam sozinhos) OU cancelar os turnos na UI do
  Kimi Work desktop OU reiniciar o app (mata os turnos presos). Decisão do owner — reportado.
- **Update 18:53 HVR:** parada chega a 1h35; fila crescendo (11 >20min, 17 total). Sessão paralela ativa no lead Eduardo (commits), mas o pipeline Geral continua sem processar nada.
- **Resolvido 19:08 HVR (2ª ocorrência):** fila voltou a processar (last done-process 17:08Z, 0 pending). Causa de fundo registrada pela sessão paralela: quota da automação Geral ESGOTADA no mês (screenshot owner) — explica as paradas em ciclos desde 14:24. Não é só o modo kimi work. Ação humana real: renovar quota/upgrade ou aguardar reset mensal.

## 27/09 21:55 HVR — stack INTENCIONALMENTE offline (luna-off-on)
- Sweep 21:55: /health e /ready fora do ar, kimiwork_inbox inacessível (luna-postgres Exited 0).
- Diagnóstico: NÃO é queda — sessão paralela criou skill `luna-off-on` (scripts/luna-stack.bat on/off/status,
  commits da89071/c8da98e/5ba2c1d, 21:10–21:12) e executou OFF às 21:12:51 para proteger o kimiweb
  (infra do desktop). pm2: orchestrator/worker/whatsplay/watchdog stopped, kimiweb online.
- Ação da sweep: NENHUMA recuperação (decisão operacional documentada). Grupo avisado de forma informativa.
- Stack volta com `luna-stack.bat on` (ação humana ou sessão autorizada).

## 27/09 21:12 → 28/09 08:17 HVR — luna-off-on ENCERRADO
- Stack religada (luna on) às 08:17 HVR; /ready 200, fila 0 pending. Durante o off (~11h) nada chegou;
  backfill de 2 msgs absorvido. Motivo do off confirmado: modo econômico (tokens kimi-api + Kimi Code
  esgotados, decreto owner 28/09 08:25 — fallback kimi work permanente até nova ordem).

## 2026-09-28 — Inbound do grupo HDM (Matheus) não detectado pelo watcher

- Reportado por Enoque (Production 07:19): "o grupo do matheus não recebeu nenhuma resposta".
- Diagnóstico: outbound pro grupo funciona (teste 06:54 entregue), mas o watcher do whatsplay NÃO detecta mensagens novas do grupo `HDM - Industrial (SBD) - 26` — zero eventos na kimiwork_inbox; logs só mostram o Production sendo vigiado.
- Allowlists .env OK (nome + JID `120363428577835024@g.us`). chat_registry NÃO tem entrada do grupo HDM (nem do Juninho — que chega normal, então registry não é o gate de ingest).
- Provável causa: sessão do WhatsApp Web não carrega o chat do grupo (arquivado/fora da lista visível) ou instabilidade da sessão (whatsplay com 728 restarts).
- Mitigação: mensagem enviada no grupo HDM pedindo ao Matheus pra repetir pedidos; fix definitivo com Jhin/Abner (fixar grupo no painel + recarregar sessão; avaliar watcher explícito por JID).
- Bônus: msg de teste de fluxo HDM (06:54) foi parar no Production por erro de roteamento meu — fluxo de teste deve ficar interno/grupo do cliente.

## 2026-09-28 (atualização) — CAUSA RAIZ do "grupo HDM sem resposta"

- Não era só o watcher: o delivery outbound resolve destino pelo CONTATO DA
  CONVERSA (contacts.address), e a Luna gravava TODAS as respostas com a
  conversation_id do Production → mensagens pro HDM/Juninho caíam no Production.
  Ocorreu 4x (27/09: HDM "instabilidade" + Juninho ack; 28/09: 2 respostas HDM).
- Corrigido no procedimento: regra de ouro em grupos-clientes.md (usar sempre a
  conversation_id do evento). Respostas reenviadas nos grupos certos e entrega
  confirmada nos logs (target correto).
- Print da sessão WA (prova de que Production e HDM são chats distintos) no
  Telegram msg 5609 e em .brain/luna/analises/wa-antes.png.
- Fix estrutural pendente (Jhin): delivery priorizar metadata.chat_id.

## 2026-09-29 — Stack fora do ar pós-sleep (boot automático falhou)

- **Detecção:** sweep 29/09 ~13:43 HVR — /health e /ready sem resposta (connection refused).
  Última sweep saudável: 00:44 HVR (29/09). Queda ocorreu entre 00:44 e 13:43 HVR —
  provável sleep da máquina + boot automático não executou (pendência conhecida:
  Docker auto-start + pm2-windows-startup).
- **Diagnóstico (13:43-14:05 HVR):**
  - pm2: luna-orchestrator / luna-whatsplay / luna-worker / luna-watchdog em crash-loop
    ("waiting…", milhares de restarts); luna-kimiweb online (infra do Kimi Work, separada).
  - Docker Desktop: `com.docker.backend` chegou a 11.5 GB, RAM 99.9% (32 GB total);
    daemon inacessível (npipe dockerDesktopLinuxEngine não existe) — travou na inicialização.
  - Memória depois estabilizou (21 GB livres), mas o daemon não subiu; `luna-stack.bat on`
    executado 2x; na 2ª tentativa o owner interrompeu (possivelmente assumindo manualmente).
- **Impacto:** ~13h+ sem watcher WhatsApp nem orchestrator — mensagens do período ficaram
  sem absorção (backfill a verificar quando a stack subir); automações Geral/Voz paradas.
- **Ação humana (urgente):** Abner — abrir o Docker Desktop manualmente (ícone na bandeja),
  aguardar o daemon, rodar `scripts/luna-stack.bat on`; verificar backfill do whatsplay.
  **E priorizar de vez o boot automático pós-sleep (Docker auto-start + pm2-windows-startup)
  — é a 2ª vez que o mesmo modo de falha derruba a stack.**
- Alerta enviado ao grupo do Telegram nesta sweep.

### Resolução (29/09 ~18:15 HVR — pela Luna, a pedido do owner)

- **Causa-raiz (diferente do diagnóstico inicial!):** NÃO era só o pós-sleep. O
  `com.docker.backend` crashava em loop com `unable to get 'ProgramData'` — o
  **Git Bash do ambiente da Luna não tem a variável de ambiente `PROGRAMDATA`**,
  e o `cmd //c start Docker Desktop.exe` herdava esse env quebrado. Toda vez que
  A LUNA tentou subir o Docker, o backend morria por causa disso (o backend
  estufava RAM tentando iniciar antes de crashar — por isso parecia vazamento).
- **Fix imediato:** matar backends/Docker Desktop, `wsl --shutdown`, e subir via
  PowerShell com env explícito:
  `powershell -NoProfile -Command "$env:PROGRAMDATA='C:\ProgramData'; Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'"`
  → daemon UP em ~30s (29.8.0). Depois `pm2 resurrect` → todos os 5 processos
  online, /health 200 e /ready 200 em ~1 min.
- **Fila pós-recuperação:** 1 pending com 2 min (mensagem nova, normal), 5 erros
  antigos de 24/09 (pré-existentes). Sem backfill aparente perdido no Postgres —
  mas o whatsplay ficou ~15h sem watcher: conferir com o grupo se chegou mensagem
  sem absorção no período (13:43→18:10 HVR de 29/09 + madrugada).
- **Lição operacional (ADICIONAR AO RUNBOOK):** nunca subir Docker Desktop a partir
  do shell da Luna sem `PROGRAMDATA` no env — sempre via PowerShell com
  `$env:PROGRAMDATA='C:\ProgramData'`. Considerar fixar o env no wrapper/script
  `luna-stack.bat`.
- **Pendência estrutural mantida:** boot automático pós-sleep (Docker auto-start
  + pm2-windows-startup) — sem isso, o próximo sleep repete o incidente; e o
  `luna-stack.bat` depende de shell com PATH/env sãos.

## 2026-09-29 (2ª queda) — Stack fora ~32 min, recuperada pela Luna em <1 min

- **Detecção:** sweep 20:30 HVR — /health e /ready 000. Última sweep OK 19:58 HVR.
  Docker Desktop fora do ar (nenhum processo com.docker), RAM normal (owner em sessão
  de jogos — provável sleep/exit do Docker).
- **Recuperação (Luna, 20:31-20:33 HVR):** fix PROGRAMDATA via PowerShell
  (`$env:PROGRAMDATA='C:\ProgramData'; Start-Process 'Docker Desktop.exe'`) → daemon
  UP em ~20s; `pm2 resurrect` → health/ready 200 em ~12s. Sem interrupção humana.
- **Fila pós-recuperação:** 1 pending recente (2 min — normal), 372 done. Nada travado.
- **Aviso enviado ao grupo** (queda + recuperação + cobrança do boot automático).
- **Padrão confirmado:** sem boot automático pós-sleep, toda queda do Docker Desktop
  exige intervenção (agora a Luna resolve em <1 min, mas o ideal é nem cair).

## 2026-09-30 (3ª queda) — Stack fora ~12h na madrugada, recuperada pela Luna

- **Detecção:** sweep 30/09 13:05 HVR — /health e /ready 000. Última sweep OK 01:04 HVR.
  Docker Desktop fora (zero processos com.docker), RAM normal.
- **Recuperação (Luna, 13:06-13:07):** runbook PROGRAMDATA → daemon UP em 20s;
  `pm2 resurrect` → health/ready 200 em ~12s. Autônoma, <1 min.
- **Fila:** 5 pending frescos (nenhum >20 min), 383 done — automação Geral voltando a
  absorver normalmente. Janela fora (~12h) foi madrugada/fora de expediente.
- **Aviso enviado ao grupo.** 4ª queda do mesmo modo de falha — boot automático
  pós-sleep segue pendente e é a única correção estrutural.

## 2026-09-30 (4ª queda, ~10 min após a 3ª) — Docker morreu sem shutdown registrado

- **Detecção:** sweep 13:22 HVR — stack 000, só 10 min após a recuperação das 13:07.
- **Causa suspeita:** log do backend para em 13:08 HVR sem mensagem de shutdown
  ("stopped -> starting" e silêncio) — ou crash silencioso do Docker Desktop, ou
  fechamento manual. Sem erro de ProgramData desta vez (env correto herdado?).
- **Recuperação (Luna, 13:23-13:24):** runbook PROGRAMDATA → daemon 20s,
  health/ready 200 em ~12s. Grupo avisado com pergunta: alguém fechou o Docker?
- **Observação:** se o Docker Desktop estiver sendo fechado manualmente, as sweeps
  vão re-subir sempre — precisa de alinhamento humano ou boot automático.

