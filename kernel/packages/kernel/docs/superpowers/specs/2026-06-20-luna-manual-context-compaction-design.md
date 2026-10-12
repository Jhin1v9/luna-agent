# Design Spec — Luna Manual Context Compaction (v10.32)

> Status: Pending implementation approval  
> Author: Luna engineering assistant  
> Date: 2026-06-20

---

## 1. Objective

Make Luna's context compaction **fully manual**, **robust**, and **regression-free**.

The user triggers compaction exclusively through the **"Compactar" button in the Luna chat header** (not a `/compact` slash command). After compaction:

- The old exhausted Kimi Web thread is abandoned.
- A new Kimi Web thread is created.
- The checkpoint summary is delivered to the new thread.
- Luna's stored `chatUrl` is updated to the new thread URL.
- Subsequent user messages never navigate back to the old thread.
- Kimi continues to execute tools without refusing due to "no PC access".

---

## 2. Current Problems

| # | Problem | Location | Impact |
|---|---|---|---|
| 1 | Method name mismatch: callers invoke `_autoCompact`, but the implementation is named `_compactContextManual`. | `luna-soul.cjs:2361,2534,2678` and `luna-chat-routes.js:1769` | Compaction throws `TypeError` and breaks the stream. |
| 2 | Automatic compaction triggers still exist (proactive token threshold, `context_limit` event, regex fallback). | `luna-soul.cjs:2360-2366, 2530-2550, 2675-2693` | Unexpected auto-compactions; user wants full manual control. |
| 3 | Checkpoint send uses `sendMessage`, which blocks until Kimi responds. If Kimi is slow, the 60s timeout fires and compaction fails. | `luna-soul.cjs:1818-1821` | User must manually press Enter in Kimi; flow is not fluid. |
| 4 | After compaction, new Luna messages can return to the old exhausted Kimi thread. | `kimi-bridge.cjs` URL management | User has to compact multiple times and manually close tabs. |
| 5 | Checkpoint prompt is weak; Kimi often refuses tools claiming no PC access. | `luna-soul.cjs:_buildCompactSummary` | Loss of agent identity and capability after compaction. |
| 6 | The NEXO copy of ChatArea.svelte appeared to ignore `compact_progress`/`compact_error`, but the runtime frontend in `.luna-kernel/luna-web` already handles all compaction events correctly. | `.luna-kernel/luna-web/src/components/ChatArea.svelte:722-767` | No frontend changes required. |

---

## 3. Success Criteria

- [ ] No caller references `_autoCompact` or `_compactContextManual`; a single canonical method exists.
- [ ] No automatic compaction trigger remains in the codebase.
- [ ] When Kimi reports `context_limit`, Luna emits a system message asking the user to click **Compactar**.
- [ ] Compaction succeeds even when Kimi takes a long time to generate the first response.
- [ ] After compaction, the next Luna message uses the new Kimi thread URL.
- [ ] The checkpoint prompt reinforces Luna identity and tool-execution authority.
- [ ] Frontend displays `compact_progress` and `compact_error` events.
- [ ] All changes are tested locally before claiming completion.

---

## 4. Architecture

```
User clicks "Compactar"
        │
        ▼
POST /api/luna/compact
        │
        ▼
luna-chat-routes.js ──► luna-soul._compactContext(sessionId, userId)
        │
        ▼
[1] Build checkpoint summary (brain transplant)
[2] kimiBridge._clearChatUrl(userId)
[3] kimiBridge.newChat(userId) ──► new tab + new /chat/ URL
[4] kimiBridge.sendMessageNoWait(userId, summary) ──► submit only, don't wait for full response
[5] kimiBridge._captureCurrentChatUrl(userId) ──► persist new URL
[6] sessionManager.clearContext(sessionId)
[7] sessionManager.appendEvent(sessionId, assistant checkpoint)
        │
        ▼
SSE: compact_start → compact_progress → compact_end
```

---

## 5. Detailed Changes

### 5.1 `luna-soul.cjs`

#### 5.1.1 Canonical compaction method

Replace `_compactContextManual` with a single method:

```js
async *_compactContext(sessionId, userId = 'luna-default') { ... }
```

Update all call sites:
- `luna-soul.cjs:2361` (proactive trigger — to be removed)
- `luna-soul.cjs:2534` (`context_limit` handler — change to system message)
- `luna-soul.cjs:2678` (regex fallback — to be removed)
- `luna-chat-routes.js:1769` (manual route)

#### 5.1.2 Remove automatic triggers

1. **Proactive trigger** (`luna-soul.cjs:2360-2366`): delete the `_shouldCompact` check and the compaction call before `sendMessageStream`.
2. **`context_limit` handler** (`luna-soul.cjs:2530-2550`): replace with:
   ```js
   case 'context_limit': {
     fullResponse = event.response || '';
     yield {
       type: 'system',
       message: '📦 Limite de contexto atingido. Clique em "Compactar" no cabeçalho para continuar.',
       sessionId
     };
     break;
   }
   ```
3. **Regex fallback** (`luna-soul.cjs:2675-2693`): delete entirely. The bridge already emits `context_limit`; no secondary text heuristic is needed.

`_shouldCompact` must not be called automatically. Remove it entirely or leave it as unused diagnostic code; no future caller should rely on it for automatic compaction.

#### 5.1.3 Robust checkpoint send

Inside `_compactContext`:

```js
// 1. Clear old URL before creating new thread
this.kimiBridge._clearChatUrl(userId);

// 2. Create new thread
const { chatUrl } = await this.kimiBridge.newChat(userId);

// 3. Send checkpoint without waiting for Kimi's full response
yield { type: 'compact_progress', message: '📝 Enviando checkpoint...', sessionId };
await this.kimiBridge.sendMessageNoWait(userId, summary, { mode: 'thinking' });

// 4. Capture and persist the new thread URL
const finalUrl = await this.kimiBridge._captureCurrentChatUrl(userId);
this.kimiBridge._saveChatUrl(userId, finalUrl);

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
// IMPORTANT: If any step before this fails (newChat, sendMessageNoWait, URL capture),
// local context MUST NOT be cleared. Preserve the conversation so the user can retry.
```

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

The existing structured extraction (modified files, read files, commands, errors, current task) follows this block.

---

### 5.2 `kimi-bridge.cjs`

#### 5.2.1 Ensure `_clearChatUrl` exists

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

#### 5.2.2 `newChat` URL guarantee

`newChat` already creates a new tab and polls for `/chat/`. Ensure it:
- Calls `_clearChatUrl(userId)` at the start.
- Persists the new URL via `_saveChatUrl` immediately after detection.
- Returns `{ chatUrl, mode }`.

#### 5.2.3 New helper `sendMessageNoWait`

Extract input filling and submission from `sendMessage` into a reusable helper.

Behavior:
1. Locate the chat input (`textarea` or `[contenteditable="true"]`).
2. Fill with the provided text.
3. Trigger submit (Enter or button click).
4. Wait until the message is visible in the DOM **or** the input is empty and no "sending" indicator is active.
5. Return as soon as delivery is confirmed; do **not** wait for Kimi's response text.
6. Timeout: 120s only for extreme cases.

```js
async sendMessageNoWait(userId, text, options = {}) {
  const page = await this._getOrCreateUserPage(userId);
  // ... fill input, submit, wait for delivery confirmation ...
  return { sent: true, url: page.url() };
}
```

#### 5.2.4 New helper `_captureCurrentChatUrl`

```js
async _captureCurrentChatUrl(userId) {
  const session = this.userSessions.get(userId);
  if (!session?.page) throw new Error('No page for user');
  const url = session.page.url();
  if (!url.includes('/chat/')) {
    throw new Error(`Current URL is not a chat thread: ${url}`);
  }
  this._saveChatUrl(userId, url);
  return url;
}
```

---

### 5.3 `luna-chat-routes.js`

#### 5.3.1 Fix manual compaction route

Change line 1769:

```js
// Before
const stream = luna._autoCompact(sessionId, uid);

// After
const stream = luna._compactContext(sessionId, uid);
```

#### 5.3.2 Allow compaction events

Ensure `compact_start`, `compact_progress`, `compact_end`, `compact_error` are in the allowed event list at line 409.

---

### 5.4 Frontend (`ChatArea.svelte`)

No changes required. The runtime frontend at `.luna-kernel/luna-web/src/components/ChatArea.svelte` already handles:
- `compact_start` — shows a dedicated compact state and a system message.
- `compact_progress` — updates the compact state with the latest progress message.
- `compact_end` — clears the compact state and shows a system message.
- `compact_error` — clears the compact state and shows an error message.

The build command is `cd /home/jhin/.luna-kernel/luna-web && npm run build`.

---

## 6. Testing Plan

### 6.1 Unit / smoke tests

1. **Method existence**: Verify `luna._compactContext` is a generator function.
2. **No auto-triggers**: Search code for `_autoCompact`, `_compactContextManual`, `_shouldCompact` calls.
3. **Event routing**: Confirm `/api/luna/compact` returns `compact_start`, `compact_progress`, `compact_end`.

### 6.2 Manual end-to-end tests

1. Create a Luna chat session and send several large messages.
2. Click **Compactar** in the header.
3. Observe:
   - New Kimi tab opens with `/chat/...` URL.
   - Checkpoint message appears in the new Kimi thread.
   - Luna shows progress messages and a success message.
4. Send a new message from Luna.
5. Confirm the message is posted to the **new** Kimi thread, not the old one.
6. Ask Kimi to execute a shell command (e.g., `ls -la`); confirm it executes without refusal.

### 6.3 Slow-response test

1. Simulate a slow Kimi response after the checkpoint (e.g., throttle network or use a long prompt).
2. Verify compaction still completes and the new URL is saved.

---

## 7. Rollback Plan

If regressions are detected:

1. Stop `luna-server` and `luna-vite`.
2. Restore the previous backups:
   - `luna-soul.cjs.bak.v10.30-refactor.20260619-184747`
   - `kimi-bridge.cjs.bak.v10.30-refactor.20260619-184747`
3. Restart services.
4. Investigate and re-apply fixes incrementally.

---

## 8. Open Questions / Notes

- The user triggers compaction via the **header button**, not `/compact`. The route `/api/luna/compact` remains the backend API for that button.
- `_shouldCompact` can be retained as a read-only diagnostic but must not trigger automatic compaction.
- The separate `NEXO_DASHBOARD_PRO/agents/kimi-bridge.cjs` is **not** the runtime bridge; the runtime uses `/home/jhin/.luna-kernel/kimi-bridge.cjs`. Do not modify the agents copy for this fix.
