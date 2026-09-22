# ADR-035 — Canal admin: ordens executam no live brain, destrutivas pedem confirmação

- **Status:** aceito (2026-09-22, plano P3)
- **Contexto:** o chat admin (Telegram, §25) respondia perguntas com dados
  reais, mas ORDENS ("reinicia o PC", "cria solicitação", "corrige o módulo")
  não tinham executor. Com o KimiCliAdapter (ADR-033) o mesmo binário que o
  time usa passou a ser acionável de fora.

## Decisão

1. **Quem pode**: `ADMIN_TELEGRAM_IDS` (whitelist de user_ids, vírgula).
   O `TELEGRAM_CHAT_ID` autorizado continua valendo (camada 1: chat); a
   whitelist é a camada 2 (usuário). **Vazia = qualquer membro do chat
   autorizado pode dar ordens** (warn único no boot) — fechamento fica a
   cargo do owner configurar os ids. Fora da whitelist → recusa explícita
   fail-closed + audit.
2. **Pergunta vs ordem**: classificador DETERMINÍSTICO (`admin/orders.ts`) —
   imperativo no início ou ausência de "?" → ordem; "?" sem imperativo →
   pergunta. Falso-positivo de ordem custa segundos (o CLI responde); falso-
   negativo vira pergunta (admin reformula). Sem LLM extra: testável e rápido.
3. **Ordem → live brain**: `KimiCliAdapter` com sessão por admin
   (`admin:user:<telegram_id>`), prompt com contexto (cwd absoluto do repo),
   vedação de projeto de cliente, exigência de evidência (o que fez, output,
   commit se houver — autor Luna) e timeout de parede (min(INVESTIGATE_TIMEOUT_MS, 5min)).
4. **Destrutivo/irreversível exige confirmação inline** (decisão de
   arquitetura, configurável): `ADMIN_CONFIRM_DESTRUCTIVE=true` (default) →
   a ordem é segurada e o admin responde "sim" em até 5 min; qualquer outra
   mensagem cancela. Regex destrutiva: restart/shutdown/formata/deleta/apaga/
   drop/truncate/migration/reset/taskkill/kill. Estado em memória por chat
   (restart do worker = confirmações pendente perdidas — aceito: o admin
   reenvia).
5. **Audit + activity em tudo**: `admin.question.answered`,
   `admin.order.executed` (success/failed), `admin.order.refused`
   (whitelist), correlation por ordem. Erro do live brain → resposta honesta
   no chat, nunca sucesso fingido.

## Consequências

- O admin passa a operar o sistema de chat: o mesmo Kimi Code que o time
  usa, com skills e ferramentas nativas, escopado ao repo do luna-agent.
- O classificador deterministico pode mandar pergunta curiosa pro CLI
  (custa um spawn); refinamento futuro pode virar LLM-barato se incomodar.
- WhatsApp privado do owner NÃO entra neste ADR (só Telegram admin);
  entrada futura exige o mesmo par de travas (whitelist + confirmação).
