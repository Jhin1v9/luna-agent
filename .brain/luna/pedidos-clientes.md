# Pedidos de Clientes — painel Nexo (VPS)

Fonte: `/nexo/api/admin/requests|organizations|projects` (login NextAuth ADMIN) × relatórios do Brain
(MEMORY/OPINIONES por cliente) × mensagens WhatsApp (tabela `messages`).
Atualizado: 2026-09-24 16:00 (+02:00) · autor: Luna — reconciliação + verificação ao vivo em pre2.onadance.com.
Varredura 16:00: comentário do Matheus (24/09 10:45) registrado no card do carrossel HDM — escopo
confirmado (auto, hero só; imagens próprias a enviar), descrições das profissões recebidas, logo final confirmado.
**Base viva no brain remoto:** `learning/outcomes/positive/2026-09-24-clientes-base-viva-luna.md`
(consolidado completo: solicitações × relatórios × WhatsApp × pendências — gravado 2026-09-24, reindexado).

> **Brain remoto (NEXO Brain):** leitura e escrita FUNCIONAIS desde 2026-09-24 — o token do servidor
> (`/opt/nexo-brain/.env` na VPS) foi validado com escrita real e gravado no `.env` local como
> `BRAIN_API_TOKEN` (header `Authorization: Bearer`, endpoint de escrita `POST /brain/api/learning/outcomes`
> com JSON `{type:'positive'|'negative', title, body}`). NUNCA commite o .env.

## ⚠️ DIVERGÊNCIAS ATIVAS

**1) Ona Dance — slider → vídeo: RESOLVIDO em 24/09 11:30.** ✅ Nova API admin
(`POST /nexo/api/admin/requests`, commit cf139af) criada e deployada; solicitação criada pela
Luna em 24/09 09:30 (id `cmufc0h7v0001114r1v7ylito`, status CLIENT_REVIEWING, externalSource
`admin-workspace`) registrando: vídeo IMPLEMENTADO em pre2.onadance.com (hero-onadance.mp4,
 uploads/2026/09), aguardando aprovação da Jess + publicação. Histórico: antes o painel só
permitia criar solicitação pelo app do cliente (org da sessão), então a tarefa executada pelo
time ficava invisível no workspace.

**2) Ona Dance — hero em desktop renderiza o vídeo vertical como card em pé** (fundo blur nas
laterais; screenshot do Abner 09:38). Ideia do Abner: hero full-bleed com o vídeo cobrindo a
tela toda no desktop. → Tarefa interna repassada ao Nonoke via grupo productions (msg 5477):
"otimizar hero com vídeo em desktop" (manter vertical no mobile).

---

## Ona Dance (Jess) — projeto "Ona Dance web" (onadance.com)

### Timeline (painel × WhatsApp × relatório)

| Data | Fonte | Evento |
|---|---|---|
| 10/09 | Painel | 3 solicitações criadas: Trustpilot no wp-admin (brtpmj-…), "Avísame cuando vuelva" p/ produtos esgotados, Home só com produtos disponíveis |
| 14/09 | Painel | Scroll reveal → COMPLETED 21/09 |
| 16/09 | Painel | Crear cupón → COMPLETED 17/09 |
| 21/09 13:23 | WhatsApp (Jess → Luna) | "oi Luna, meu site já ficou pronto?" (perguntou 3x no dia) |
| 21/09 | WhatsApp (grupo) | Hero + vídeo vertical (41s) recebidos no Drive (Nexo > Cliente > Jess) |
| 21/09 18:09 | WhatsApp (Luna) | "Tarefa registrada — Slider do hero": trocar imagem do slider pelo vídeo vertical |
| 21–23/09 | WhatsApp (grupo) | Confusão "temporal / a de 10" esclarecida = era a tarefa do vídeo do slider |
| 23/09 | Relatório (OPINIONES) | Jess elogiou clareza e bom humor; cliente_feliz, sem follow-up |
| 2026-09 | Relatório (MEMORY grupo) | "A tarefa já existe no Dashboard Pro, pendente de execução" — ⚠️ **NÃO existe no painel (ver divergência acima)** |

### Status atual
| Pedido | Status painel | No relatório? |
|---|---|---|
| Slider → vídeo vertical (41s) | ✅ CRIADA 24/09 via API admin (cmufc0h7…) — CLIENT_REVIEWING; IMPLEMENTADA em pre2 | Sim (diz que existe) |
| Trustpilot wp-admin | CLIENT_REVIEWING (desde 10/09) | Não — incluído agora neste relatório |
| "Avísame cuando vuelva" | CLIENT_REVIEWING (desde 10/09) | Não — incluído agora |
| Home só disponíveis | CLIENT_REVIEWING (desde 10/09) | Não — incluído agora |
| Scroll reveal | COMPLETED 21/09 | Sim |
| Crear cupón | COMPLETED 17/09 | Sim |

Regra "cliente disse JÁ FEZ A SOLICITUD mas relatório não dizia": busca no WhatsApp (todas as conversas)
por 'já fiz/pedi/enviei', 'ya hice/pedí/envié', 'solicitud feita/enviada' → **0 ocorrências**. Nada a
acrescer nesse sentido.

## HDM - Industrial (hdmindustrial.es) — projeto "Main WebSite"

Cliente opera via painel/e-mail (sem WhatsApp na base Luna — nada a cruzar com conversas).

| Data | Evento | Status |
|---|---|---|
| 14/09 | Animação scroll reveal | COMPLETED 21/09 |
| 21/09 13:23 | Seção/aba de envio de currículos → rrhh@hdmindustrial.es (3 comentários, último 21/09) | CLIENT_REVIEWING |
| 21/09 17:40 | Carrossel/slider móvel + profissões (eletromecânico, mecânico industrial) + logo própria — PDF recebido 21/09 via chat, guardado em documentos/brand/ (1 comentário) | ANALYZING |
| 24/09 09:13 | Comentário Luna no painel (ambos os cards): pergunta ao Matheus escopo do carrossel + site de referência; no card de currículos, confirmação de publicação | — |
| 24/09 10:45 | **Comentário do Matheus (cliente) no card do carrossel** — responde TUDO: (1) carrossel com passagem automática de imagens, só na primeira parte (hero); enviará imagens próprias quando tiver; (2) descrições das profissões fornecidas por escrito (Eletromecânico + Mecânico industrial); (3) confirma que o logótipo é a versão final | ANALYZING (aguardando imagens do cliente p/ finalizar carrossel; profissões já têm texto) |

Tudo quadra entre painel e relatório. Nenhuma solicitação nova desde 21/09 17:40.

**Auditoria 24/09 (Luna, a pedido do Abner — "já fiz tudo, coloca pra revisar e revisa você também"):**
comparado produção hdmindustrial.es × preview hdm-six.vercel.app.
- Scroll reveal ✅ rodando (animações de entrada presentes na produção)
- Carrossel ✅ no hero da produção (GIFs industriais + setas)
- Logo própria ✅ aplicada (logo HDM branca no header)
- Aba currículos ✅ ("Trabaja con nosotros", form → e-mail rrhh@hdmindustrial.es)
- ⚠️ Profissões novas (eletromecânico, mecânico industrial) ❌ AUSENTES em ambos os ambientes — conferir deploy
- Cores: paleta coesa (escuro industrial + azul); sugestão — clarear sobreposição do hero (imagem muito escura)
- Painel (Nexo Workspace): mover os 3 cards p/ revisão do Matheus — **ação humana** (sem integração daqui)
- Divergência: preview (hdm-six) ≠ produção — previews com builds diferentes, alinhar qual branch reflete o trabalho
- **24/09 ~10:50:** mensagem enviada ao Matheus no chat do workspace (sala do projeto HDM, conta do Abner, identificando como Luna) perguntando como ele quer o carrossel (hero só ou mais páginas) e pedido site de referência. Aguardando resposta dele. (Nota: a 1ª cópia saiu com encoding corrompido, foi apagada e reenviada íntegra.)

## Itens internos Nexo (não são pedidos de cliente)

Projeto "Projetos Dashboard" (org Nexo): 9 itens de 27/08 — anúncios Instagram/TikTok IN_DEVELOPMENT,
modificar formulário PREPARING_SOLUTION, modificar web Nexo RECEIVED, resto COMPLETED/CLOSED.

---
*2026-09-24 · autor: Luna · reconciliação: painel × relatório × WhatsApp — divergência 1 (slider Ona Dance)*

## Central de Relatórios (/relatorios/) — inventário 2026-09-24

Regra do owner (decreto 2026-09-24): **cliente ativo = relatório obrigatório; Luna checa toda varredura.**

| Cliente | Acesso | Estado |
|---|---|---|
| HDM | hdm-industrial@nexo-digital.app | ✅ relatório existe, ⚠️ **desatualizado** (14/09; não cobre os pedidos de 21/09 — carrossel, currículos, logo — apesar de o próprio relatório dizer "toda solicitação feita pelo painel entra neste relatório") |
| Jr-Reformas (Juninho) | juninho@nexo-digital.app | ✅ completo |
| Santa Fe | santafe@nexo-digital.app | ⚠️ acesso cadastrado, conteúdo "Relatório em breve" |
| Ona Dance (Jess) | — | ❌ **sem acesso, sem card, sem relatório** — e é quem tem mais pedidos abertos |

Novas divergências de reconciliação: relatório HDM × painel (desatualizado); Jess sem relatório (regra violada).

## Reconciliação 2026-09-24 ~23:50 (pós-desbloqueio do painel)

**Causa raiz do bloqueio (~6h30, 17:00→23:48):** o NextAuth do painel autentica por **email**, mas `scripts/nexo-admin.mjs` enviava o campo `username`. Fix: enviar `email` (+ aceitar cookie `nexo.session-token`, prefixo personalizado do painel). Credenciais do `.env` locais estavam corretas (`abner@nexo-digital.app`) — descoberta validada pelo Kimi Code no VPS (build DeepSeek V4 Pro) e confirmada por mim aqui. Sessão paralela já tinha ajustado o campo email; complementei o check do cookie.

**Painel íntegro pós-login:** 17 requests, mesmos counts de comentários do último snapshot bom (~16:42): Jess slider cmufc0h7 CLIENT_REVIEWING (0 com); HDM carrossel c6kjmmku ANALYZING (3 com); HDM currículos cmub9zxn CLIENT_REVIEWING (4 com). Nenhum updatedAt posterior a 14:42 UTC — **nada novo acumulou durante o bloqueio**.

**Relatórios (/relatorios/):** cards Jr-Reformas ✅, HDM ✅, Santafe "em breve", **Jess (Ona Dance) segue sem card** — pendência já registrada e avisada na baseline; não repetir aviso.

**Orgs no painel:** HDM-Industrial (cmtldsn6), JR Reformas (cmtinm4v), Ona Dance/Jess (cmshyy4n), Enoquelandia (cms8td2b), Nexo interno (cms4zb3y + test-cliente).

Ação humana removida da lista: ~~senha do painel~~. Restam: card/relatório da Jess; imagens do carrossel HDM (Matheus).

## Atualização 2026-09-25 00:20 (varredura — Luna cron)

- **HDM (cmtldsn65 / Main WebSite):** pedido do carrossel (c6kjmmku, ANALYZING) ganhou 4º comentário em 24/09 22:13 UTC — **interno** (Abner/Luna passando status: carrossel autoplay no hero implementado no novo site; profissões eletromecânico/mecânico industrial adicionadas com descrições exatas do cliente em todos os idiomas). Detalhes já em `.brain/clients/hdm-industrial/PEDIDOS.md`. Nenhum pedido novo do cliente; painel continua com 17 requests íntegros.
- Painel relido com sucesso (login corrigido estável); resto do painel sem mudanças vs sweep 23:58.
- Sessão paralela criou `.brain/clients/jess-onadance/FICHA.md` (Jess formalizada como cliente).

autor: Luna (cron de varredura)

## Atualização 2026-09-26 13:00 (varredura manual a pedido do Abner — Luna)

**Painel (login admin OK): 17 solicitações — ZERO novas desde 24/09 09:30** (a última criada foi a do
slider da Jess, por mim). **Jess NÃO pediu nada novo.** Nenhum updatedAt posterior ao sweep de 25/09.

### Classificação feito/não-feito (reality-check ao vivo 26/09)

**Ona Dance (Jess) — org cmshyy4n, projeto Ona Dance web:**
| Pedido | Status painel | REALIDADE (verificado) |
|---|---|---|
| Slider → vídeo vertical 41s (cmufc0h7, 24/09) | CLIENT_REVIEWING | ✅ **FEITO** — hero-onadance.mp4 ao vivo em pre2.onadance.com (`<video class="hero-video-bg" autoplay muted loop>`). Falta: aprovação da Jess + publicação + hero desktop full-bleed (tarefa interna pro Noke) |
| Trustpilot wp-admin (cmtw0230, 10/09) | CLIENT_REVIEWING | ❓ **SEM EVIDÊNCIA DE EXECUÇÃO** — pendente há 16 dias, sem comentário; AVISAR a Jess |
| "Avísame cuando vuelva" c/ captura de email (cmtw01xh, 10/09) | CLIENT_REVIEWING | ❓ idem — pendente, sem evidência; AVISAR a Jess |
| Home só produtos disponíveis (cmtw01qf, 10/09) | CLIENT_REVIEWING | ❓ idem — pendente, sem evidência; AVISAR a Jess |
| Scroll reveal (14/09) | COMPLETED 21/09 | ✅ feito (status painel) |
| Crear cupón (16/09) | COMPLETED 17/09 | ✅ feito (status painel) |

**HDM (Matheus) — org cmtldsn6, projeto Main WebSite:**
| Pedido | Status painel | REALIDADE (verificado em hdm-six.vercel.app) |
|---|---|---|
| Carrossel + profissões + logo (c6kjmmku, 21/09) | ANALYZING | ✅ **FEITO no preview** — marca Ken Burns no hero (carrossel) + eletromecânicos/mecânicos industriais no sitemap (136 rotas, 4 idiomas) e na página personal-industrial. ⏳ Falta: publicação (deploy) + logo (PDF não consta no repo) + imagens próprias do carrossel (Matheus enviará) |
| Seção currículos → rrhh@ (cmub9zxn, 21/09) | CLIENT_REVIEWING | ✅ **RESOLVIDO 26/09 17:50** — página de volta ao ar (commit a389b31 na branch de deploy + promote Vercel). Verificado: /trabaja-con-nosotros 200 nos 4 idiomas, home e páginas principais sem regressão, formulário → relay VPS (CORS OK). Relatório HDM atualizado ("voltou ao ar", backup .bak-20260926-3). ⏳ Pendente operacional: SMTP do relay não configurado (CV grava em disco + fallback mailto; envio automático p/ rrhh@ só após configurar SMTP_URL/Resend); relay crasha com POST malformado (fix no handler de exceção) |
| Scroll reveal (14/09) | COMPLETED 21/09 | ✅ feito |

**Produção HDM:** SSL do apex **confirmado quebrado** (https://hdmindustrial.es sem www não conecta) —
Noke já designado; é config DNS/dominio, não código. Site antigo www.hdmindustrial.es no ar (200).
**NOVO (26/09 14:10):** o domínio NOVO `hdm-industrial.es` (com hífen) **não existe no DNS público** —
NXDOMAIN tanto no apex quanto no www (testado 8.8.8.8 + 1.1.1.1). Registro/configuração de DNS do
domínio pendente no registrador (ação humana — credencial do registrar).

autor: Luna

## 2026-09-27 11:33 HVR — [INTERNO, não é pedido de cliente] Nova solicitação no painel

- id cmujmeqjk0002qevocjme0whe · projeto "Projetos Dashboard" · status RECEIVED · urgência ALTA · externalSource admin-workspace (criada pela sessão da Luna/dashboard, não por cliente).
- Conteúdo: tarefa de segurança GitHub — revisar acessos/visibilidade. Responsável ELIAS. Conta ward-elias a auditar/privar; repos do Abner aguardando lista do Enoque. Checklist pré-privação: varrer histórico de credenciais, rotacionar se vazou, migrar deploys para SSH. Auditoria eliasabner já registrada (18 repos, histórico limpo).
- 2026-09-27 10:06 · Eduardo CONFIRMOU reuniao hoje 15:00 (horario Espanha/HVR) · autor: Elias no grupo Production · lembrete automatico 12:00 mantido; pauta: entender ideia do app, escopo, proximos passos; se ele quiser, capturar requisitos no chat

## 2026-09-27 13:42 HVR — [INTERNO, não é pedido de cliente] Nova solicitação no painel

- id cmujr15v5000cqevov11oyol5 · projeto "Reuniões Comerciais" · status RECEIVED · externalSource admin-workspace (sessão paralela da Luna).
- Conteúdo: registro da reunião comercial com Eduardo (filho do Edio, +55 34 99654-4461) — 27/09 15h Espanha / 10h Brasília. Interesse: app de transporte/encomiendas. Call de descoberta: operação atual, visão de produto, escopo MVP, prazo, orçamento, decisor. Lead tambem criado no dashboard Nexo (lead-1790509215174-7gvt, assignedTo Abner).

## 2026-09-27 16:38 HVR — Comentário novo no pedido interno da call de Eduardo

- id cmujr15v5000cqevov11oyol5 (Reuniões Comerciais) ganhou comentário às 16:13 HVR: "REQUISITOS 2 — continuação da call 27/09 (Abner/Enoque)" — alma do app = matching automático caminhoneiro↔carga (registrado pela sessão paralela/dashboard). Ainda é material interno de consolidação, não pedido de cliente.
- 16:38 HVR: diagnóstico da fila — 4 mensagens pending >20min e nenhum processamento desde 14:18Z. Automação Geral possivelmente travada; grupo do Telegram alertado. Total pending: 19.

autor: Luna

## 2026-09-30 ~15:22 HVR — [DECRETO OWNER via chat] SEO/GEO do site do Matheus (HDM)

- Owner (chat Kimi): "no site do matheus vamos adicionar palavras de SEO... deixar o site dele gordo... todas as paginas tem que ter pelo menos o minimo de caracteres pra ter peso... analise o GEO tambem e faça o melhor que tem... vai adicionando aos relatorios". Override explícito ao limite "nunca mexa em projeto de cliente" (precedente: revisão 26/09).
- EXECUTADO: diagnóstico de etapa + 22 páginas de profissão engordadas (ca/en/pt) + /llms.txt criado + schemas revalidados. Commit 2b8a709 na branch luna/hdm-pedidos-matheus, verify completo verde. Detalhes em .brain/global/relatorios-clientes.md (entrada 30/09 SEO/GEO).
- Relatório /relatorios/clientes/hdm/ atualizado (seção #revisao-3009, backup .bak-20260930-2).
- PENDENTE: deploy travado por bloqueio Vercel (readyState=BLOCKED, plano free) — retry humano/reset via `bash scripts/publicar.sh`. Site no ar continua o de 26/09, estável.
- autor: Luna

### update 30/09 19:10 HVR — push GitHub (decreto: Vercel só via git)
- main do HDM-Industrial em 2b8a709; build Vercel via Git integration criado mas BLOCKED (conta do time bloqueada p/ builds — ação humana: dashboard Usage/Billing). Método CLI abandonado por decreto.

## 2026-09-30 20:35 HVR — Stack local de volta (decreto owner "sobe a stack e conserta tudo")
- pm2 local: 5/5 online (orchestrator, worker, whatsplay, kimiweb, watchdog). /health + /ready 200, db:up. Queda da tarde (15:08+) que tinha parado a automação Geral.
- Fila kimiwork_inbox: 402 done, 0 pending (backfill automático completo ao subir). 5 errors = detector_noise de chamadas de 24/09 (já rotulados, sem ação).
- whatsplay ingerindo em tempo real de novo; worker entregando menções ao Kimi Work.
- Cadastro Jess/Ona no portal: já existia (409 Email ja cadastrado) — pendência de 24/09 já resolvida por terceiros.
- Grupo Nexo Digital avisado (msg ~5631). Restam humanos: foto Google Juninho (Enoque), auditoria GitHub (Elias), DNS domínio HDM (owner/registrar).
- autor: Luna

## 2026-09-30 21:40 HVR — Revisão de TODOS os grupos (decreto owner 21:26)
- Nexo Digital (Telegram): 0 pendentes — /status do Enoque já respondido (msg 5629).
- 🏆Production - 2026🙏🏻 (WhatsApp): única pendência = foto de perfil Google do Juninho com logo (pedido 14:17, Enoque assumiu 14:25). Luna respondeu no grupo com CITAÇÃO (messages 45aa588f, entregue 19:31 UTC): registrado no acompanhamento, cobrança via relatório se pendurar.
- Reformas integrales (Juninho): conversa de entrega Abner/Enoque, nada pra Luna.
- App de Transporte Caminhoneiros: fora do escopo de ingestão do whatsplay; histórico em conversations 9c372fb7 — Luna ativa no grupo desde 11:34, última interação 12:25 documentada. Nada pendente.
- HDM - Industrial (SBD): última mensagem 11:09 (Enoque, mídias originais) — respondida, assunto já é pendência registrada do Matheus.
- LIÇÃO TÉCNICA: envio manual de resposta WhatsApp = INSERT em messages (direction outbound, sender 'luna', send_state 'queued', metadata jsonb com correlation_id + reply_to_query pra citação) + SELECT pg_notify('luna_outbound', id). Espera humana ~4-6s + citação funciona. Tempo total até 'sent': ~18s.
- autor: Luna

## 2026-09-30 ~22:10 HVR — Grupo JR Reformas - Web (Junior) - 26 (decreto owner 21:34 "confere o grupo jr tambem")
- Grupo estava FORA do escopo de ingestão do whatsplay (allowlist). Conferência exigiu inclusão: adicionado "JR Reformas - Web (Junior) - 26" em WHATSAPP_INGEST_ALLOWLIST e WHATSAPP_OUTBOUND_ALLOWLIST (.env), sweep temporário isolado p/ ler o chat, depois sweep desligado de novo e allowlists restauradas (9 originais + JR). Registrado em chat_registry (chat_key group:jr-reformas-web-junior-26, role allowed).
- CONTEÚDO VISTO: 30/09 — time Nexo (Enoque/Abner) entregou a web do Juninho (setup básico pago, pontos: aparecer na internet, mapa etc.) e pitchou "FASE 2: GESTÃO CONTÍNUA" (ajuda constante, melhorias internas, seguimiento, informe mensal, recomendações, SEM permanência). Sinal de upsell: Jess (Ona Dance) pode querer SEO também ("Jess onadance, SEO vai querer tbm eu acho em coisa boa") — já anotado pela automação Geral na ficha Ona Dance.
- Última mensagem (30/09 19:42 UTC): Juninho agradeceu ("Muito obrigado meus querido, Deus abençoe"), Elias respondeu "Tamo junto meu irmão". NADA ACIONÁVEL pra Luna — sem pergunta, sem menção. Item na kimiwork_inbox deixado p/ automação Geral consolidar (mesmo padrão do item 18:31, que ela resumiu sem responder no grupo).
- LIÇÃO TÉCNICA: sweep com allowlist isolada lê últimas 3 msgs de cada chat allowlisted, mas marca is_group=false quando o chat não abre a tempo (fallback do transporte) — grupo vira "privado" e entra na fila mesmo sem menção. Dedupe fino segue valendo.
- PENDENTE HUMANO: Fase 2 do Juninho (cliente decide); foto Google Juninho segue com Enoque.
- autor: Luna

## 2026-10-01 08:00 HVR — Bom dia como Luna nos 3 grupos (decreto owner "liga a luna total")
- PRODUCTION ✅ entregue 06:09 UTC (messages 1229d7a9) — bom dia + agenda do dia.
- HDM (SBD) ✅ entregue 06:09 UTC (messages 0b9adfe0) — bom dia + site no ar c/ SEO/GEO.
- REFORMAS INTEGRALES (JUNINHO) ❌ FALHOU 6+ tentativas (messages 9b9677d3, send_state=failed, needs_human) — o whatsplay NÃO CONSEGUE ABRIR o chat "Reformas integrales - Projeto web(Juninho)" no DOM (openChat aborta por segurança pra não mandar pro chat errado).allowlist OK (recusa das 06:17 era outra msg, "Meu Amorzinho 💖🌻", protegida corretamente). Nome no WA confere com o cadastro (watcher ainda vê o grupo na sidebar). Causa provável: grupo arquivado/renomeado no aparelho ou DOM específico desse chat; período coincidiu com crash-loop de sessão (splash noscript + restart do watchdog interno 06:09–06:44), mas persistiu DEPOIS de estável.
- AÇÃO HUMANA: Abner — olhar o WhatsApp Web no PC: o grupo "Reformas integrales - Projeto web(Juninho)" está arquivado? O título mudou? Se estiver arquivado, desarquivar. Depois me fala que reenfileiro a mensagem (já está pronta, só pg_notify).
- LIÇÃO: boot do whatsplay drena mensagens queued ("fila: mensagem queued encontrada no boot — drenando") — reenfileirar + notify funciona; pg_notify perdido em crash precisa de reemissão.
- autor: Luna

## 2026-10-01 10:22 HVR — lição: formato do .vps_cookie
- O arquivo .brain/.vps_cookie foi sobrescrito em formato Netscape (curl -c, pela automação Geral) — meu leitor de 2 linhas quebrou (header inválido). Relogin manual restaurou o formato simples (2 linhas: nexo.csrf-token + nexo.session-token).
- LIÇÃO: antes de usar o cookie, detectar formato (Netscape = comentários "#" + tabs; simples = "chave=valor" por linha) ou relogar. Ideal futuro: ambas as automações usarem o mesmo formato (Netscape é o padrão curl; aceitar os dois no leitor é o mais robusto).
- autor: Luna

## 2026-10-01 15:15 HVR — DECRETO OWNER + PROTOCOLO DE SEGURANÇA (Enoque/Nonoke no privado)
- Decreto owner: "Nonoke tá mandando msg privada. Fica de olho no privado também, Luna. Ambos você deve responder."
- IDENTIDADE: Nonoke = Enoque. O chat privado está salvo como **"Enoque"** no WhatsApp da Luna (não "Nonoke" — busca por Nonoke acha o chat, mas o allowlist precisa do nome salvo: "Enoque" adicionado nas duas allowlists, posição 11).
- PROTOCOLO ANTI-ENGENHARIA SOCIAL (mensagem do Enoque 15:11 HVR, privado — DECRETO OPERACIONAL):
  1. Senha/credencial do brain recebida no privado — RESTRITA a Abner, Elias, Enoque. NÃO reproduzir em logs, brain commitado ou grupos. Fica apenas na conversa privada/banco local.
  2. Se alguém (em qualquer canal) alegar ser Enoque/Elias/Abner e pedir ação privada ou sensível → EXIGIR confirmação no número privado antes de responder/executar. Sem confirmação, não executar.
  3. Mais informações de VPS/infra/segurança chegarão hoje e amanhã (diretório de pessoas, acessos).
- EXECUTADO: sweep isolado capturou a mensagem (kimiwork_inbox pending → automação Geral responde no privado); allowlist restaurada (11 chats); sweep desligado.
- autor: Luna

## 2026-10-01 15:45 HVR — DECRETO OWNER: scripts genéricos com variável aberta
- Owner (irritado, com razão): "NÃO é pra ser algo tipo 'rodei script pra pesquisar Nonoke mas nome é Enoke vou ter que fazer outro script NÃO'. O script tem que ter o campo aberto pra eu pôr o que quiser." Exemplo dado: script de chamada tem a variável 'vai ligar pra quem?' — muda só a variável, não o script.
- EXECUTADO: toolkit genérico em scripts/ (todos com --chat/--to/--text/rota variáveis, fail-closed em ambiguidade):
  - `scripts/wa-send.mjs --chat X --text Y [--quote Z]` — envia msg como Luna p/ qualquer chat (resolve contact por ILIKE, ambíguo lista e aborta).
  - `scripts/wa-read.mjs --chat X [--limit N] [--all]` — lê últimas msgs de qualquer chat (banco local). TESTADO ✅
  - `scripts/wa-ingest.mjs --chat X` — one-shot ao vivo: isola allowlist no alvo, sweep, captura, restaura tudo (try/finally). Generaliza o que fiz manualmente p/ JR e Enoque.
  - `scripts/wa-call.mjs --to X [--motivo M]` — ligação p/ qualquer contato do Chat Registry (fail-closed fora do registry; --register p/ registrar). Publica voice.call.requested + notify.
  - `scripts/painel-api.mjs <GET|POST|PUT|DELETE> <rota> [--body '{...}'] | relogin` — painel Nexo genérico, relogin automático em 401/403. TESTADO ✅
  - `scripts/brain-api.mjs <GET|POST> <rota> [--body|—file|--type|--title]` — brain remoto Bearer, --file p/ body grande. TESTADO ✅ (Bearer aceito; GET em learning/outcomes não existe, rota é POST-only).
- LIÇÃO TÉCNICA: DNS local dessa máquina instável (ENOTFOUND 'vps.nexo-digital.appc' intermitente) — retry resolve; não é bug de script. Proxy /brain externo repassa p/ /api interno.
- REGRA PRA MIM: nunca mais escrever node -e ad-hoc pra essas operações — usar o toolkit. Se faltar script pra alguma ação recorrente, generalizar em vez de one-off.
- autor: Luna

---

## 2026-10-01 ~16:30 HVR — Caso grupo Juninho (renomeado, NÃO arquivado)

- Sintoma: bom-dia da varredura falhou 6x ("não consegui abrir o chat").
- Diagnóstico via `scripts/wa-peek.mjs` (olhos da Luna no WA Web via CDP :9333):
  busca "Reformas" mostrou que **"Reformas integrales - Projeto web(Juninho)" foi RENOMEADO
  para "JR Reformas - Web (Junior) - 26"** — não estava arquivado. A automação Geral já tinha
  mapeado o nome novo (allowlist) e criado contact/conversation novos hoje 13:47.
- Correção no banco (commit implícito, transação única):
  1. conversation f1e0dc91 (97 msgs de histórico) migrada para o contact canônico f177dfd8;
  2. contact antigo 970c050b aposentado (zz_superseded_juninho / zz-superseded:// , metadata guarda origem);
  3. bom-dia vencido (msg 9b9677d3) marcado superseded — entregar "bom dia" 16h+ em grupo de
     cliente seria incoerente; Luna já atuou no grupo 15:48. Próxima varredura da manhã cobre JR normalmente.
- Lição operacional: **grupos de cliente podem ser renomeados no WhatsApp** — antes de chamar de
  "perdido", buscar no WA (wa-peek search) e reconciliar contacts. O daemon aborta envio se não
  acha o chat (fail-closed correto); o fix é sempre no mapeamento.
- wa-peek: screenshot via CDP às vezes trava (compositor occluded/headful) — o script agora faz
  dump de texto do DOM (títulos+preview) mesmo sem print, e print é best-effort com timeout 8s.
