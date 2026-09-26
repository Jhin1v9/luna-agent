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
