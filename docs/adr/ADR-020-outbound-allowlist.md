# ADR-020 — Guardrail de código: outbound allowlist (só "Pai" recebe teste)

- **Status:** aceito (2026-09-21, decreto do owner — guardrail, não só regra escrita)
- **Contexto:** durante o teste vivo da F1.4, o WhatsApp pessoal do owner
  recebeu tráfego real (grupos e contatos pessoais). O sistema ingeriu e
  respondeu vários deles — 4 respostas foram ENVIADAS antes de qualquer
  contenção (incluindo um grupo e um contato pessoal). O owner decretou:
  **só o contato "Pai" pode receber mensagens de teste da Luna, ninguém mais,
  nunca — e isso vira código, não documento.**

## Decisão

1. `WHATSAPP_OUTBOUND_ALLOWLIST` (env, vírgula) — nomes ou jids permitidos.
2. **Fora de produção** (`NODE_ENV != production`), o `outbound.deliverOne`
   RECUSA envio para qualquer destino fora da lista. **Lista vazia em dev =
   recusa TUDO** — fail-closed, o mais seguro; fail-open nunca.
3. Recusa = falha **explícita**: `send_state='failed'` com motivo + audit
   `whatsapp.message.send_refused` (metadata `reason: outbound_allowlist`) +
   log de erro. Nunca silencioso.
4. **Match estrito**: exato por nome, ou jid por sufixo (entrada com `@`).
   Substring NÃO vale — "Pai" não libera "Papai". Falso-positivo de allow é o
   pior cenário deste guardrail.
5. **Em produção futura a allowlist de teste não se aplica** — mas a decisão
   de como conter escopo em produção (ex.: só chats mapeados a clientes no
   Postgres respondem) é do owner quando chegar a vez; até lá, este guardrail
   é a fronteira.

## Escopo de ingestão (acréscimo do mesmo decreto, 2026-09-21)O owner também liberou o grupo **"🏆Production - 2026🙏🏻"** para testes (além
do "Pai" — só esses dois destinos, ninguém mais). E fechou o problema
operacional que tinha me obrigado a parar o daemon: `WHATSAPP_INGEST_ALLOWLIST`.

- O watcher **só processa conversas da lista**: mensagem fora do escopo é
  ignorada **sem abrir o chat** (não marca como lida), **sem Context Builder e
  sem chamar LLM — zero tokens** (no máximo um log debug). Fail-closed: lista
  vazia em dev = nada processado.
- Matcher compartilhado (`allowlist.ts`): exato por nome, ou jid por sufixo
  (entrada com `@`). Substring não vale.
- Identificador do grupo: o sistema usa o **nome do chat** como address (o
  `data-id` do DOM não vem para grupos nesta build) — por isso a entrada é o
  nome exato com emojis. Se a build passar a expor o jid `@g.us`, preferir
  adicioná-lo à lista (mais estável que nome).
- Validado ao religar: log "fora do escopo de ingestão — ignorado (zero
  tokens)" disparando em runtime real na primeira janela.

## Novo destino autorizado (2026-09-21, segundo decreto)

**"Meu Amorzinho 💖🌻"** (+34 633 34 48 34 — namorada do owner) entrou no
escopo: `WHATSAPP_OUTBOUND_ALLOWLIST` e `WHATSAPP_INGEST_ALLOWLIST` agora têm
3 entradas (Pai, 🏆Production - 2026🙏🏻, Meu Amorzinho 💖🌻). Contexto:
**uso pessoal OCASIONAL** — a Luna só fala lá quando chamada com @luna (regra
de menção §5 já existente; como privado no escopo, responde sempre). Ela não
é cobaia de teste: nenhuma mensagem de teste é enviada por iniciativa do
sistema.

**Matcher endurecido com normalização**: nomes são comparados com marcas
invisíveis de bidi (\u202A-\u202E, \u200E/\u200F) removidas dos DOIS lados —
títulos do WhatsApp às vezes carregam essas marcas e um match exato cru
quebraria silenciosamente (a namorada entrou com emoji no nome e sem jid
estável disponível; jid continua sendo a alternativa mais estável quando
existente, casando por sufixo). Substring segue proibido ("Pai" ≠ "Papai"),
case-sensitive.

## Validação (2026-09-21)

- 6 testes unitários + 3 de integração (Postgres real): na lista envia, fora
  recusa auditada, vazia recusa tudo, produção não aplica, jid por sufixo,
  substring não vale.
- **O guardrail já provou valor na primeira hora**: ao ser ligado, recusou na
  hora 7+ entregas pendentes para contatos fora da lista (auditorados). As 8
  mensagens que ficaram `queued` de antes foram marcadas `failed`
  preventivamente pelo operador — zero leak.
- **Teste de envio autorizado ao "Pai"**: entregue (`messages.sent`),
  activity + audit com correlation_id, espera humana anti-ban respeitada.

## Consequência operacional imediata

O daemon WhatsPlay fica **parado por decisão operacional** após este teste:
a entrega está contida, mas o watcher continuaria ingerindo tráfego pessoal e
gastando tokens em respostas (recusadas depois, mas geradas). Religar exige
definição de escopo de ingestão com o owner (ex.: responder só em chats
explicitamente mapeados, ou modo "só escuta" até lá).
