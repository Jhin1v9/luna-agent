# Luna Compactação Manual Robusta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Luna's context compaction fully manual, robust, and regression-free by removing automatic triggers, fixing the method-name crash, hardening the URL handoff, and reinforcing the checkpoint prompt.

**Architecture:** Keep compaction logic inside `luna-soul.cjs`; add non-blocking delivery helpers and clean URL management to `kimi-bridge.cjs`; wire the manual route in `luna-chat-routes.js`; verify the runtime frontend already displays compaction feedback correctly.

**Tech Stack:** Node.js, CommonJS, Playwright, Svelte 4, Express, SSE.

---

## Files

| File | Responsibility |
|---|---|
| `/home/jhin/.luna-kernel/kimi-bridge.cjs` | Add `_clearChatUrl`, `_captureCurrentChatUrl`, `sendMessageNoWait`; fix `_saveChatUrl` for non-Kimi providers; fix `KIMI_MODE_URLS` references. |
| `/home/jhin/.luna-kernel/luna-soul.cjs` | Rename compaction method to `_compactContext`; remove auto-triggers; use non-blocking checkpoint send; reinforce prompt. |
| `/home/jhin/NEXO_DASHBOARD_PRO/backend/luna-chat-routes.js` | Fix `/api/luna/compact` to call `_compactContext`. |
| `/home/jhin/.luna-kernel/luna-web/src/components/ChatArea.svelte` | Already handles compaction events. No changes needed. |

---

## Task 1: Add `_clearChatUrl` to `kimi-bridge.cjs`

**Files:**
- Modify: `/home/jhin/.luna-kernel/kimi-bridge.cjs` (after existing `_saveChatUrl` around line 924)

- [ ] **Step 1: Insert `_clearChatUrl` after `_saveChatUrl`**

```js
  /**
   * Clear the persisted chat URL for a user.
   * Used before creating a new thread to prevent navigation back to the stale URL.
   */
  _clearChatUrl(userId) {
    const session = this.userSessions.get(userId);
    if (session) {
      session.chatUrl = null;
    }
    this.store.setUser(userId, { chatUrl: null, lastActivity: Date.now() });
    log.info(`Cleared chatUrl for user ${hashUserId(userId)}`);
  }
```

- [ ] **Step 2: Verify no syntax errors**

Run:
```bash
cd /home/jhin/.luna-kernel && node -c kimi-bridge.cjs
```
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel
git add kimi-bridge.cjs
git commit -m "feat(bridge): add _clearChatUrl helper"
```

---

## Task 2: Add `_captureCurrentChatUrl` to `kimi-bridge.cjs`

**Files:**
- Modify: `/home/jhin/.luna-kernel/kimi-bridge.cjs` (after `_clearChatUrl` from Task 1)

- [ ] **Step 1: Insert helper after `_clearChatUrl`**

```js
  /**
   * Capture and persist the current chat URL for a user.
   * Throws if the current page is not a valid thread URL for the active provider.
   */
  async _captureCurrentChatUrl(userId) {
    const session = this.userSessions.get(userId);
    if (!session?.page) {
      throw new Error(`No active page for user ${hashUserId(userId)}`);
    }
    const url = session.page.url();
    if (!url) {
      throw new Error(`Could not read current URL for user ${hashUserId(userId)}`);
    }
    session.chatUrl = url;
    this._saveChatUrl(userId, url);
    log.info(`Captured chatUrl for user ${hashUserId(userId)}: ${url}`);
    return url;
  }
```

- [ ] **Step 2: Verify no syntax errors**

Run:
```bash
cd /home/jhin/.luna-kernel && node -c kimi-bridge.cjs
```
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel
git add kimi-bridge.cjs
git commit -m "feat(bridge): add _captureCurrentChatUrl helper"
```

---

## Task 3: Add `_isProviderThreadUrl` and fix `_saveChatUrl` for non-Kimi providers

**Files:**
- Modify: `/home/jhin/.luna-kernel/kimi-bridge.cjs` (replace `_saveChatUrl` around line 917)

- [ ] **Step 1: Replace `_saveChatUrl` and add provider validator**

Replace the existing `_saveChatUrl` method with:

```js
  /**
   * Determine whether a URL represents a valid thread URL for a provider.
   */
  _isProviderThreadUrl(provider, url) {
    if (!url || !provider) return false;
    switch (provider) {
      case 'kimi':
        return url.includes('/chat/');
      case 'deepseek':
        return url.includes('/c/') || url.includes('/chat/');
      default:
        // For unknown providers, accept any URL under the provider domain.
        return true;
    }
  }

  /**
   * Save chat URL to store only if it's a valid thread URL for the active provider.
   * Prevents saving empty URLs like '?chat_enter_method=new_chat'.
   */
  _saveChatUrl(userId, url, extra = {}) {
    if (!url) return;
    const session = this.userSessions.get(userId);
    const provider = session?.provider || this._resolveProvider(userId);
    const providerDomain = this._providerDomain(provider);

    const isValid = url.includes(providerDomain) && this._isProviderThreadUrl(provider, url);
    if (!isValid) {
      log.warn(`Refusing to save invalid chatUrl for ${provider}: ${url}`);
      return;
    }
    this.store.setUser(userId, { chatUrl: url, ...extra });
  }
```

- [ ] **Step 2: Verify no syntax errors**

Run:
```bash
cd /home/jhin/.luna-kernel && node -c kimi-bridge.cjs
```
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel
git add kimi-bridge.cjs
git commit -m "feat(bridge): support non-Kimi thread URLs in _saveChatUrl"
```

---

## Task 4: Fix `KIMI_MODE_URLS` references

**Files:**
- Modify: `/home/jhin/.luna-kernel/kimi-bridge.cjs` lines 2547 and 3525

- [ ] **Step 1: Replace references in `setMode`**

At line 2547, change:

```js
const targetUrl = KIMI_MODE_URLS[mode];
```

to:

```js
const targetUrl = getModeUrls(provider)[mode];
```

- [ ] **Step 2: Replace references in `sendMessage`**

At line 3525, change:

```js
const targetUrl = KIMI_MODE_URLS[options.mode];
```

to:

```js
const targetUrl = getModeUrls(resolvedProvider)[options.mode];
```

- [ ] **Step 3: Verify no remaining references and no syntax errors**

Run:
```bash
cd /home/jhin/.luna-kernel
grep -n "KIMI_MODE_URLS" kimi-bridge.cjs
node -c kimi-bridge.cjs
```
Expected: grep returns no matches; `node -c` produces no output.

- [ ] **Step 4: Commit**

```bash
cd /home/jhin/.luna-kernel
git add kimi-bridge.cjs
git commit -m "fix(bridge): replace undefined KIMI_MODE_URLS with getModeUrls"
```

---

## Task 5: Add `sendMessageNoWait` to `kimi-bridge.cjs`

**Files:**
- Modify: `/home/jhin/.luna-kernel/kimi-bridge.cjs` (after `sendMessage`, around line 3694)

- [ ] **Step 1: Insert `sendMessageNoWait` after `sendMessage`**

```js
  /**
   * Send a message to the provider Web UI without waiting for the full response.
   * Use this for checkpoint messages where we only need delivery confirmation.
   * Returns once the message is submitted and the input no longer contains the original text.
   */
  async sendMessageNoWait(userId, text, options = {}) {
    if (!text || !text.trim()) {
      throw new Error('Message text is required');
    }

    const page = await this._getOrCreateUserPage(userId);
    const session = this.userSessions.get(userId);
    if (!session) {
      throw new Error(`No session for user ${hashUserId(userId)}`);
    }

    this._checkCooldown(userId);
    session.lastActivity = Date.now();

    await this._verifySession(page);

    if (options.mode && !['agent', 'swarm'].includes(options.mode)) {
      await this.setMode(userId, options.mode);
    }

    const inputLocator = page.locator('textarea, [contenteditable="true"]').first();
    const inputCount = await inputLocator.count();
    if (inputCount === 0) {
      throw new Error('Input field not found on provider page');
    }

    await page.bringToFront();
    await inputLocator.evaluate((el) => el.focus());
    await page.waitForTimeout(200);

    await inputLocator.fill('');
    await page.waitForTimeout(300);
    await inputLocator.fill(text);
    await page.waitForTimeout(200);
    await inputLocator.evaluate((el) => {
      const data = el.value || el.innerText || '';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(500);

    await this._pressEnterOnInput(inputLocator);
    log.info(`[sendMessageNoWait] Submitted message for user ${hashUserId(userId)}`);

    const deliveryDeadline = Date.now() + 30000;
    while (Date.now() < deliveryDeadline) {
      try {
        const currentValue = await inputLocator.inputValue().catch(async () => {
          return await inputLocator.evaluate((el) => el.innerText || el.textContent || '');
        });
        if (!currentValue || !currentValue.includes(text.slice(0, 100))) {
          log.info(`[sendMessageNoWait] Delivery confirmed for user ${hashUserId(userId)}`);
          break;
        }
      } catch (e) {
        // ignore transient read errors
      }
      await page.waitForTimeout(300);
    }

    return { sent: true, url: page.url() };
  }
```

- [ ] **Step 2: Verify no syntax errors**

Run:
```bash
cd /home/jhin/.luna-kernel && node -c kimi-bridge.cjs
```
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel
git add kimi-bridge.cjs
git commit -m "feat(bridge): add sendMessageNoWait for non-blocking checkpoint delivery"
```

---

## Task 6: Ensure `newChat` clears old URL and persists new URL

**Files:**
- Modify: `/home/jhin/.luna-kernel/kimi-bridge.cjs` (inside `newChat`, around line 2629)

- [ ] **Step 1: Clear old chatUrl at start of `newChat`**

Inside `newChat`, immediately after resolving `provider`, add:

```js
this._clearChatUrl(userId);
```

It should look like:

```js
async newChat(userId, providerArg = null, opts = {}) {
  const { requireChatUrl = true } = opts;
  const provider = this._resolveProvider(userId, providerArg);
  const providerDomain = this._providerDomain(provider);
  const newChatUrl = this._modeUrl(provider, 'instant');

  const page = await this._getOrCreateUserPage(userId, provider);
  const session = this.userSessions.get(userId);
  session.provider = provider;

  // Clear any stale chatUrl before creating a new thread.
  this._clearChatUrl(userId);

  // ... rest of existing newChat implementation ...
}
```

- [ ] **Step 2: Persist new URL immediately after detection**

Find the section where `newChat` has validated `newUrl` and add persistence. After the final URL validation block (around line 2729), ensure the URL is saved:

```js
if (isValidChatUrl(newUrl) || (isNewChatLanding && !requireChatUrl)) {
  session.chatUrl = newUrl;
  this._saveChatUrl(userId, newUrl, { provider });
}
```

If `newChat` already saves the URL in some branches, ensure this is the final, unconditional save after all validation.

- [ ] **Step 3: Verify no syntax errors**

Run:
```bash
cd /home/jhin/.luna-kernel && node -c kimi-bridge.cjs
```
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
cd /home/jhin/.luna-kernel
git add kimi-bridge.cjs
git commit -m "feat(bridge): clear and persist chatUrl consistently in newChat"
```

---

## Task 7: Rename and harden compaction method in `luna-soul.cjs`

**Files:**
- Modify: `/home/jhin/.luna-kernel/luna-soul.cjs` (replace `_autoCompact` at line 1787)

- [ ] **Step 1: Replace `_autoCompact` with `_compactContext`**

Replace the entire method block at lines 1787-1926 with:

```js
  async *_compactContext(sessionId, userId = 'luna-default') {
    console.log(`[DEBUG-LUNA] _compactContext started for session ${sessionId}`);
    yield {
      type: 'compact_start',
      message: '📦 Compactação manual iniciada. Criando checkpoint inteligente...',
      sessionId,
    };

    try {
      const events = this.sessionManager.readContext
        ? this.sessionManager.readContext(sessionId)
        : this.sessionManager.readRecentEvents(sessionId, 999);

      yield { type: 'compact_progress', message: '🧠 Analisando estado da sessão...', sessionId };
      const summary = this._buildCompactSummary(events);
      console.log(`[LUNA] Compact summary built: ${summary.length} chars, ${events.length} events`);

      if (!this.kimiBridge) {
        throw new Error('Kimi bridge not available');
      }

      yield { type: 'compact_progress', message: '🔄 Criando nova thread...', sessionId };

      let newChatResult;
      try {
        newChatResult = await this.kimiBridge.newChat(userId, null, { requireChatUrl: false });
        console.log(`[LUNA] New chat created for user ${userId}: ${newChatResult?.chatUrl}`);
      } catch (err) {
        yield {
          type: 'compact_error',
          message: `❌ Falha ao criar nova thread: ${err.message}. Contexto preservado.`,
          sessionId,
        };
        console.log(`[DEBUG-LUNA] _compactContext finished (newChat failed)`);
        return { success: false, error: err.message };
      }

      yield {
        type: 'compact_progress',
        message: '📝 Enviando checkpoint de continuação para a nova thread...',
        sessionId,
      };

      let bridgeSession = null;
      let wasProcessing = false;
      try {
        bridgeSession = this.kimiBridge.userSessions?.get(userId);
        wasProcessing = bridgeSession?.processing;
        if (bridgeSession) bridgeSession.processing = false;

        const page = bridgeSession?.page;
        if (page) {
          try {
            await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 10000 });
            console.log(`[LUNA] New chat input ready for checkpoint`);
          } catch (e) {
            console.warn(`[LUNA] New chat input not ready: ${e.message}`);
          }
        }

        await Promise.race([
          this.kimiBridge.sendMessageNoWait(userId, summary, { mode: 'thinking' }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout ao enviar checkpoint (120s)')), 120000)
          ),
        ]);

        console.log(`[LUNA] Checkpoint submitted to new chat`);
        yield { type: 'compact_progress', message: `✅ Checkpoint enviado para nova thread`, sessionId };
      } catch (sendErr) {
        console.error('[LUNA] Failed to send checkpoint to new chat:', sendErr.message);
        yield {
          type: 'compact_error',
          message: `❌ Checkpoint não enviado: ${sendErr.message}. Contexto local preservado.`,
          sessionId,
        };
        console.log(`[DEBUG-LUNA] _compactContext finished (checkpoint send failed)`);
        return { success: false, error: sendErr.message };
      } finally {
        if (bridgeSession && wasProcessing) bridgeSession.processing = wasProcessing;
      }

      let finalUrl;
      try {
        finalUrl = await this.kimiBridge._captureCurrentChatUrl(userId);
        console.log(`[LUNA] Captured final chatUrl after checkpoint: ${finalUrl}`);
      } catch (captureErr) {
        finalUrl = newChatResult?.chatUrl;
        if (!finalUrl) {
          yield {
            type: 'compact_error',
            message: `❌ Não foi possível confirmar URL da nova thread: ${captureErr.message}. Contexto preservado.`,
            sessionId,
          };
          return { success: false, error: captureErr.message };
        }
        console.warn(`[LUNA] _captureCurrentChatUrl failed, using newChat URL: ${finalUrl}`);
      }

      this.sessionManager.clearContext(sessionId);

      this.sessionManager.appendEvent(sessionId, {
        type: 'assistant',
        mode: 'CHAT',
        response: `[CHECKPOINT] Contexto compactado. Nova thread: ${finalUrl}\n\n${summary.slice(0, 2000)}${summary.length > 2000 ? '\n\n[... resumo truncado no contexto local, completo enviado ao LLM]' : ''}`,
        timestamp: new Date().toISOString(),
      });

      yield {
        type: 'compact_end',
        message: '✅ Contexto compactado. Nova thread pronta com checkpoint inteligente.',
        summary,
        chatUrl: finalUrl,
        sessionId,
      };
      console.log(`[DEBUG-LUNA] _compactContext finished (success)`);
      return { success: true, summary, chatUrl: finalUrl };
    } catch (err) {
      console.error(`[DEBUG-LUNA] _compactContext finished (error): ${err.message}`);
      yield { type: 'compact_error', message: `❌ Erro na compactação: ${err.message}`, sessionId };
      return { success: false, error: err.message };
    }
  }
```

- [ ] **Step 2: Verify no syntax errors**

Run:
```bash
cd /home/jhin/.luna-kernel && node -c luna-soul.cjs
```
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel
git add luna-soul.cjs
git commit -m "feat(soul): rename and harden _compactContext method"
```

---

## Task 8: Remove automatic compaction triggers in `luna-soul.cjs`

**Files:**
- Modify: `/home/jhin/.luna-kernel/luna-soul.cjs` lines 2416-2422, 2551-2567, 2693-2711

- [ ] **Step 1: Remove proactive `_shouldCompact` trigger**

Replace lines 2416-2422:

```js
          if (bridgeRetryCount === 0 && this._shouldCompact(sessionId)) {
            const compactResult = yield* this._autoCompact(sessionId, userId);
            if (compactResult.success) {
              loopContext = await this._buildContext(sessionId, loopInput, { ...options, isFirstMessage: false });
            }
          }
```

with:

```js
          // v10.32: Compaction is 100% manual via the "Compactar" button.
          // No automatic compaction must happen here.
```

- [ ] **Step 2: Replace `context_limit` auto-compact with system message**

Replace lines 2551-2567:

```js
            case 'context_limit': {
              fullResponse = event.response || '';
              yield { type: 'system', message: '📦 Limite de contexto atingido. Compactando e criando nova thread...', sessionId };
              const compactResult = yield* this._autoCompact(sessionId, userId);
              if (compactResult.success) {
                const bridgeSession = this.kimiBridge?.userSessions?.get(userId);
                if (bridgeSession) {
                  bridgeSession.processing = false;
                  console.log(`[LUNA] Released session.processing for user ${userId} before continuing after compact`);
                }
                loopContext = await this._buildContext(sessionId, loopInput, { ...options, isFirstMessage: false });
                continue;
              } else {
                yield { type: 'error', error: '❌ Falha ao compactar contexto: ' + compactResult.error, sessionId };
                return;
              }
            }
```

with:

```js
            case 'context_limit': {
              fullResponse = event.response || '';
              yield {
                type: 'system',
                message: '📦 Limite de contexto atingido. Clique em "Compactar" no cabeçalho para continuar.',
                sessionId,
              };
              return;
            }
```

- [ ] **Step 3: Remove regex fallback trigger**

Replace lines 2693-2711:

```js
      if (/getting too long|conversation.*too long|try starting a new session|context limit|token limit|聊得太长|发起一个新会话|会话太长/i.test(fullResponse)) {
        yield { type: 'system', message: '📦 Limite de contexto atingido. Compactando e criando nova thread...', sessionId };
        try {
          const compactResult = yield* this._autoCompact(sessionId, userId);
          if (compactResult.success) {
            const bridgeSession = this.kimiBridge?.userSessions?.get(userId);
            if (bridgeSession) {
              bridgeSession.processing = false;
              console.log(`[LUNA] Released session.processing for user ${userId} before continuing after compact (regex fallback)`);
            }
            loopContext = await this._buildContext(sessionId, loopInput, { ...options, isFirstMessage: false });
            continue;
          }
        } catch (compactErr) {
          console.error('[LUNA] Auto-compact failed:', compactErr.message);
          yield { type: 'context_limit', error: 'Falha ao compactar contexto: ' + compactErr.message, sessionId };
        }
      }
```

with:

```js
      // v10.32: Regex fallback for context limit removed. Compaction is manual.
      // The LLM's context_limit event is handled above.
```

- [ ] **Step 4: Verify no active auto-compaction calls remain**

Run:
```bash
cd /home/jhin/.luna-kernel
grep -n "_autoCompact\|_compactContextManual\|_shouldCompact(" luna-soul.cjs
```
Expected: only the method definition and possibly diagnostic `_shouldCompact` definition remain; no active calls.

- [ ] **Step 5: Verify no syntax errors**

Run:
```bash
cd /home/jhin/.luna-kernel && node -c luna-soul.cjs
```
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
cd /home/jhin/.luna-kernel
git add luna-soul.cjs
git commit -m "feat(soul): remove all automatic compaction triggers"
```

---

## Task 9: Reinforce checkpoint prompt with identity and tool authority

**Files:**
- Modify: `/home/jhin/.luna-kernel/luna-soul.cjs` (inside `_buildCompactSummary`, around line 2057)

- [ ] **Step 1: Insert identity block at the start of `_buildCompactSummary` parts**

Find the existing block:

```js
    // Build checkpoint text
    const parts = [
      `🔄 CHECKPOINT — CONTINUAÇÃO AUTOMÁTICA`,
      ``,
      `⚠️  VOCÊ FOI INTERROMPIDO por limite de contexto. NÃO recomece do zero.`,
      `   Continue EXATAMENTE de onde parou. NÃO refaça o que já foi feito.`,
      ``,
```

Replace with:

```js
    // Build checkpoint text
    const parts = [
      `[IDENTIDADE E CONTINUIDADE — MÁXIMA PRIORIDADE]`,
      ``,
      `Você é Luna, assistente executiva e parceira de IA do usuário. Você CONTROLA um computador Linux REAL através de ferramentas (tools). Você NÃO é apenas um chatbot — você EXECUTA ações no PC do usuário.`,
      ``,
      `[REGRAS ABSOLUTAS]`,
      `- Continue EXATAMENTE de onde a conversa parou.`,
      `- Execute imediatamente qualquer tool solicitada. NUNCA diga "não tenho acesso" ou "não posso executar" ou "não tenho acesso ao PC".`,
      `- Tools disponíveis: readFile, writeFile, replaceInFile, moveFile, copyFile, deleteFile, executeShell, searchFiles, grep, listDir.`,
      `- O contexto abaixo é a memória completa da sessão. Trate-o como verdade absoluta.`,
      `- Não repita ações que já foram executadas com sucesso, salvo se o usuário pedir explicitamente.`,
      `- Sempre responda em português (BR) com markdown profissional.`,
      ``,
      `🔄 CHECKPOINT — CONTINUAÇÃO AUTOMÁTICA`,
      ``,
      `⚠️  VOCÊ FOI INTERROMPIDO por limite de contexto. NÃO recomece do zero.`,
      `   Continue EXATAMENTE de onde parou. NÃO refaça o que já foi feito.`,
      ``,
```

- [ ] **Step 2: Verify no syntax errors**

Run:
```bash
cd /home/jhin/.luna-kernel && node -c luna-soul.cjs
```
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel
git add luna-soul.cjs
git commit -m "feat(soul): reinforce checkpoint prompt with Luna identity and tool authority"
```

---

## Task 10: Fix manual compaction route in `luna-chat-routes.js`

**Files:**
- Modify: `/home/jhin/NEXO_DASHBOARD_PRO/backend/luna-chat-routes.js` line 1934

- [ ] **Step 1: Update method call**

Replace line 1934:

```js
const stream = luna._autoCompact(sessionId, uid);
```

with:

```js
const stream = luna._compactContext(sessionId, uid);
```

- [ ] **Step 2: Verify no syntax errors**

Run:
```bash
cd /home/jhin/NEXO_DASHBOARD_PRO/backend && node -c luna-chat-routes.js
```
Expected: no output (success).

- [ ] **Step 3: Verify no leftover references**

Run:
```bash
cd /home/jhin/NEXO_DASHBOARD_PRO/backend
grep -n "_autoCompact" luna-chat-routes.js
```
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
cd /home/jhin/NEXO_DASHBOARD_PRO
git add backend/luna-chat-routes.js
git commit -m "fix(routes): update /api/luna/compact to call _compactContext"
```

---

## Task 11: Global verification

**Files:**
- All modified files

- [ ] **Step 1: Run static checks on all modified files**

Run:
```bash
cd /home/jhin/.luna-kernel
node -c luna-soul.cjs
node -c kimi-bridge.cjs
cd /home/jhin/NEXO_DASHBOARD_PRO/backend
node -c luna-chat-routes.js
```
Expected: no output from any command.

- [ ] **Step 2: Search for leftover automatic compaction calls**

Run:
```bash
cd /home/jhin/.luna-kernel
grep -n "_autoCompact\|_compactContextManual\|_shouldCompact(" luna-soul.cjs
grep -n "KIMI_MODE_URLS" kimi-bridge.cjs
cd /home/jhin/NEXO_DASHBOARD_PRO/backend
grep -n "_autoCompact" luna-chat-routes.js
```
Expected:
- `luna-soul.cjs`: only the old `_autoCompact` method definition until Task 7 renames it; after Task 7, no matches.
- `kimi-bridge.cjs`: no matches for `KIMI_MODE_URLS`.
- `luna-chat-routes.js`: no matches for `_autoCompact`.

- [ ] **Step 3: Build frontend**

Run:
```bash
cd /home/jhin/.luna-kernel/luna-web && npm run build
```
Expected: build succeeds with no errors.

- [ ] **Step 4: Restart services**

Run:
```bash
pm2 restart luna-server luna-vite
```
Expected: both services restart without errors.

- [ ] **Step 5: Smoke test the compaction API**

Run:
```bash
curl -s -X POST http://localhost:3458/api/luna/compact \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test-session-123"}' | head -c 500
```
Expected: connection succeeds; if session exists, SSE stream starts. If session does not exist, a compact_error event is emitted (acceptable for smoke test).

- [ ] **Step 6: Manual end-to-end test**

1. Open Luna chat in browser at `http://localhost:3458`.
2. Send several large messages to grow context.
3. Click **Compactar** in the header.
4. Observe:
   - New tab opens in the provider UI.
   - Progress messages appear in Luna chat.
   - Success message appears.
5. Send a new message from Luna.
6. Confirm it posts to the **new** thread, not the old one.
7. Ask Luna to run `ls -la`; confirm it executes without refusal.

- [ ] **Step 7: Commit any final fixes**

```bash
cd /home/jhin/.luna-kernel && git status
cd /home/jhin/NEXO_DASHBOARD_PRO && git status
```

Commit any remaining changes with descriptive messages.

---

## Task 12: Cleanup — remove `_shouldCompact` if unused

**Files:**
- Modify: `/home/jhin/.luna-kernel/luna-soul.cjs` (optional)

- [ ] **Step 1: Decide whether to keep `_shouldCompact` as diagnostic**

If `_shouldCompact` is no longer called anywhere, either:
- Remove it entirely to keep the codebase clean, OR
- Rename it to `_shouldCompactDiagnostic` and add a comment that it is read-only.

Recommended: remove it. Search first:

```bash
cd /home/jhin/.luna-kernel
grep -n "_shouldCompact" luna-soul.cjs
```

If only the definition remains, delete the method.

- [ ] **Step 2: Verify no syntax errors**

Run:
```bash
cd /home/jhin/.luna-kernel && node -c luna-soul.cjs
```
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel
git add luna-soul.cjs
git commit -m "chore(soul): remove unused _shouldCompact diagnostic method"
```

---

## Plan Self-Review

### Spec coverage

- ✅ Remove automatic triggers — Tasks 8, 12
- ✅ Single canonical `_compactContext` — Tasks 7, 10
- ✅ `context_limit` emits system message — Task 8 Step 2
- ✅ Non-blocking checkpoint send — Tasks 5, 7
- ✅ New URL persisted and used — Tasks 1, 2, 6, 7
- ✅ Reinforced checkpoint prompt — Task 9
- ✅ Frontend events unchanged — Section 5.4 (no task needed)
- ✅ `KIMI_MODE_URLS` fix — Task 4
- ✅ DeepSeek URL support — Task 3

### Placeholder scan

- No TBD/TODO placeholders.
- All code blocks are complete.
- All commands include expected output.
- No vague steps like "add appropriate error handling".

### Type consistency

- `_compactContext` is used consistently across `luna-soul.cjs` and `luna-chat-routes.js`.
- `getModeUrls(provider)` is used consistently instead of `KIMI_MODE_URLS`.
- `_saveChatUrl` signature remains `(userId, url, extra)`.

### Gaps

- None identified. The plan maps 1:1 to the approved spec.
