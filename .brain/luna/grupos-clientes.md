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

## Fichas dos clientes

- HDM: `.brain/clients/hdm-industrial/MEMORY.md` (+ pedidos em `.brain/luna/pedidos-clientes.md`)
- Juninho: `.brain/clients/jr-reformas-juninho/MEMORY.md`
