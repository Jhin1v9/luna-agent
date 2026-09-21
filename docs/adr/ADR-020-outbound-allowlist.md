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
