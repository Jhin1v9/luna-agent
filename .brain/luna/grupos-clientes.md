# Mapa de grupos — clientes × WhatsApp

> Decreto owner 2026-09-24: "mapear esses sites com os clientes... salvar o
> grupo... pra quando a Luna tiver que responder HDM no WhatsApp saber onde
> tá o grupo. Sempre que tiver mensagem nova DELES → manda pra gente no
> grupo (Production); sempre que tiver mensagem NOSSA → manda pra eles no
> grupo DELES."
>
> JIDs extraídos do storage oficial do WhatsApp Web (IndexedDB do perfil
> dedicado) em 24/09 — fonte confiável, coerente com nomes vizinhos.

## Grupos de CLIENTE (Luna entrou em 24/09 — ingest + resposta habilitados)

| Cliente | Grupo | JID | Quem |
|---|---|---|---|
| HDM - Industrial | `HDM - Industrial (SBD) - 26` | `120363428577835024@g.us` | Matheus ("Noke") |
| JR Reformas | `Reformas integrales - Projeto web(Juninho)` | `120363411799534605@g.us` | Juninho |
| Eduardo (Dudu) — App de Transporte | `App de Transporte Caminhoneiros` | *(JID a capturar na 1ª ingest)* | Eduardo ("Dudu") + time (Abner, Enoque, Elias) |

**Grupo do Dudu (criado 30/09 pelo Abner, pedido owner em chat direto):**
- conversation_id `9c372fb7-15a0-49ea-a535-e92aa778efa6` · client `05c1160e-…` (code `eduardo-app-transporte`) · chat_registry `group:app-transporte-caminhoneiros`
- Contato do GRUPO (delivery usa ele): `df77c38e-…` address = nome do grupo. Contato pessoal do Dudu: `76d61e2e-…` `5534996544461` (+55 34 99654-4461), dudu@nexo-digital.app.
- Na allowlist (nome) desde 30/09 — **adicionar o JID `@g.us` quando a 1ª mensagem do grupo entrar na ingest** (padrão HDM/Juninho).
- Decreto owner 30/09: o grupo alimenta o relatório vivo do projeto (slug `eduardo-transporte`); time pede "add no relatório" e a Luna registra. Um chat por assunto: grupo = projeto do app.

## Grupo INTERNO do time

| Grupo | JID | Uso |
|---|---|---|
| 🏆Production - 2026🙏🏻 | `120363424730639134@g.us` (eliminação; sistema já usa o nome) | time Nexo (Abner, Enoque/Elias, Jhin) |

## Regra de roteamento (decreto owner)

1. **Mensagem nova em grupo de cliente** (HDM/Juninho) → ingere → Luna trata → resposta **no grupo deles** (metadata.chat_id = nome do grupo).
2. **Menção/tarefa no Production** → executa → resposta no Production (fluxo já existente).
3. Resposta nunca sai do grupo de origem (regressão testada: roteamento por chat_id da conversa).

## Allowlists (.env)

- `WHATSAPP_INGEST_ALLOWLIST` e `WHATSAPP_OUTBOUND_ALLOWLIST` carregam os
  nomes e jids dos dois grupos de cliente (atualizado 24/09).
- Números pessoais dos integrantes: owner salva como contato no aparelho;
  quando houver jid pessoal (`NNNN@s.whatsapp.net`), registrar na ficha do
  cliente em `.brain/clients/<cliente>/MEMORY.md`.

## ⚠️ REGRA DE OURO DO ENVIO (incidente 28/09 — CAUSA RAIZ encontrada)

**O delivery do whatsplay resolve o destino pelo CONTATO DA CONVERSA**
(`conversations.contact_id → contacts.address`) — `metadata.chat_id` é
IGNORADO na entrega. Responder grupo de cliente com INSERT na
conversation_id do PRODUCTION = mensagem entregue no PRODUCTION
(aconteceu 4x: 2 mensagens HDM + 1 Juninho no dia 27/09, 2 HDM no dia 28/09).

- **Resposta SEMPRE com `conversation_id` do PRÓPRIO evento** (vem em
  `payload.conversation_id`): HDM = `88200635-…`, Juninho = `f1e0dc91-…`,
  Production = `23ad6088-…`. `metadata.chat_id` continua preenchido, mas é
  só informativo.
- Fix estrutural proposto (Jhin): delivery priorizar `metadata.chat_id` quando
  presente, com send-safety cruzando os dois.

## Fichas dos clientes

- HDM: `.brain/clients/hdm-industrial/MEMORY.md` (+ pedidos em `.brain/luna/pedidos-clientes.md`)
- Juninho: `.brain/clients/jr-reformas-juninho/MEMORY.md`

### Nota 30/09 — consolidação do grupo do Dudu

A 1ª ingest do grupo criou client/contact/conversation PRÓPRIOS. Consolidado: conversation
canônica `9c372fb7-…` (client Eduardo `05c1160e`, contacto do grupo `df77c38e`); client duplicado
da ingest virou ALIAS (FK em events impede delete) e o contacto duplicado foi removido.

### Grupo novo 30/09 — JR Reformas 2026

- **`JR Reformas - Web (Junior) - 26`** — conversation `ac5028fa-333e-4afd-a0ff-7ed5dd0c06ad`.
  Grupo 2026 do Juninho (padrão "- 26" como o HDM SBD-26). Participante visto: Elias (Superclim
  Servicios) + Júnior Reformas. Distinto do DM `Reformas integrales - Projeto web(Juninho)`
  (conv `f1e0dc91`). Ainda NÃO está na allowlist (só entrou na ingest por exceção/coincidência) —
  **adicionar nome + JID quando confirmado com o owner**, e mapear roteamento (resposta no grupo dele).

## DECRETO OWNER 2026-10-01 (chat direto): "responder SEMPRE que falarem luna"

O Abner cobrou a Luna silenciosa em grupos onde chamaram ela sem resposta. Regra nova, válida
para TODOS os grupos (Production + grupos de cliente + grupo do Dudu):
**mencionaram "luna" (em qualquer variação) → a Luna RESPONDE no grupo, sempre** — mesmo que a
mensagem pareça só conversa; ao mínimo confirma presença e pergunta o que precisam. Silêncio só
vale para eco puro (autor = nome do grupo) e banter sem menção. Menção = compromisso de resposta.
