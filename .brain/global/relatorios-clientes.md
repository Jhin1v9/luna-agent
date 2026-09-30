# Global — Nexo Digital

Regras operacionais, procedimentos e decisões. Append-only, assinado `data + autor`.

## 2026-09-24 · REGRA (decreto owner) — Relatório de cliente é obrigatório
- **Todo cliente ativo tem que ter relatório em `vps.nexo-digital.app/relatorios/`.**
- A Luna checa isso em TODA varredura: login por e-mail do cliente em `/relatorios/entrar`
  (cliente entra só com e-mail; sem senha) e conferir se o relatório existe e está atualizado
  (seção "Pendências do cliente" tem que refletir os pedidos abertos do painel).
- Sem relatório = pendência registrada e reportada ao Abner.
- autor: Luna (registrando decreto verbal do owner, 2026-09-24 ~01:40)

## 2026-09-24 · Inventário de relatórios (baseline)
| Cliente | E-mail de acesso | Relatório | Estado |
|---|---|---|---|
| HDM Industrial | hdm-industrial@nexo-digital.app | /relatorios/clientes/hdm/ | ✅ existe, **desatualizado** (14/09 — não cobre pedidos de 21/09) |
| JR Reformas (Juninho) | juninho@nexo-digital.app | /relatorios/clientes/jr-reformas/ | ✅ completo |
| Santa Fe | santafe@nexo-digital.app | /relatorios/clientes/santafe/ | ⚠️ acesso OK, conteúdo "em breve" |
| Ona Dance (Jess) | — | — | ❌ SEM acesso, SEM card, SEM relatório |
- Nota: e-mail jr-reformas@nexo-digital.app (painel) ≠ juninho@nexo-digital.app (relatórios).
- autor: Luna

## 2026-09-24 · Re-verificação (21:20, login cliente por e-mail — Luna)
| Cliente | Estado verificado ao vivo |
|---|---|
| HDM Industrial | ✅ **atualizado até 21/09** — "Trabaja con nosotros (envio de currículos)" consta como entregue. ⚠️ RESSALVAS: (1) pedido do carrossel/profissões/logo (painel, ANALYZING desde 21/09 17:40) **não aparece em nenhuma seção** — o relatório promete "toda solicitação feita pelo painel entra neste relatório"; (2) rodapé ainda diz "Atualizado em 14 Set 2026". Bloco pronto pra colar (ação humana — portal fora do repo nexo-workspace, sem SSH daqui):<br>*"21 Set 2026 — Em análise: carrossel/slider de imagens em movimento, novas profissões (eletromecânico, mecânico industrial) e aplicação da logo própria. Pedido recebido pelo painel em 21/09; aguardando definição do Matheus (escopo: hero ou mais páginas; site de referência) pra entrar em desenvolvimento."* |
| JR Reformas | ✅ completo (baseline 01:40, sem alterações conhecidas) |
| Santa Fe | ⚠️ acesso OK, conteúdo "em breve" (inalterado) |
| Ona Dance (Jess) | ❌ SEM card — e-mail dela onadance@nexo-digital.app existe no workspace mas não no portal (cadastro = ação humana) |
- autor: Luna

## 2026-09-24 · Deduplicação do workspace (decreto owner "desduplica tudo")
- Removidos: 25 tmp-*.mts (whatsplay), tmp-opchat*.png, .env.bak-20260923-154357 e .env.bak-cerebro (secrets fora do repo), caches de análise (.brain/.chunk_*, .cli_*, .crm_*, screen_*.png, snapshots .vps_*/.cliente_*), tmp-login-debug.json.
- Mantidos: cookies de sessão (.vps_cookie/.cliente_cookie/.rel_cookie), clone do repo nexo-workspace (.brain/.nexo-workspace-src), logs, .last_sweep.json.
- Chats "Luna — Cron" duplicados na sidebar do Kimi: limpeza visual = ação humana (this chat é o oficial).
- autor: Luna

## 2026-09-26 · HDM ATUALIZADO — aba "Revisão" criada ao vivo (Luna, via Tailscale)
- Portal `/relatorios/clientes/hdm/` ganhou a seção `#revisao` ("Análise do site novo, desktop e celular", 26 Set 2026): estética aprovada + 5 achados (prefetch 404, faixa vazia mobile, botão footer com zoom, banner cookies, autorotação do carrossel a verificar) + itens já mapeados (alt text, /cookies). Nav link + entrada no changelog.
- Backup: `index.html.bak-20260926` no host. Verificado com sessão team HMAC: seção servida OK; sem cookie = 303 pro login (gate intacto).
- Acesso `hdm-industrial@nexo-digital.app` JÁ existia em `data/users.json` (slug hdm) — confirmado, não precisei criar.
- Método: `ssh vps` (Tailscale) — skill `vps-tailscale` registrada. Fim da "ação humana" pra editar relatório.
- autor: Luna

## 2026-09-27 · LEAD Eduardo (app de transporte) — página viva criada e no ar (Luna, via Tailscale)
- Pedido do grupo Production: documentar o brainstorm do lead Eduardo "do jeito que os grandes fazem".
- Brain: criado `.brain/leads/` (hub LEADS.md) + `.brain/leads/eduardo-app-transporte/` com LEAD.md (ficha completa), CONVERSAS.md (transcrição fiel) e ENTENDIMENTOS.md (6 pilares + licenças Apple/Google, MVP, perguntas abertas, sentimento). Fonte da landing em `landing/index.html` na mesma pasta.
- VPS: página em `/relatorios/clientes/eduardo-transporte/` (slug `eduardo-transporte`, SEM entrada em users.json — lead é visão interna da equipe; se virar cliente, cadastrar e-mail).
- Dashboard: card "🟡 Lead · Eduardo — App de Transporte" adicionado no topo da Área da equipe (`/relatorios/nexo/`). Backup: `public/nexo/index.html.bak-20260927-lead`.
- Verificado ao vivo: sem cookie = 303 pro login (gate intacto, externo via Caddy); com sessão team HMAC = 200, 14.814 bytes, conteúdo completo.
- autor: Luna

## 2026-09-30 · HDM RE-VALIDADO + relatório atualizado ao vivo (Luna, via Tailscale)
- Pedido owner: relatório /relatorios/clientes/hdm/ estava parado em 26 Set 2026. Re-auditoria ao vivo do preview (hdm-six.vercel.app, desktop+mobile): /cookies → 200, /trabaja-con-nosotros → 200, zero HTTP ≥400 fora prefetch, carrossel 30s rodando ("01 / 04"). DIVERGÊNCIA ACHADA: relatório de 26/09 dizia "todos os itens corrigidos", mas alt vazio SEM aria-hidden persiste nos slides inativos (plant-industrial, mobilization-logistics, epi-safety) e "Montadores de estructuras" ainda quebra em 3 linhas (card 155px, 14px) — correção do site = ação do dev (re-deploy).
- RELATÓRIO ATUALIZADO (ssh vps, bind mount): nova entrada changelog "30 Set 2026 — Re-validação ao vivo" (currículos/cookies/carrossel confirmados + 2 pendências finas + mídias próprias recebidas em tratamento) + banner de re-validação na aba #revisao. Backup index.html.bak-20260930. md5 local=VPS conferido; gate sem cookie = 303 pro login (intacto).
- Fora do relatório (interno, 29/09): Matheus confirmou preço 19.99 do portal; Enoque preparando Dossiê Técnico & Proposta Comercial; mídias originais do Instagram recebidas — prévia pendente de tratamento.
- autor: Luna

## 2026-09-30 · HDM SEO/GEO — site engordado + llms.txt (Luna, decreto owner via chat 15:22)
- Diagnóstico da etapa: SEO técnico OK (160 páginas, 1 h1/title/canonical/hreflang cada, suite check:seo verde), home gorda (~6.200 chars), MAS perfis ca/en/pt magros (~1.760–1.950 chars — só ES completo) e GEO inexistente (/llms.txt = 404).
- APLICADO no repo hdm-industrial (branch luna/hdm-pedidos-matheus, commit 2b8a709, autor Luna): (1) rota app/llms.txt/route.ts — índice markdown gerado dos mesmos registros do sitemap (8 perfis, 5 soluções, setores, cobertura, contato), 6.016 bytes no out/; (2) 22 blocos de perfis ca/en/pt engordados com queHacen/cuando/verifica/faq traduzidos do ES — páginas de profissão passaram de ~1.800–1.950 para 2.257–3.394 chars visíveis em todos os idiomas; schemas Organization+FAQPage+hreflang já existiam e foram revalidados.
- Verify completo passou (lint+typecheck+96 testes+placeholders+claims+build+check:seo). Scripts tmp deletados antes do commit.
- DEPLOY BLOQUEADO: 6 tentativas de source-deploy (vercel deploy --prod --archive=tgz) entre 16:20–17:30 — upload OK, build nunca inicia, API retorna readyState=BLOCKED (token válido, projeto não pausado, fila limpa após rm dos 5 órfãos). Builds de 26/09 duravam 19–26s; últimos 4 dias sem build bem-sucedido. Causa: limite/bloqueio do plano free do time na Vercel — ação humana: dashboard Vercel (Usage/Build Settings) ou aguardar reset e rodar `bash scripts/publicar.sh`. NADA QUEBRADO no ar (produção estável no build de 26/09).
- Relatório atualizado via Tailscale: seção #revisao-3009 "SEO + GEO" no /relatorios/clientes/hdm/ (backup index.html.bak-20260930-2). Gate 303 sem cookie = intacto, comportamento normal.
- Pendências HDM inalteradas: fotos próprias, logo final, currículos, DNS hdmindustrial.es.
- autor: Luna
