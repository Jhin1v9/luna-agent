# Pedidos de Clientes — painel Nexo (VPS)

Fonte: `/nexo/api/admin/requests|organizations|projects` (login NextAuth ADMIN) × relatórios do Brain
(MEMORY/OPINIONES por cliente) × mensagens WhatsApp (tabela `messages`).
Atualizado: 2026-09-24 09:45 (+02:00) · autor: Luna — reconciliação + verificação ao vivo em pre2.onadance.com.
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
