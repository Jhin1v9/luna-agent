# ADR-036 — Chamada: ordem invertida (pré-voo) e prompt do Operador composto pelo Kimi Code

- **Status:** aceito (2026-09-22, decreto owner após a 1ª chamada real)
- **Contexto:** a primeira chamada real (owner + Pai, ~1 min) teve 15-20s de
  silêncio porque o prompt do Operador foi injetado DEPOIS da conexão — o
  destinatário atendia e a voz "acordava" no meio da ligação. E o prompt
  usado era o texto estático do contrato §26 — genérico demais pra uma
  chamada específica.

## Decisão

1. **ORDEM INVERTIDA (pré-voo, `voice/operator-preflight.ts`)**: antes de
   discar, o sistema (a) conecta o OperatorSession no chrome-voice e garante
   a aba do ChatGPT; (b) injeta o prompt e **aguarda a confirmação de que o
   Operador está ativo** (resposta apareceu na conversa) — loga
   "operador ativo ✅" antes de prosseguir; (c) SÓ ENTÃO disca. Sem
   confirmação em X segundos (`OPERATOR_PREFLIGHT_TIMEOUT_MS`, default
   20s) → **aborta a ligação ANTES de discar** com falha explícita + alerta.
   Nunca liga com operador frio.
2. **O PROMPT DO OPERADOR É COMPOSTO PELO KIMI CODE por chamada** — o
   KimiCliAdapter recebe o brief ocasional (destinatário, número,
   autorizador, motivo, objetivo) e escreve o texto do prompt (personalidade
   §26 + fatos da chamada). Decreto owner: "o prompt do chatgpt quem tem que
   fazer é o kimi code com o contexto correto, nunca colocar nada genérico
   robotizado; contexto não é fixo, é ocasional".
3. **FALLBACK duro**: Kimi CLI falho → FALHA EXPLÍCITA, sem prompt genérico
   silencioso, sem discagem. Melhor não ligar do que operar robótico.

## Consequências

- O orquestrador (`runVoiceCall`) injeta o dialer — e ele NUNCA é chamado
  quando o pré-voo falha (regressão cobre isso).
- O `OperatorSession.injectContext` (prompt estático §26 + contexto) fica
  como legado; o caminho novo é `preflightOperator` com texto composto.
- Latência pré-discagem: +1 turno do Kimi CLI (~2-9s) + confirmação do
  Operador (até 20s). Aceito — o destinatário nunca mais ouve silêncio.
