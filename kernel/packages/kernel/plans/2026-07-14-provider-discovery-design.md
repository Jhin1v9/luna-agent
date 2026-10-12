# Provider Discovery System (PDS) — design (2026-07-14)

## Contexto

Hoje, adicionar um provider (ChatGPT, Claude, Gemini…) exige um humano editando
seletores no código. O dono quer que a **própria Luna aprenda um provider novo**:
o usuário cola a URL, faz login na aba que a Luna abre (mesmo Chrome, via CDP),
e um Discovery Agent mapeia seletores robustos, valida com a Kimi como parceira,
roda uma suite de testes end-to-end e grava o `provider.json`. DeepSeek volta a
funcionar no caminho (seu bug atual é sessão não salva + seletor de input
hardcoded — `bugs.md:22`).

Decisão de abordagem (dono, 2026-07-14): **A — fundação em fases**. Nada de
solução genérica/gambiarra: refatorar o que está mal feito, usar o que existe,
criar o que falta. Cada fase é independentemente testável e reversível; a Kimi
nunca quebra no caminho.

Princípio central (espelha a decisão do tool registry em `decisions.md`):
**`provider-configs/<nome>.json` é a única fonte de verdade** — bridge, extensão
e UI derivam dela.

## Fluxo

```
UI: botão "Adicionar provider" → cola URL
  → POST /api/providers/discover (SSE de progresso)
  → 1. Validação: fetch da URL + classifier Kimi ("é um chat de LLM?")
  → 2. Aba nova no MESMO Chrome da Luna (CDP :9222)
  → 3. Login assistido: usuário loga → detector confirma → captura cookies+localStorage
  → 4. Extrator determinístico: DOM + accessibility tree → candidatos por papel → score
  → 5. Validação Kimi: escolhe/confirma seletores + sugere fallbacks
  → 6. Gera provider.json v2 (fallback chains, version, capabilities)
  → 7. Suite de testes automática (6 obrigatórios + scripts opcional)
  → 8. Passou → salva em ~/.luna/provider-configs/ → aparece no pill sem restart
```

## Fase 0 — Fundação (pré-requisito, zero feature nova)

Sem esta fase, qualquer `provider.json` descoberto é decorativo: os caminhos de
chat ignoram o config hoje.

- **Input/send/stop/new-chat/login leem do config em todos os caminhos.**
  Hardcoded hoje: `kimi-bridge.cjs:4041` (input, sendMessage), `:7635`
  (sendMessageStream), `:7425` (injectSteer), `:3844-3938`
  (`_submitWithVerification`: baseline/verify usam `.segment-assistant`,
  `.send-button-container`, `.stop-button-container`), `:1047` (new-chat
  `.new-chat-btn`), `:4678` (`_checkLoginState` com literal `'kimi'`).
  Novo helper `lib/provider-selectors.cjs`: resolve `selectors.<papel>` do
  config com fallback chain (schema v2) e `waitFor` com timeout — conserta de
  tabela o bug do DeepSeek (`bugs.md:22`, itens A e C: input genérico sem
  waitFor + detecção de `/sign_in` como LOGIN_REQUIRED).
- **`connect()` injeta localStorage per-provider** (hoje hardcoded Kimi em
  `kb:1326`); `_syncMasterCookiesFromContext` deriva o domínio do `baseUrl`
  (o campo `domain` que ele espera não existe em nenhum config).
- **Deletar o interceptor CDP morto**: `_buildFetchPatterns` é chamado em
  `kb:768` e não existe → todo fetch CDP nesse caminho falha silenciosamente
  (`bugs.md:23`). `cdpPatterns`/`getProviderApiPatterns` são dead code
  comprovado. DOM poller + extensão cobrem os dois providers atuais.
- **Mensagens de erro com o provider real** (mata "Input field not found on
  Kimi Web" estando no DeepSeek).
- **Testes:** characterization net ANTES de mexer (padrão Wave 5,
  `node --test`), depois os 285 existentes + novos. Critério de saída:
  285+ novos passando, Kimi funcionalmente idêntica (teste manual de chat
  completo), DeepSeek logando e respondendo via config.

## Fase 1 — Extrator determinístico (zero LLM)

`lib/discovery/extractor.cjs`. Via CDP na aba do provider:

1. Coleta todos os `input, textarea, [contenteditable], button, [role=button],
   a` visíveis: atributos, aria-label, placeholder, texto visível, role,
   bounding box.
2. **Interações de revelação antes de coletar**: focus no input candidato +
   hover (SPAs como Gemini/ChatGPT escondem o botão de envio até o input ter
   foco/conteúdo) → segunda coleta (diff revela send/stop).
3. `Accessibility.getFullAXTree` via CDP para roles/names estáveis.
4. Para cada candidato, gera até 3 seletores (forte→fraco) e agrupa por papel
   provável (input, sendButton, stopButton, newChat, assistantMessage,
   responseContainer, generatingIndicator, loginIndicator, appContent).

**Rubrica de score (determinística):**

| Sinal | Nota |
|---|---|
| `data-testid` / id estável | 10 |
| `aria-label` | 9 |
| `placeholder` | 8 |
| `role` semântico | 7 |
| `name`/atributo semântico | 6 |
| texto visível estável | 5 |
| classe semântica (sem hash) | 4 |
| tag pura | 2 |
| `nth-child`/posicional | 1 |
| classe hash gerada (css modules) | 0 |

## Fase 2 — Validação Kimi

Padrão do classifier do Telegram (`luna-soul.cjs:5528`, `_classifyIntent`):

- userId isolado `discovery-<id>` → conversa Kimi própria, não polui o
  histórico do usuário.
- Prompt JSON-only (contrato estilo plan mode): recebe a lista condensada
  (máx ~10 candidatos por papel, HTML externo truncado a ~200 chars),
  responde `{input: {selector, confidence, reason}, sendButton: {...}, ...}`.
- **1-2 rodadas**: após a 1ª escolha, re-teste no DOM real (existe? visível?
  clicável?); se falha, 2ª rodada com a evidência do porquê.
- Se a Kimi estiver indisponível: o extrator ainda gera config marcada
  `"validatedBy": "heuristic"` com aviso — discovery não bloqueia.

## Schema v2 do provider.json

```json
{
  "name": "chatgpt",
  "displayName": "ChatGPT",
  "providerVersion": 2,
  "baseUrl": "https://chatgpt.com",
  "modeUrls": { "instant": "https://chatgpt.com/", "thinking": "https://chatgpt.com/" },
  "selectors": {
    "input": ["#prompt-textarea", "div[contenteditable='true']"],
    "sendButton": ["button[data-testid='send-button']", "button[aria-label*='Send']"],
    "stopButton": ["button[data-testid='stop-button']"],
    "newChat": ["a[href='/']", "button[aria-label*='New chat']"],
    "assistantMessage": ["article[data-testid^='conversation-turn']"],
    "responseContainer": [".markdown", "[data-message-author-role='assistant']"],
    "generatingIndicator": ["button[data-testid='stop-button']"],
    "loginIndicator": ["form[action*='auth']", "button[data-testid='login-button']"],
    "appContent": ["#prompt-textarea", "main"]
  },
  "capabilities": { "streaming": true, "thinking": false, "tools": true, "scripts": false },
  "cookies": {
    "masterCookies": "chatgpt-master-cookies.json",
    "masterLocalStorage": "chatgpt-master-localstorage.json"
  },
  "discovery": {
    "discoveredAt": "2026-07-14T…",
    "validatedBy": "kimi",
    "selectorScores": { "input": [10, 8] },
    "testReport": { "newChat": "pass", "send": "pass", "response": "pass",
                    "markdown": "pass", "codeBlock": "pass", "tool": "pass",
                    "scripts": "skip" }
  }
}
```

- Seletores viram **arrays ordenados** = fallback chain (tenta em ordem).
- Configs v1 (Kimi/DeepSeek) seguem válidas: string = array de 1
  (normalização no `provider-loader.cjs`, uma única função).
- Configs descobertas vão para `~/.luna/provider-configs/` (per-user, não
  commitadas); as do repo (`packages/kernel/provider-configs/`) viram seed.
  Loader consulta per-user primeiro, repo como fallback.

## Fase 3 — Suite de testes automática

`lib/discovery/test-suite.cjs`. Roda contra a aba logada, na ordem:

| # | Teste | Critério de pass | Obrigatório |
|---|---|---|---|
| 1 | Novo chat | input vazio visível na URL de chat novo | sim |
| 2 | Envio | `_submitWithVerification` confirma (input limpa / bubble aparece) | sim |
| 3 | Resposta | texto chega e completa (stability ou `generatingIndicator` sumiu) | sim |
| 4 | Markdown | "responda com um título H1 e um parágrafo" → extrai `# …` | sim |
| 5 | Code block | "responda com um bloco ```js```" → detecta `pre/code` | sim |
| 6 | Tool | prompt exigindo `{"tool":"executeShell","params":{"command":"echo pds-ok"}}` → Luna executa → `pds-ok` no resultado | sim |
| 7 | Scripts | bloco `{"script":…}` detectado | não (registrado como skip/fail sem bloquear) |

Provider só é **ativado** se 1-6 passam. Relatório gravado em
`discovery.testReport`; falhas mostram o seletor suspeito para remap futuro.

## Fase 4 — UI, login e captura de sessão

- **Botão "Adicionar provider"** no pill/drawer (`ChatHeader.svelte:222-247`):
  modal com campo de URL → validação → "Faça login na aba que abrimos" →
  polling até detector confirmar login → discovery roda com progresso SSE →
  relatório com checkmarks → provider aparece no pill.
- **Endpoints** (`luna-chat-routes.js`):
  - `POST /api/providers/discover {url}` → SSE de progresso (padrão dos streams)
  - `GET /api/providers` já enumera o dir (`:1993-2010`) — passa a incluir
    `~/.luna/provider-configs/`
  - `POST /api/providers/<name>/retest` → re-roda a suite (saúde)
- **Captura genérica de sessão**: generalizar `save-deepseek-session.js` →
  `lib/session-capture.cjs`: dado o `baseUrl`, salva cookies do domínio +
  localStorage em `cookies/<name>-master-*.json` (mesmo formato dos arquivos
  atuais, consumidos pelo boot do bridge). Conserta o DeepSeek de tabela.

## Fase 5 — Extensão genérica + auto-repair

- `luna-extension`: `getSelectors()` (`injected.js:13-42`) passa a receber os
  seletores do server por host; `background.js` busca
  `GET /ext/provider-config?host=…` ao iniciar a aba. Hosts novos são cobertos
  via `chrome.scripting.registerContentScripts` dinâmico (permissão `scripting`
  + host permission opcional aprovada no momento do discovery) em vez de
  hardcode no `manifest.json:14-53`.
- `providerVersion` + health check periódico (re-teste leve: input+send
  visíveis). Se falhar: a Luna pergunta "Os seletores parecem desatualizados.
  Deseja remapear automaticamente?" → re-roda Fases 1-2 só para os papéis
  quebrados (remap cirúrgico, não reconstrói tudo).

## Concorrência e isolamento

- O discovery usa CDP na **mesma instância** do Chrome onde a Kimi
  classificadora vive — por isso o pipeline é **sequencial**: extrai candidatos
  (CDP puro) → condensa → consulta a Kimi (aba dela, intocada, userId
  `discovery-*`) → grava → testa na aba do provider.
- Aba do provider: reusa `_getOrCreateUserPage` com userId `discovery-<name>`;
  fechada ao final (ou convertida em aba de provider ativo se os testes passam).
- `session.processing` do chat do usuário nunca é tocado.

## Testes do próprio sistema

- Fase 0: characterization net (padrão Wave 5) + 285 existentes.
- Scorer e fallback-chain resolver: unit tests puros.
- Pipeline: fixture HTML local (página mock com seletores conhecidos) servida
  em porta local — a suite roda no CI sem depender de site externo.
- e2e real (chatgpt.com) é manual/flagged, nunca no CI.

## Riscos (honestos)

- Login OAuth com 2FA é manual do usuário (by design).
- Discovery depende da Kimi saudável para a validação semântica; sem ela, gera
  config heurística com aviso (não bloqueia).
- `nth-child`/classes hash têm score baixo justamente para nunca serem
  escolhidos quando existir alternativa estável.

## Fora de escopo (v1)

- Strategy trees dinâmicos (montar seletor por tipo de estratégia em runtime) —
  YAGNI; fallback chain + scoring entregam o valor com menos risco.
- Interceptor CDP/network por provider (caminho morto deletado na Fase 0).
- Auto-login (credenciais) — login é sempre manual do usuário.
- Múltiplas contas por provider.
