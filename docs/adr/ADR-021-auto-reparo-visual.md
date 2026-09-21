# ADR-021 — Auto-reparo visual (§14) com visão REAL do k2.6

- **Status:** aceito (2026-09-21, F1.5)
- **Contexto:** §14 manda: ação falha → screenshot + DOM simplificado → Luna
  (visão) analisa → nova estratégia → máx 3 tentativas → acerto: aprendizado
  + commit se houve código; falha: incident + Telegram vivo. O contrato do
  Model Router §9 exige validar a capability `vision` do provider no boot.

## Decisões

1. **Visão validada por probe real no boot** (`probeVisionSupport`): envia um
   chat completion com imagem 1x1 embutida. Resultado em 2026-09-21:
   **kimi-k2.6 (coding endpoint) ACEITOU** (`vision: true`) — a auto-reparação
   usa screenshot de verdade, não degradação de DOM-texto. O orchestrator loga
   o resultado do probe a cada boot.
2. `TurnRequest` ganhou `image_base64?` — a interface estável do adapter não
   quebra (campo opcional); OpenAiCompatAdapter monta content multipart.
3. **Fluxo** (`withAutoRepair`, whatsplay): ação falha → evidência
   (screenshot + DOM simplificado em `.brain/luna/incidents`) → FAST analisa
   imagem+DOM+erro (JSON `{diagnosis, suggested_selector}`) → retry com o
   seletor sugerido → máx 3 tentativas. Sucesso: entrada automática na
   selector memory (§13), audit `auto_repair.recovered` + activity. Esgotado:
   `incidents` (critical, open) + audit `auto_repair.exhausted` + Telegram.
4. **Telegram não configurado = falha explícita registrada** (log de erro),
   nunca envio inventado — o alerta fica auditável no log do serviço.
5. Integração inicial: envio de respostas (`sendMessage`, com override de
   seletor do campo). Abertura de chats entra na mesma função quando o sweep
   passar a usá-la (F2+).

## Consequências

- Cada reparo bem-sucedido alimenta a memória de seletores — a Luna aprende
  os padrões de mudança do WhatsApp Web (§13) sozinha, com evidência.
- Custo por reparo: 1 chamada com imagem (~barato, k2.6); só ocorre em falha.
