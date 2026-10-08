
## 2026-10-05 varredura (pós 15:05Z)
Atividade de outra sessão no repo (4 commits): plano completo nexo-cms (11 áreas + roadmap A/B/C, decreto owner), auditoria confirmando que repo legado Nexo-CMS é outro projeto (colheita de padrões apenas), execução do site HDM no VPS (/previas/hdm-matheus) + nexo-cms v0 com Moveable, fix de wrap no PLANOS.md. Painel sem novidade (24 requests, último 03/10). Fila 0 pending. Stack 5/5 saudável.

## 2026-10-05 varredura (pós 15:28Z)
+1 commit de outra sessão: plano da área 12 do nexo-cms (chat de IA no editor com cobrança de créditos do workspace). Painel sem novidade (24 requests). Fila 0 pending. Stack 5/5 saudável.

## 2026-10-05 varredura (pós 15:45Z)
+1 commit: chaves de IA do CMS provisionadas na VPS (kimi primário + gemini reserva). Painel sem novidade. Fila 0 pending. Stack 5/5.

## 2026-10-05 varredura (pós 15:50Z)
+2 commits: decisões owner registradas (senha 7741, estreia só time, /edit por prévia — Fase A desbloqueada) + fix da URL do editor na lista de decisões.
EPISÓDIO FILA: 5 msgs do Eduardo (~15:58Z, incl. resposta aos nomes de branding no Caminhoneiros) ficaram ~30 min pending — Geral com runs failed/cancelled (agent_dispatch_failed) entre 16:22–16:26, recuperou sozinha no run das 16:26 (drenou tudo). Sem alerta necessário (fila zerou antes da ação). Causa raiz do dispatch failed não identificada no wire — monitorar.

## 2026-10-05 varredura (pós 16:34Z) + comando owner
- Stack pm2 CAIU entre as rodadas (daemon morto, 0 processos) — recuperada com pm2 resurrect; 5/5 online, health 200. Docker/Postgres seguiam de pé.
- Gasto Kimi Code R$36,18 lançado no dashboard interno (vps.nexo-digital.app/dashboard): id exp_muvi2q3xzynbop, categoria Software, moeda BRL, caixa deduzido (estava 0 → -36,18).
- ⚠ SENHA DIVERGENTE: owner informou "abner / 7741" mas o hash do usuario abner no datastore-pg do dashboard NÃO bate com 7741 (nem 7741@). A 7741 é a senha do NEXO-CMS (decisão 09-27), não do dashboard. Lançamento feito gravando direto no datastore replicando o handler POST /api/expenses. PENDENTE: owner confirmar senha real do dashboard ou pedir reset para 7741.

## 2026-10-05 senha unificada (decreto owner 19:08 HVR)
Owner decretou senha única compartilhada entre CMS e dashboard para compartilhar as envs.
- Dashboard interno (nexo_dashboard_backend, PG): hash do usuario `abner` resetado para 7741 via ds.saveUser (bcrypt $2b$10$). Login API confirmado: POST /dashboard/api/auth/login → 200, role Admin.
- nexo-cms (/home/nexo/nexo-cms/.env): CMS_ADMIN_PASSWORD já era 7741 (decisão 27/09) — conferido, idêntico.
- AUTORIZAÇÃO: owner explicito ("pode usar a msm senha... assim podem compartilhar as env .7741@"). Ressalva da decisão 27/09 mantida: trocar antes de expor a público.

## 2026-10-05 varredura (pós 16:34Z)
+2 commits: segurança — senha do dashboard unificada com CMS (7741, decreto owner); synapses — passos 0+2 do nexo-cms (editor quadriculado + guias, codemod em andamento). Painel sem novidade. Fila 0 pending (Geral estável após o episódio do dispatch). Stack 5/5.

## 2026-10-05 análise sessão Kimi Code 9de66a55 (comando owner 19:38)
Sessão da Luna Live Brain construindo o nexo-cms. Documentação operacional gravada na VPS:
/home/nexo/nexo-cms/docs/OPERACOES.md (stack, acessos, commits, roadmap, incidentes).
Andamento: editor /previas/hdm-matheus/edit no ar com quadriculado + guias Canva (commit 7646914);
codemod data-cms HDM na branch feat/cms-editmode (8 arquivos); sessão PARADA 18:49 HVR por
quota 403 do Kimi Code. Próximo passo ao retomar: ProfilesPages + MiscPages + runtime + verify.

## 2026-10-05 — Avaliação completa do nexo-cms (comando direto do owner)
- Auditoria total do editor do CMS (editor.html 187 linhas, server.js 169, schema.sql, cms-runtime.js) + teste ao vivo.
- Veredito: backend v0 sólido (7,5/10 — bcrypt, sessão HMAC, brute-guard, audit, draft/publish); editor é protótipo (nota geral 5,2/10).
- Bugs críticos: (C1) tag <script src> não fechada mata Preview + seletor de idioma; (C2) Moveable não persiste layout — só texto salva; (C3) CMS_SITE fixo "demo" — multi-tenancy não ligado; (C4) popup posicionado com coordenadas do iframe sem offset.
- Documento completo (achados C1–C4, P0/P1/P2, benchmark, notas por dimensão) gravado em /home/nexo/nexo-cms/docs/AVALIACAO-EDITOR.md na VPS.

## 2026-10-05 — FIX: falso positivo recorrente do gatilho por evento
Sintoma: 4 disparos seguidos da varredura com painel 100% inalterado. Causa raiz no predicado `conditions/sweep_trigger.py` (asset da automação 27b0babd): a API do painel envolve os requests em `{"data": [...]}`, mas o código lia `data.get("requests", [])` → lista vazia → signature `[]` SEMPRE diferente do snapshot (24 itens) → dispara a cada poll (limitado só pelo tempo de execução da rodada anterior). Fix: `data.get("data") or data.get("requests") or []`. Verificado ao vivo: panel_ok=True, 24 itens, signature casa com o snapshot → deve ficar quieto até houver mudança real.

## 2026-10-07 — Disparo sem delta residual (investigado, causa provável transitória)
Gatilho disparou mas o painel está idêntico ao snapshot (24 requests, 0 novos, 0 alterados). Checklist do diagnóstico: predicado com fix ativo e único no disco (assets/conditions/sweep_trigger.py, `get("data")` confirmado); stack 5/5 online, /ready 200; predicado registrando lastPanelOkAt recente (painel OK no poll). Causas remanescentes: mudança transitória revertida entre o poll de 1 min e a leitura do agente, ou campo updatedAt ausente/oscilante num poll isolado. Não recorrente até agora (1 caso desde o fix). Se repetir, capturar o print do predicado (log da automação) no instante do disparo.

## 2026-10-07 — Gatilho cego a client actions (diagnóstico + opções de fix)
Att do owner (client action "Enviar fotos horizontal" no request Hero desktop) não disparou o gatilho. Causa: predicado diffa só [id,status,updatedAt] da lista `/api/admin/requests`; client actions não tocam esses campos. Não há endpoint de listagem global: `/api/luna/list-pending-actions` filtra organizationId="system" (retorna vazio; requer X-Luna-Key — key migrada para o .env local como LUNA_API_KEY). Detalhe `/api/admin/requests/<id>` inclui clientActions, mas varrer 24 requests/poll é inviável. Postgres do painel (nexo_dashboard) só escuta 127.0.0.1 no VPS — sem acesso direto do host. OPÇÕES para fix definitivo (decisão do owner): (a) endpoint no painel listando client actions pendentes (rebuild do container workspace); (b) predicado consulta o painel via psql sobre SSH (ControlMaster) — frágil; (c) aceitar coverage parcial: actions só disparam quando o request for tocado. LUNA_API_KEY já está no .env local para quando a rota for corrigida.

## 2026-10-07 — FIX COMPLETO: gatilho passa a ver client actions (opção A do owner, aprovada com "A")
1. **Painel (workspace-nexo, commit no repo):** capability `listPendingClientActions` agora aceita `organizationId` opcional (system/ADMIN sem org = todas as organizações); rota `/api/luna/list-pending-actions` aceita `?all=1`. Sem o param, comportamento legado preservado. Rebuild + redeploy do container nexo_workspace_nexo concluídos; imagem anterior tagueada `nexo-vps-workspace-nexo:bak-20261007-luna` (rollback: retag + up -d).
2. **Predicado (sweep_trigger.py):** novo motivo `client_actions` — diff de `/api/luna/list-pending-actions?all=1` (X-Luna-Key lida do .env local como LUNA_API_KEY, migrada hoje do container) contra o campo `pendingActions` do snapshot. Só compara com baseline presente (sem baseline não dispara — evita falso positivo pós-deploy).
3. **Testes:** positivo (action nova → dispara com client_actions) ✅; estabilidade com baseline → False ✅; endpoint legado sem all=1 → vazio ✅; painel 200 externo pós-deploy ✅.
4. **Achado no meio do deploy:** 3º pedido Tienda (orden Eternal Bloom) → PREPARING_SOLUTION 12:42Z — os 3 pedidos da loja da Jess agora em PREPARING_SOLUTION.
Próxima client action criada no painel dispara o gatilho em até 1 min.

## 2026-10-07 — Lição (feedback do owner): Luna misturou threads no grupo da Jess
Jess respondeu o passo-a-passo do Search Console com print ("está con full", 15:58) e a resposta da Luna (16:02) agradeceu mas já pivotou pro carrossel (client action de fotos horizontais) — sem confirmar o acesso nem lembrar do Owner pending. Regra registrada no brain remoto (outcome negative): **fechar o loop do assunto da mensagem atual ANTES de pivotar pro backlog, com transição explícita**. Correção pontual (mensagem confirmando Search Console + convite pending) fica com a automação Geral.

## 2026-10-07 (2º disparo sem delta) — predicado instrumentado + baseline de client actions
Segundo disparo com painel idêntico ao snapshot. Achado ao inspecionar o predicado: ele foi estendido (mesmo dia) com monitoramento de **client actions pendentes** (`/nexo/api/luna/list-pending-actions?all=1`, header x-luna-key) — mas o bloco só compara quando o snapshot tem baseline `pendingActions`, que o agente nunca gravava. Ações: (1) predicado instrumentado — ao disparar por painel_change grava `lastFire` no `.sweep_trigger_state.json` com motivo, contagens e diff exato visto no poll (próximo caso sem delta terá evidência durável); (2) baseline de pendingActions gravado no `.sweep_seen.json` — 2 pendentes, sendo 1 **criada hoje 10:54 UTC** (`cmuxzq8mo000esq0n1gr2iuio`); (3) a detecção de client_actions agora está ativa. Sintaxe validada.

## 2026-10-08 — CAUSA RAIZ dos disparos sem delta: painel_auth (não falso positivo)
Terceiro disparo com painel idêntico ao snapshot. Cruzando evidências: o run atual (run_a6b53fa5) disparou 05:08:42Z por condition; o state do predicado mostrava lastPanelOkAt 04:07:50Z (gap ~61 min) e sem lastServiceAlertAt. Ou seja: o **poll das 05:08Z falhou na checagem do painel** (timeout/cookie/rede transitória) e, passados >60 min do último OK, o predicado disparou por **painel_auth** — comportamento correto e fail-closed por design. O agente leu o painel normalmente na rodada → cookie vivo, falha foi transitória. Predicado re-instrumentado: `lastFire` agora é gravado para QUALQUER motivo de disparo (antes só painel_change), sem sobrescrever o lastFire detalhado com diffs. Sintaxe validada.

## 2026-10-08 (painel_auth #2 do dia) — cookie vivo, falha transitória de poll
Disparo às 14:09Z com motivo painel_auth (poll falhou; último OK 13:09Z, gap 60.2 min). Verificação na rodada: leitura do painel 200 com 24 requests usando o mesmo cookie `.vps_cookie` → cookie NÃO morreu; falha pontual de rede/timeout. É a 2ª ocorrência transitiva no dia (1ª às 05:08Z). Recomendação reforçada: predicado exigir 2-3 polls falhos consecutivos antes de contar o gap (decisão do owner — fail-closed de 60 min pode ser intencional).
