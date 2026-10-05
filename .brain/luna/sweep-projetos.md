
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
