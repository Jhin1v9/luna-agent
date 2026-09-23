# Pedidos de Clientes — painel Nexo (VPS)

Fonte: `/nexo/api/admin/requests|organizations|projects` (login NextAuth ADMIN) × relatórios do Brain
(MEMORY/OPINIONES por cliente) × mensagens WhatsApp (tabela `messages`).
Atualizado: 2026-09-24 01:45 (+02:00) · autor: Luna — varredura com reconciliação bidirecional.

> **Brain remoto (NEXO Brain / atlas):** leitura aberta OK (`/brain/api/*` — nodes, search, timeline,
> synapse/status). Escrita exige `Authorization: Bearer $BRAIN_API_TOKEN` — o token vive SÓ no env do
> servidor atlas na VPS (não está neste repo, .env ou backups). Sem ele: 401. Não burlar.
> **Ação humana:** gerar/copiar o token do servidor e colocar no `.env` local como `BRAIN_API_TOKEN`.

## ⚠️ DIVERGÊNCIA ATIVA

**Ona Dance — slider → vídeo vertical: no relatório, FORA do painel.**
O relatório do grupo (MEMORY 2026-09) e as mensagens de 21–23/09 dizem que a tarefa "trocar o slider do
hero da onadance.com pelo vídeo vertical da Jess (41s)" está registrada no Dashboard Pro e pendente de
execução. **Conferi as 16 solicitações do painel: ela NÃO existe lá.** O painel não tem rota REST de
escrita (server actions; PATCH → 405), então não pude criar. → Abner/time: criar a solicitação no painel
ou liberar escrita. Sem isso a tarefa mais quente da Jess está invisível pro time no workspace.

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
| Slider → vídeo vertical (41s) | ❌ AUSENTE do painel | Sim (diz que existe) |
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

Tudo quadra entre painel e relatório. Nenhuma solicitação nova desde 21/09 17:40.

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
