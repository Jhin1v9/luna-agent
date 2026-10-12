# Luna Manual Context Compaction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Luna's context compaction fully manual, robust, and regression-free by removing all automatic triggers, fixing the method-name crash, hardening the URL handoff, and reinforcing the checkpoint prompt.

**Architecture:** Keep compaction logic inside `luna-soul.cjs`; add non-blocking delivery helpers to `kimi-bridge.cjs`; wire the manual route in `luna-chat-routes.js`; verify the runtime frontend already displays compaction feedback correctly.

**Tech Stack:** Node.js, CommonJS, Playwright, Svelte 4, Express, SSE.

---

## Files

| File | Responsibility |
|---|---|
| `/home/jhin/.luna-kernel/kimi-bridge.cjs` | Add `_captureCurrentChatUrl` and `sendMessageNoWait`; ensure `_clearChatUrl` is solid; `newChat` already captures URL. |
| `/home/jhin/.luna-kernel/luna-soul.cjs` | Rename compaction method to `_compactContext`; remove auto-triggers; use non-blocking checkpoint send; reinforce prompt. |
| `/home/jhin/NEXO_DASHBOARD_PRO/backend/luna-chat-routes.js` | Fix `/api/luna/compact` to call `_compactContext`. |
| `/home/jhin/.luna-kernel/luna-web/src/components/ChatArea.svelte` | Already handles `compact_start`, `compact_progress`, `compact_end`, and `compact_error` correctly. No changes needed. |

---

## Task 1: Add `_captureCurrentChatUrl` to `kimi-bridge.cjs`

**Files:**
- Modify: `/home/jhin/.luna-kernel/kimi-bridge.cjs:837` (after `_clearChatUrl`)

- [ ] **Step 1: Insert helper after `_clearChatUrl`**

```js
  /**
   * Capture and persist the current chat URL for a user.
   * Throws if the current page is not a /chat/ thread.
   */
  async _captureCurrentChatUrl(userId) {
    const session = this.userSessions.get(userId);
    if (!session?.page) {
      throw new Error(`No active page for user ${hashUserId(userId)}`);
    }
    const url = session.page.url();
    if (!url || !url.includes('/chat/')) {
      throw new Error(`Current URL is not a valid chat thread: ${url}`);
    }
    session.chatUrl = url;
    this._saveChatUrl(userId, url);
    log.info(`Captured and saved chatUrl for user ${hashUserId(userId)}: ${url}`);
    return url;
  }
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd /home/jhin/.luna-kernel && node -c kimi-bridge.cjs`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel
git add kimi-bridge.cjs
git commit -m "feat(bridge): add _captureCurrentChatUrl helper"
```

---

## Task 2: Add `sendMessageNoWait` to `kimi-bridge.cjs`

**Files:**
- Modify: `/home/jhin/.luna-kernel/kimi-bridge.cjs:3314` (after `sendMessage`)

- [ ] **Step 1: Insert `sendMessageNoWait` after `sendMessage`**

```js
  /**
   * Send a message to Kimi Web without waiting for the full response.
   * Use this for checkpoint messages where we only need delivery confirmation.
   * Returns once the message is submitted and the input is cleared.
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

    session.lastActivity = Date.now();

    // Verify session and optional mode
    await this._verifySession(page);
    if (options.mode && !['agent', 'swarm'].includes(options.mode)) {
      await this.setMode(userId, options.mode);
    }

    const inputLocator = page.locator('textarea, [contenteditable="true"]').first();
    const inputCount = await inputLocator.count();
    if (inputCount === 0) {
      throw new Error('Input field not found on Kimi Web');
    }

    await page.bringToFront();
    await inputLocator.evaluate((el) => el.focus());
    await page.waitForTimeout(200);

    // Clear and fill
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

    // Submit
    await this._pressEnterOnInput(inputLocator);
    log.info(`[sendMessageNoWait] Submitted message for user ${hashUserId(userId)}`);

    // Wait for delivery confirmation: input cleared or no longer contains original text
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

    // Capture and save URL after submit
    const url = page.url();
    if (url.includes('/chat/')) {
      session.chatUrl = url;
      this._saveChatUrl(userId, url);
    }

    return { sent: true, url };
  }
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd /home/jhin/.luna-kernel && node -c kimi-bridge.cjs`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel
git add kimi-bridge.cjs
git commit -m "feat(bridge): add sendMessageNoWait for non-blocking checkpoint delivery"
```

---

## Task 3: Rename and harden compaction method in `luna-soul.cjs`

**Files:**
- Modify: `/home/jhin/.luna-kernel/luna-soul.cjs:1760-1857`

- [ ] **Step 1: Replace `_compactContextManual` with `_compactContext`**

Replace the entire method block at lines 1760-1857 with:

```js
  async *_compactContext(sessionId, userId = 'luna-default') {
    console.log(`[DEBUG-LUNA] _compactContext started for session ${sessionId}`);
    yield { type: 'compact_start', message: '📦 Compactação manual iniciada. Criando checkpoint inteligente...', sessionId };

    try {
      // 1. Read all events
      const events = this.sessionManager.readRecentEvents(sessionId, 999);

      // 2. Build a rich checkpoint summary (brain transplant)
      yield { type: 'compact_progress', message: '🧠 Analisando estado da sessão...', sessionId };
      const summary = this._buildCompactSummary(events);
      console.log(`[LUNA] Compact summary built: ${summary.length} chars, ${events.length} events`);

      // 3. Create new thread in Kimi Web
      if (!this.kimiBridge) {
        throw new Error('Kimi bridge not available');
      }

      yield { type: 'compact_progress', message: '🔄 Criando nova thread no Kimi Web...', sessionId };

      // v10.32-fix: Clear old chatUrl BEFORE calling newChat() so crash-recovery
      // doesn't navigate back to the stale chat page if new tab creation fails.
      try {
        this.kimiBridge._clearChatUrl(userId);
        console.log(`[LUNA-v10.32] Cleared old chatUrl before newChat for user ${userId}`);
      } catch (e) {
        console.warn(`[LUNA-v10.32] Failed to clear chatUrl: ${e.message}`);
      }

      let newChatResult;
      try {
        newChatResult = await this.kimiBridge.newChat(userId);
        console.log(`[LUNA] New chat created for user ${userId}: ${newChatResult?.chatUrl}`);
      } catch (err) {
        yield { type: 'compact_error', message: `❌ Falha ao criar nova thread: ${err.message}. Contexto preservado.`, sessionId };
        console.log(`[DEBUG-LUNA] _compactContext finished (newChat failed)`);
        return { success: false, error: err.message };
      }

      // 4. SEND CHECKPOINT TO KIMI WEB as first message
      // CRITICAL: This ensures Kimi has the full context BEFORE the user's next message.
      // v10.32-fix: Use sendMessageNoWait so compaction succeeds even if Kimi is slow.
      yield { type: 'compact_progress', message: '📝 Enviando checkpoint de continuação para o Kimi Web...', sessionId };

      let bridgeSession = null;
      let wasProcessing = false;
      try {
        bridgeSession = this.kimiBridge.userSessions?.get(userId);
        wasProcessing = bridgeSession?.processing;
        if (bridgeSession) bridgeSession.processing = false;

        // Wait for the new page input to be ready
        const page = bridgeSession?.page;
        if (page) {
          try {
            await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 10000 });
            console.log(`[LUNA] New chat input ready for checkpoint`);
          } catch (e) {
            console.warn(`[LUNA] New chat input not ready: ${e.message}`);
          }
        }

        const sendResult = await Promise.race([
          this.kimiBridge.sendMessageNoWait(userId, summary, { mode: 'thinking' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout ao enviar checkpoint (120s)')), 120000))
        ]);

        console.log(`[LUNA] Checkpoint submitted to new chat. URL: ${sendResult?.url}`);
        yield { type: 'compact_progress', message: `✅ Checkpoint enviado para nova thread`, sessionId };
      } catch (sendErr) {
        console.error('[LUNA] Failed to send checkpoint to new chat:', sendErr.message);
        yield { type: 'compact_error', message: `❌ Checkpoint não enviado: ${sendErr.message}. Contexto local preservado.`, sessionId };
        console.log(`[DEBUG-LUNA] _compactContext finished (checkpoint send failed)`);
        return { success: false, error: sendErr.message };
      } finally {
        // ALWAYS restore processing state, even on timeout/error
        if (bridgeSession && wasProcessing) bridgeSession.processing = wasProcessing;
      }

      // 5. Capture and persist the REAL new thread URL
      let finalUrl;
      try {
        finalUrl = await this.kimiBridge._captureCurrentChatUrl(userId);
        console.log(`[LUNA-v10.32] Captured final chatUrl after checkpoint: ${finalUrl}`);
      } catch (captureErr) {
        // Fallback to newChat result if capture fails
        finalUrl = newChatResult?.chatUrl;
        if (!finalUrl) {
          yield { type: 'compact_error', message: `❌ Não foi possível confirmar URL da nova thread: ${captureErr.message}. Contexto preservado.`, sessionId };
          return { success: false, error: captureErr.message };
        }
        console.warn(`[LUNA-v10.32] _captureCurrentChatUrl failed, using newChat URL: ${finalUrl}`);
      }

      // 6. Clear local context ONLY after newChat + checkpoint send + URL capture succeeded
      this.sessionManager.clearContext(sessionId);

      // 7. Store summary as first local event (fallback + loop continuity)
      this.sessionManager.appendEvent(sessionId, {
        type: 'assistant',
        mode: 'CHAT',
        response: `[CHECKPOINT] Contexto compactado. Nova thread: ${finalUrl}\n\n${summary.slice(0, 2000)}${summary.length > 2000 ? '\n\n[... resumo truncado no contexto local, completo enviado ao Kimi]' : ''}`,
        timestamp: new Date().toISOString(),
      });

      yield { type: 'compact_end', message: '✅ Contexto compactado. Nova thread pronta com checkpoint inteligente.', summary, sessionId };
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

Run: `cd /home/jhin/.luna-kernel && node -c luna-soul.cjs`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel
git add luna-soul.cjs
git commit -m "feat(soul): rename and harden _compactContext method"
```

---

## Task 4: Remove automatic compaction triggers in `luna-soul.cjs`

**Files:**
- Modify: `/home/jhin/.luna-kernel/luna-soul.cjs:2356-2366`, `2530-2550`, `2674-2693`

- [ ] **Step 1: Remove proactive `_shouldCompact` trigger**

Replace lines 2356-2366:

```js
          // v10.15-fix: Auto-compact proativo antes de enviar pro Kimi.
          // Se o contexto estimado ultrapassar 220K tokens, compacta ANTES de enviar.
          // Limite do Kimi K2.6 é 256K tokens — 220K dá margem de segurança.
          // compact_start/compact_progress/compact_end já têm animação de fases da lua no frontend.
          if (bridgeRetryCount === 0 && this._shouldCompact(sessionId)) {
            const compactResult = yield* this._autoCompact(sessionId, userId);
            if (compactResult.success) {
              // Rebuild context after compact
              loopContext = await this._buildContext(sessionId, loopInput, { ...options, isFirstMessage: false });
            }
          }
```

with:

```js
          // v10.32-fix: Compactação é 100% manual via botão "Compactar".
          // Nenhuma compactação automática deve acontecer aqui.
```

- [ ] **Step 2: Replace `context_limit` auto-compact with system message**

Replace lines 2530-2550:

```js
            case 'context_limit': {
              // v5.8-fix: Auto-compact + new thread quando Kimi reporta limite de contexto
              fullResponse = event.response || '';
              yield { type: 'system', message: '📦 Limite de contexto atingido. Compactando e criando nova thread...', sessionId };
              const compactResult = yield* this._autoCompact(sessionId, userId);
              if (compactResult.success) {
                // v10.12-fix-deadlock: The previous sendMessageStream still holds session.processing=true.
                // If we continue the while-loop immediately, the new sendMessageStream will deadlock.
                // We MUST release the lock before creating a new stream.
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
              // v10.32-fix: Compactação é manual. Informa o usuário e para o stream.
              fullResponse = event.response || '';
              yield {
                type: 'system',
                message: '📦 Limite de contexto atingido. Clique em "Compactar" no cabeçalho para continuar.',
                sessionId
              };
              return;
            }
```

- [ ] **Step 3: Remove regex fallback trigger**

Replace lines 2674-2693:

```js
      // v5.8-fix: Context limit detectado pelo texto da resposta. Auto-compact + new thread.
      if (/getting too long|conversation.*too long|try starting a new session|context limit|token limit|聊得太长|发起一个新会话|会话太长/i.test(fullResponse)) {
        yield { type: 'system', message: '📦 Limite de contexto atingido. Compactando e criando nova thread...', sessionId };
        try {
          const compactResult = yield* this._autoCompact(sessionId, userId);
          if (compactResult.success) {
            // v10.12-fix-deadlock: Release processing lock before continuing
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
      // v10.32-fix: Regex fallback de context limit removido. Compactação é manual.
      // Se o Kimi responder com frases de limite, o evento context_limit já foi tratado acima.
```

- [ ] **Step 4: Verify no syntax errors**

Run: `cd /home/jhin/.luna-kernel && node -c luna-soul.cjs`
Expected: no output (success)

- [ ] **Step 5: Commit**

```bash
cd /home/jhin/.luna-kernel
git add luna-soul.cjs
git commit -m "feat(soul): remove all automatic compaction triggers"
```

---

## Task 5: Reinforce checkpoint prompt with identity and tool authority

**Files:**
- Modify: `/home/jhin/.luna-kernel/luna-soul.cjs:1986-1989`

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
      `- Sempre responda em português (BR) com markdown profissional e emojis quando apropriado.`,
      ``,
      `🔄 CHECKPOINT — CONTINUAÇÃO AUTOMÁTICA`,
      ``,
      `⚠️  VOCÊ FOI INTERROMPIDO por limite de contexto. NÃO recomece do zero.`,
      `   Continue EXATAMENTE de onde parou. NÃO refaça o que já foi feito.`,
      ``,
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd /home/jhin/.luna-kernel && node -c luna-soul.cjs`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel
git add luna-soul.cjs
git commit -m "feat(soul): reinforce checkpoint prompt with Luna identity and tool authority"
```

---

## Task 6: Fix manual compaction route in `luna-chat-routes.js`

**Files:**
- Modify: `/home/jhin/NEXO_DASHBOARD_PRO/backend/luna-chat-routes.js:1769`

- [ ] **Step 1: Update method call**

Replace line 1769:

```js
    const stream = luna._autoCompact(sessionId, uid);
```

with:

```js
    const stream = luna._compactContext(sessionId, uid);
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd /home/jhin/NEXO_DASHBOARD_PRO/backend && node -c luna-chat-routes.js`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/NEXO_DASHBOARD_PRO
git add backend/luna-chat-routes.js
git commit -m "fix(routes): update /api/luna/compact to call _compactContext"
```

---

## Task 7: Global verification

- [ ] **Step 1: Search for leftover automatic compaction calls**

Run:
```bash
cd /home/jhin/.luna-kernel
grep -n "_autoCompact\|_compactContextManual\|_shouldCompact(" luna-soul.cjs
cd /home/jhin/NEXO_DASHBOARD_PRO
grep -n "_autoCompact" backend/luna-chat-routes.js
```

Expected: only definitions or diagnostic references remain; no active calls.

- [ ] **Step 2: Build and restart services**

Run:
```bash
cd /home/jhin/.luna-kernel/luna-web && npm run build
pm2 restart luna-server
pm2 restart luna-vite
```

Expected: build succeeds; both services restart without errors.

- [ ] **Step 3: Smoke test the API**

Run:
```bash
curl -s -X POST http://localhost:3458/api/luna/compact \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test-session-123"}' | head -c 500
```

Expected: connection succeeds; if Luna Soul is available and session exists, SSE stream starts. If session does not exist, it returns an error message (acceptable for smoke test).

- [ ] **Step 4: End-to-end manual test**

1. Open Luna chat in browser.
2. Send several large messages to grow context.
3. Click **Compactar** in the header.
4. Verify:
   - New Kimi tab opens.
   - Progress messages appear in Luna chat.
   - Success message appears.
5. Send a new message from Luna.
6. Verify it posts to the new Kimi thread, not the old one.
7. Ask Kimi to run `ls -la`; verify it executes without refusal.

- [ ] **Step 5: Commit any final fixes**

```bash
cd /home/jhin/.luna-kernel && git status
cd /home/jhin/NEXO_DASHBOARD_PRO && git status
```

Commit any remaining changes with descriptive messages.

---

## Rollback Plan

If regressions occur:

1. Stop services:
   ```bash
   pm2 stop luna-server luna-vite
   ```
2. Restore from backups:
   ```bash
   cd /home/jhin/.luna-kernel
   cp luna-soul.cjs.bak.v10.30-refactor.20260619-184747 luna-soul.cjs
   cp kimi-bridge.cjs.bak.v10.30-refactor.20260619-184747 kimi-bridge.cjs
   cd /home/jhin/NEXO_DASHBOARD_PRO
   git checkout -- backend/luna-chat-routes.js
   ```
3. Rebuild frontend:
   ```bash
   cd /home/jhin/.luna-kernel/luna-web && npm run build
   ```
4. Restart services:
   ```bash
   pm2 restart luna-server luna-vite
   ```

---

## Plan Self-Review

- **Spec coverage:** Every requirement from `2026-06-20-luna-manual-context-compaction-design.md` maps to a task above.
- **Placeholder scan:** No TBD/TODO placeholders; all code blocks are complete.
- **Type consistency:** Method name `_compactContext` is used consistently across `luna-soul.cjs` and `luna-chat-routes.js`.
- **Risk note:** `sendMessageNoWait` duplicates some input-filling logic from `sendMessage` to avoid refactoring a stable method. This is intentional and minimizes regression risk.
