# Design Spec — Luna Compactação Manual Robusta (v10.32)

> Status: Aprovado para implementação  
> Date: 2026-07-03  
> Scope: `luna-soul.cjs`, `kimi-bridge.cjs`, `luna-chat-routes.js`  

---

## 1. Objective

Make Luna's context compaction **fully manual**, **robust**, and **regression-free**.

The user triggers compaction exclusively through the **"Compactar" button in the Luna chat header**. After compaction:

- The old exhausted chat thread is abandoned.
- A new chat thread is created.
- The checkpoint summary is delivered to the new thread.
- Luna's stored `chatUrl` is updated to the new thread URL.
- Subsequent user messages never navigate back to the old thread.
- The LLM continues to execute tools without refusing due to "no PC access".

---

## 2. Current Problems

| # | Problem | Location | Impact |
|---|---|---|---|
| 1 | Method name mismatch: manual route invokes `_autoCompact`, but the implementation is named `_autoCompact` and the spec proposes `_compactContext`. | `luna-soul.cjs:1787`, `luna-chat-routes.js:1934` | Compaction may throw `TypeError` if renamed inconsistently. |
| 2 | Automatic compaction triggers still exist (proactive token threshold, `context_limit` event, regex fallback). | `luna-soul.cjs:2416-2422`, `2551-2567`, `2693-2711` | Unexpected auto-compactions; user wants full manual control. |
| 3 | Checkpoint send uses `sendMessage`, which blocks until the LLM responds. Slow responses trigger 60s timeout and compaction fails. | `luna-soul.cjs:1850` | User must manually retry; flow is not fluid. |
| 4 | After compaction, new Luna messages can return to the old exhausted thread. | `kimi-bridge.cjs` URL management | User has to compact multiple times and manually close tabs. |
| 5 | Checkpoint prompt is weak; the LLM often refuses tools claiming no PC access. | `luna-soul.cjs:_buildCompactSummary` | Loss of agent identity and capability after compaction. |
| 6 | Helpers `_clearChatUrl` and `_captureCurrentChatUrl` do not exist in the bridge. | `kimi-bridge.cjs` | Manual URL capture is fragile and scattered. |
| 7 | `KIMI_MODE_URLS` constant does not exist; agent/swarm modes throw `ReferenceError`. | `kimi-bridge.cjs:2547`, `3525` | Mode switching is broken. |
| 8 | `_saveChatUrl` only accepts URLs containing `/chat/`, excluding DeepSeek (`/c/...`). | `kimi-bridge.cjs:917-918` | Non-Kimi providers never persist thread URLs. |

---

## 3. Success Criteria

- [ ] No automatic compaction trigger remains in the codebase.
- [ ] A single canonical method `_compactContext` exists and is called by `/api/luna/compact`.
- [ ] When the LLM reports `context_limit`, Luna emits a system message asking the user to click **Compactar**.
- [ ] Compaction succeeds even when the LLM takes a long time to generate the first response.
- [ ] After compaction, the next Luna message uses the new thread URL.
- [ ] The checkpoint prompt reinforces Luna identity and tool-execution authority.
- [ ] Frontend displays `compact_start`, `compact_progress`, `compact_end`, and `compact_error` events.
- [ ] `agent`/`swarm` modes do not throw `ReferenceError`.
- [ ] DeepSeek thread URLs (`/c/...`) can be persisted.

---

## 4. Architecture

```
User clicks "Compactar"
        │
        ▼
POST /api/luna/compact
        │
        ▼
luna-chat-routes.js ──► luna._compactContext(sessionId, userId)
        │
        ▼
[1] Build checkpoint summary (brain transplant)
[2] kimiBridge._clearChatUrl(userId)
[3] kimiBridge.newChat(userId) ──► new tab + new thread URL
[4] kimiBridge.sendMessageNoWait(userId, summary) ──► submit only
[5] kimiBridge._captureCurrentChatUrl(userId) ──► persist new URL
[6] sessionManager.clearContext(sessionId)
[7] sessionManager.appendEvent(sessionId, assistant checkpoint)
        │
        ▼
SSE: compact_start → compact_progress → compact_end
```

**Error handling invariant:** local context MUST NOT be cleared if any of steps [2]-[5] fail. The user must be able to retry.

---

## 5. Detailed Changes

### 5.1 `luna-soul.cjs`

#### 5.1.1 Canonical compaction method

Replace `_autoCompact` with a single method:

```js
async *_compactContext(sessionId, userId = 'luna-default') { ... }
```

Update call sites:
- `luna-soul.cjs:2416` (proactive trigger — to be removed)
- `luna-soul.cjs:2551` (`context_limit` handler — change to system message)
- `luna-soul.cjs:2693` (regex fallback — to be removed)
- `luna-chat-routes.js:1934` (manual route — rename call)

#### 5.1.2 Remove automatic triggers

1. **Proactive trigger** (`luna-soul.cjs:2416-2422`): delete the `_shouldCompact` check and compaction call before `sendMessageStream`.
2. **`context_limit` handler** (`luna-soul.cjs:2551-2567`): replace with:
   ```js
   case 'context_limit': {
     fullResponse = event.response || '';
     yield {
       type: 'system',
       message: '📦 Limite de contexto atingido. Clique em "Compactar" no cabeçalho para continuar.',
       sessionId
     };
     return;
   }
   ```
3. **Regex fallback** (`luna-soul.cjs:2693-2711`): delete entirely. The bridge already emits `context_limit`.

`_shouldCompact` may be retained as read-only diagnostic code but must not trigger automatic compaction.

#### 5.1.3 Robust checkpoint send

Inside `_compactContext`:

```js
// 1. Clear old URL before creating new thread
this.kimiBridge._clearChatUrl(userId);

// 2. Create new thread
const newChatResult = await this.kimiBridge.newChat(userId, null, { requireChatUrl: false });

// 3. Send checkpoint without waiting for full response
yield { type: 'compact_progress', message: '📝 Enviando checkpoint...', sessionId };
await this.kimiBridge.sendMessageNoWait(userId, summary, { mode: 'thinking' });

// 4. Capture and persist the REAL new thread URL
const finalUrl = await this.kimiBridge._captureCurrentChatUrl(userId);

// 5. Clear local context only after URL is safely persisted and checkpoint delivered
this.sessionManager.clearContext(sessionId);
this.sessionManager.appendEvent(sessionId, {
  type: 'assistant',
  mode: 'CHAT',
  response: `[CHECKPOINT] Contexto compactado. Nova thread: ${finalUrl}\n\n${summary.slice(0, 2000)}...`,
  timestamp: new Date().toISOString(),
});

yield { type: 'compact_end', message: '✅ Contexto compactado. Nova thread pronta.', summary, sessionId };
return { success: true, summary, chatUrl: finalUrl };
```

If any step fails before [5], local context MUST NOT be cleared.

#### 5.1.4 Reinforced checkpoint prompt

Prepend the following system block at the start of `_buildCompactSummary`:

```markdown
[IDENTIDADE E CONTINUIDADE — MÁXIMA PRIORIDADE]

Você é Luna, assistente executiva e parceira de IA do usuário. Você CONTROLA um computador Linux REAL através de ferramentas (tools). Você NÃO é apenas um chatbot — você EXECUTA ações no PC do usuário.

[REGRAS ABSOLUTAS]
- Continue EXATAMENTE de onde a conversa parou.
- Execute imediatamente qualquer tool solicitada. NUNCA diga "não tenho acesso" ou "não posso executar".
- Tools disponíveis: readFile, writeFile, replaceInFile, moveFile, copyFile, deleteFile, executeShell, searchFiles, grep, listDir.
- O contexto abaixo é a memória completa da sessão. Trate-o como verdade absoluta.
- Não repita ações que já foram executadas com sucesso, salvo se o usuário pedir explicitamente.
- Sempre responda em português (BR) com markdown profissional.

[ESTADO ATUAL DA SESSÃO]
```

The existing structured extraction follows this block.

---

### 5.2 `kimi-bridge.cjs`

#### 5.2.1 `_clearChatUrl`

```js
_clearChatUrl(userId) {
  const session = this.userSessions.get(userId);
  if (session) {
    session.chatUrl = null;
  }
  this.store.setUser(userId, { chatUrl: null, lastActivity: Date.now() });
  log.info(`Cleared chatUrl for user ${hashUserId(userId)}`);
}
```

#### 5.2.2 `_captureCurrentChatUrl`

```js
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

#### 5.2.3 `sendMessageNoWait`

Extract input filling and submission from `sendMessage` into a reusable helper.

Behavior:
1. Locate the chat input (`textarea` or `[contenteditable="true"]`).
2. Fill with the provided text.
3. Trigger submit (Enter or button click).
4. Wait until the message is visible in the DOM **or** the input is empty and no "sending" indicator is active.
5. Return as soon as delivery is confirmed; do **not** wait for the LLM response text.
6. Timeout: 120s for extreme cases.

```js
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
  await this._verifySession(page);

  const inputLocator = page.locator('textarea, [contenteditable="true"]').first();
  if (await inputLocator.count() === 0) {
    throw new Error('Input field not found');
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

  // Wait for delivery confirmation
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

#### 5.2.4 `newChat` URL guarantee

Ensure `newChat`:
- Calls `_clearChatUrl(userId)` at the start.
- Persists the new URL via `_saveChatUrl` immediately after detection.
- Returns `{ chatUrl, mode }`.

#### 5.2.5 Fix `_saveChatUrl` for non-Kimi providers

Change validation from requiring `/chat/` to validating against the current provider's domain/path pattern.

```js
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

Add `_isProviderThreadUrl(provider, url)` helper:
- `kimi`: `/chat/`
- `deepseek`: `/c/` or `/chat/`
- fallback: any URL under provider domain

#### 5.2.6 Fix `KIMI_MODE_URLS` references

Replace `KIMI_MODE_URLS[mode]` with `getModeUrls(provider)[mode]` at `kimi-bridge.cjs:2547` and `3525`.

---

### 5.3 `luna-chat-routes.js`

#### 5.3.1 Fix manual compaction route

Change line 1934:

```js
// Before
const stream = luna._autoCompact(sessionId, uid);

// After
const stream = luna._compactContext(sessionId, uid);
```

#### 5.3.2 Allow compaction events

Ensure `compact_start`, `compact_progress`, `compact_end`, `compact_error` are in the allowed event list at line 492 (already present; verify after edits).

---

### 5.4 Frontend

No changes required. The runtime frontend at `luna-web/src/components/ChatArea.svelte` already handles compaction events.

---

## 6. Testing Plan

### 6.1 Static checks

```bash
cd /home/jhin/.luna-kernel
node -c luna-soul.cjs
node -c kimi-bridge.cjs
cd /home/jhin/NEXO_DASHBOARD_PRO/backend && node -c luna-chat-routes.js
```

### 6.2 Code search

```bash
cd /home/jhin/.luna-kernel
grep -n "_autoCompact\|_compactContextManual\|_shouldCompact(" luna-soul.cjs
grep -n "KIMI_MODE_URLS" kimi-bridge.cjs
cd /home/jhin/NEXO_DASHBOARD_PRO/backend
grep -n "_autoCompact" luna-chat-routes.js
```

Expected: only definitions or diagnostic references remain; no active calls.

### 6.3 Manual end-to-end test

1. Create a Luna chat session and send several large messages.
2. Click **Compactar** in the header.
3. Observe:
   - New tab opens with thread URL.
   - Checkpoint message appears in the new thread.
   - Luna shows progress messages and a success message.
4. Send a new message from Luna.
5. Confirm the message is posted to the **new** thread, not the old one.
6. Ask Luna to execute a shell command (e.g., `ls -la`); confirm it executes without refusal.

### 6.4 Slow-response test

1. Simulate a slow LLM response after the checkpoint (e.g., throttle network or use a long prompt).
2. Verify compaction still completes and the new URL is saved.

---

## 7. Rollback Plan

If regressions are detected:

1. Stop `luna-server` and `luna-vite`.
2. Restore backups:
   - `luna-soul.cjs.bak.v10.30-refactor.20260619-184747`
   - `kimi-bridge.cjs.bak.v10.30-refactor.20260619-184747`
3. Rebuild frontend:
   ```bash
   cd /home/jhin/.luna-kernel/luna-web && npm run build
   ```
4. Restart services:
   ```bash
   pm2 restart luna-server luna-vite
   ```

---

## 8. Out of Scope

- Refactoring the entire tool execution pipeline (deduplication, concurrency, sandbox).
- Replacing Playwright with a native API.
- Changing the installation/startup flow (`install.sh`, `luna` command, PM2 ecosystem).
- Adding automated test suite beyond static checks and manual end-to-end.

These are tracked separately and should be addressed after compaction is stable.
