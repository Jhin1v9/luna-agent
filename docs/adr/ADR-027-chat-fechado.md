# ADR-027 — Não deixar chats abertos (decreto owner) — e a limitação honesta da plataforma

- **Status:** aceito (2026-09-21 — decreto owner)
- **Contexto:** abrir um chat no WhatsApp Web marca as mensagens como
  lidas — o owner perde a notificação no celular. Decreto: após ler/responder,
  fechar/voltar pra lista.

## O que foi implementado

1. `WhatsAppWebTransport.closeCurrentChat()`: Escape → verifica se o painel
   fechou (título do header some) → fallback clicando no wordmark/header da
   lista. Chamado **após `readConversation` e após `sendMessage`** (ou seja:
   sweep, outbound e diagnósticos).
2. Minimização estrutural (vale mais que o close): o sweep **só abre chat
   quando há mensagem nova** (diff por preview/last-seen) e **nunca reabre o
   já processado** (dedupe por external_id no insert + lastSeenMsg no sweep).
   Leitura repetida não acontece por construção.

## Limitação honesta da plataforma

**O WhatsApp Web NÃO restaura o badge de não-lida ao fechar o chat.** Ler é
um evento de servidor irreversível: marca como lida no app do celular também.
O "fechar" só devolve a UI ao estado neutro (lista) — não a notificação.
Registrado pra não prometer o que a plataforma não entrega.

## Validade

Válido até o **chip dedicado** chegar (pendente do owner, §36.1 do v3.1) —
com o chip, o WhatsPlay roda num aparelho separado e o WhatsApp pessoal do
owner deixa de ser afetado por leituras.

## Validação pendente

Fechar-com-Escape precisa de uma validação visual ao vivo (só o owner confere
no celular se a notificação some — esperado que SIM por causa da leitura, e o
painel volta pra lista — verificável no log/screenshot). Anotado na tabela de
pendências.
