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
- conversation_id `5cf0ee2d-b1e4-40c4-a37c-df7c683cf100` · client `05c1160e-…` (code `eduardo-app-transporte`) · chat_registry `group:app-transporte-caminhoneiros`
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
