<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { isStreaming, currentMode, currentProvider, messages, sessions, currentSessionId, planModeState, mascotState, mascotMessage, activeModal, compactState } from '../stores.js';
  import { sendMessage, cancelStream, ackEvents, SSEManager, fetchSessionMessages, sessionAction, startPlanMode, approvePlan, rejectPlan, submitRevision, systemRestart, systemStop, systemStart, systemStatus, systemHealth, selfhealServices, systemLogs, executeLunaTool, confirmToolAction, startHeartbeat, stopHeartbeat, turnOffAgent, agentStatus, setVisibleMode, compactSession } from '../api.js';
  import { SLASH_COMMANDS, isSlashCommand } from '../lib/slashCommands.js';
  import { evictOldestEntries } from '../lib/evictSet.js';
  import { createToolTimerRegistry } from '../lib/toolTimers.js';
  import { shouldCreateToolCard, makeToolCardId } from '../lib/toolCardDedup.js';
  // Wave 8: TOOL_HIDDEN is GENERATED from the backend registry (meta.hidden) —
  // internal tools execute normally but never render a card.
  import { TOOL_HIDDEN } from '../lib/toolMeta.generated.js';
  import { createAckBatcher } from '../lib/ackBatcher.js';
  import { playSound } from '../sound.js';
  import ChatHeader from './ChatHeader.svelte';
  import MessagesList from './MessagesList.svelte';
  import ChatInput from './ChatInput.svelte';
  import TaskDashboardModal from './TaskDashboardModal.svelte';
  import LeadDashboardModal from './LeadDashboardModal.svelte';
  import FinanceDashboardModal from './FinanceDashboardModal.svelte';
  import VotingDashboardModal from './VotingDashboardModal.svelte';
  import CompactingAnimation from './CompactingAnimation.svelte';

  export let sessionId = null;

  let sseManager = new SSEManager();
  let currentAssistantId = null;
  let thinkingId = null;
  let lastConnectedSessionId = null;
  let toolStartTimes = new Map(); // toolName -> startTimestamp
  const TOOL_TIMEOUT_MS = 60000; // 60s timeout for any tool
  const toolTimers = createToolTimerRegistry(); // Wave 4 bugs 1+2: UI tickers + stuck-tool watchdogs
  const timedOutToolIds = new Set(); // cards failed by the watchdog — action_end must not double-decrement
  // Wave 4 bug 4: batched acks for backend-ledger events
  const ackBatcher = createAckBatcher((ids) => { if (sessionId) ackEvents(sessionId, ids); });
  let processedEventIds = new Set(); // v4.2: Track processed SSE event IDs to prevent duplicates
  let userMessageAdded = false; // v5.6-fix: Ensure user message is in store before assistant responses
  let streamingSafetyTimer = null; // v5.7-fix: Detect SSE inactivity (NOT thinking time)
  let currentMessageId = null; // v6.1-fix: Track current message ID to ignore stale SSE events
  let responseBuffer = ''; // v8.3-fix: Buffer response_delta to avoid showing raw JSON/tool blocks during streaming
  let showTyping = false; // v8.3-fix: Show typing indicator for INSTANT mode
  const SSE_INACTIVITY_MS = 600000; // v8.2-fix: 10 min — user explicitly wants to wait for long operations
  let flushedContentHashes = new Set(); // v9.1-fix: Track flushed content hashes to prevent duplicate assistant messages
  let pendingToolCount = 0; // v9.3-fix: Track only CURRENT turn's tools, not full history
  const progressBuffers = new Map(); // v9.5: tool -> { chunks[], raf } for rAF batching of action_progress
  // Wave 8: action_progress chunk ids already appended to a card. Survives
  // connectSSE (processedEventIds is cleared there) so a ledger replay-from-0
  // can't re-append the same chunks to the live tool output.
  const appliedChunkIds = new Set();
  let toolInstanceMap = new Map(); // backend toolInstanceId -> frontend message id
  // v13.0 (F2.3): confirmation state machine — once a toolId reaches COMPLETED
  // it can NEVER go back to CONFIRMATION_REQUIRED. Late/replayed
  // confirmation_required events for completed ids are rejected as stale
  // (this was the ghost Confirm/Cancel card after deleteFile + reconnect).
  let completedToolInstanceIds = new Set();
  let toolCardSeq = 0; // Wave 10 T1 (H3): collision-free tool card ids

  // v8.2-fix: User explicitly disabled inactivity timeout — he waits for long operations.
  // The timer is cleared but NEVER restarted, so SSE never aborts due to silence.
  function resetStreamingInactivityTimer() {
    if (streamingSafetyTimer) {
      clearTimeout(streamingSafetyTimer);
      streamingSafetyTimer = null;
    }
    // NOTE: setTimeout removed per user request. SSE stays alive indefinitely.
  }

  async function reconnectAndFetchPending() {
    if (!sessionId) return;
    try {
      console.log('[ChatArea] Reconnecting SSE to fetch pending messages...');
      await connectSSE();
    } catch (e) {
      console.error('[ChatArea] Reconnect failed:', e.message);
    }
  }

  function removeAllThinking(msgs) {
    return msgs.filter(m => m.type !== 'thinking');
  }

  // v12.2-fix: when the backend rejects the resolution (e.g. the pending
  // confirmation was lost in a server restart), mark the card locally —
  // otherwise the Confirm/Cancel buttons look dead and the card hangs forever.
  function markConfirmationExpired(confirmationId, errorMsg) {
    messages.update(msgs => msgs.map(m =>
      m.confirmationId === confirmationId
        ? {
            ...m,
            status: 'failed',
            confirmationId: undefined,
            confirmationMessage: undefined,
            result: {
              success: false,
              friendlyMessage: `${errorMsg || 'Confirmação expirada'} — a ação não foi executada. Peça à Luna para tentar de novo.`
            }
          }
        : m
    ));
  }

  // v3.3: resolve a destructive-operation confirmation from the UI
  async function handleConfirmTool(confirmationId) {
    if (!confirmationId || !sessionId) return;
    try {
      await confirmToolAction(sessionId, confirmationId, 'confirm');
    } catch (e) {
      console.error('[ChatArea] Confirm failed:', e.message);
      markConfirmationExpired(confirmationId, e.message);
    }
  }

  async function handleCancelTool(confirmationId) {
    if (!confirmationId || !sessionId) return;
    try {
      await confirmToolAction(sessionId, confirmationId, 'cancel');
      // v12.2-fix: instant local feedback for Cancel — don't wait for SSE.
      // Cancellation is a deliberate user choice, not an error: render the
      // card in the neutral 'cancelled' state, never red.
      messages.update(msgs => msgs.map(m =>
        m.confirmationId === confirmationId
          ? {
              ...m,
              status: 'cancelled',
              confirmationId: undefined,
              confirmationMessage: undefined,
              result: { success: true, cancelled: true, friendlyMessage: 'Operação cancelada pelo usuário.' }
            }
          : m
      ));
    } catch (e) {
      console.error('[ChatArea] Cancel failed:', e.message);
      markConfirmationExpired(confirmationId, e.message);
    }
  }

  // v8.3-fix: Flush accumulated response buffer, parsing out any complete JSON blocks.
  // Only creates/updates assistant bubble with CLEAN text (no raw tool JSON).
  function flushResponseBuffer(forceText = null) {
    const text = forceText !== null ? forceText : responseBuffer;
    if (!text || !text.trim()) return;

    // DIAGNOSTIC: Log input
    const inputHash = hashContent(text.trim());
    console.log(`[UI_RESPONSE_TRACE][INPUT] length=${text.length} hash=${inputHash} first100="${text.substring(0, 100)}" last100="${text.substring(text.length - 100)}"`);

    // v9.0-fix: Strip tool blocks using the same logic as AssistantMessage
    let cleanText = stripToolBlocksFromBuffer(text);
    
    // DIAGNOSTIC: Log after strip
    const afterStripHash = hashContent(cleanText.trim());
    console.log(`[UI_RESPONSE_TRACE][AFTER_STRIP] length=${cleanText.length} hash=${afterStripHash} first100="${cleanText.substring(0, 100)}" last100="${cleanText.substring(cleanText.length - 100)}"`);
    
    // v8.5-fix: removed aggressive meaningfulContent check that discarded short replies
    if (!cleanText || !cleanText.trim()) {
      if (forceText !== null) responseBuffer = '';
      console.log(`[UI_RESPONSE_TRACE][EMPTY_AFTER_STRIP] text was empty after strip`);
      return;
    }

    // v9.1-fix: Deduplicate by content hash — prevents duplicate messages from multiple SSE events
    // (response_delta + response_detected + done can all carry the same text)
    const contentHash = hashContent(cleanText.trim());
    
    // DIAGNOSTIC: Log before dedup
    console.log(`[UI_RESPONSE_TRACE][BEFORE_DEDUP] length=${cleanText.length} hash=${contentHash}`);
    
    if (flushedContentHashes.has(contentHash)) {
      console.log(`[UI_RESPONSE_TRACE][DEDUP] rejected reason=hash_already_exists hash=${contentHash}`);
      console.log('[flushResponseBuffer] Duplicate content hash detected, skipping');
      // Wave 1 Fix C1: content is already rendered — clear the buffer on the
      // delta path too, so a replayed prefix can't be re-appended by later deltas.
      responseBuffer = '';
      return;
    }
    // Also check if any recent assistant message has this exact content
    const msgs = get(messages);
    const recentAssistants = msgs.slice().reverse().filter(m => m.type === 'assistant').slice(0, 3);
    const isDuplicate = recentAssistants.some(m => {
      // v12.0-fix: only treat as duplicate WITHIN the same turn (messageId).
      // An identical reply in a NEW turn ("ok", "feito") is legitimate and
      // must render — the old content-only check silently skipped it.
      if (currentMessageId && m.messageId && m.messageId !== currentMessageId) return false;
      const existing = (m.content || '').trim();
      return existing === cleanText.trim() || existing.includes(cleanText.trim());
    });
    if (isDuplicate) {
      console.log(`[UI_RESPONSE_TRACE][DEDUP] rejected reason=content_already_exists hash=${contentHash}`);
      console.log('[flushResponseBuffer] Content already exists in recent assistant message, skipping');
      responseBuffer = ''; // Wave 1 Fix C1: same hardening as the hash guard above
      return;
    }

    console.log(`[UI_RESPONSE_TRACE][DEDUP] accepted hash=${contentHash}`);
    flushedContentHashes.add(contentHash);
    // v8.5-fix: Eviction when Set grows too large
    if (flushedContentHashes.size > 1000) {
      const iter = flushedContentHashes.values();
      flushedContentHashes.delete(iter.next().value);
    }

    // DIAGNOSTIC: Log message creation
    console.log(`[UI_RESPONSE_TRACE][MESSAGE_CREATE] length=${cleanText.length} hash=${contentHash} first100="${cleanText.substring(0, 100)}" last100="${cleanText.substring(cleanText.length - 100)}"`);

    if (!currentAssistantId) {
      currentAssistantId = 'resp-' + Date.now();
      messages.update(msgs => [...msgs, {
        id: currentAssistantId,
        type: 'assistant',
        content: cleanText,
        messageId: currentMessageId,
        timestamp: new Date().toISOString()
      }]);
    } else {
      // v9.3-fix: forceText means COMPLETE text (response_detected/done) — REPLACE.
      // No forceText means delta buffer flush — APPEND.
      if (forceText !== null) {
        messages.update(msgs =>
          msgs.map(m => m.id === currentAssistantId
            ? { ...m, content: cleanText }
            : m
          )
        );
      } else {
        messages.update(msgs =>
          msgs.map(m => m.id === currentAssistantId
            ? { ...m, content: (m.content || '') + cleanText }
            : m
          )
        );
      }
    }

    // Wave 1 Fix C1: clear the buffer after EVERY successful flush, not just
    // the forceText path. Previously each delta re-appended the ENTIRE
    // cumulative buffer (d1 + d1d2 + d1d2d3 — quadratic text duplication that
    // only settled when done replaced the content). Incomplete JSON blocks are
    // safe: the flush is gated by hasIncompleteJsonBlock at the call site, so
    // a partial tool block never reaches this point.
    responseBuffer = '';
  }

  // v9.2-fix: Detect incomplete JSON blocks to prevent leaking raw tool JSON
  // v8.5-fix: Only block if it looks like a Luna tool wrapper
  function hasIncompleteJsonBlock(text) {
    if (!text) return false;
    const hasToolMarker = text.includes('"tool"') || text.includes('"params"') || text.includes('"script"');
    if (!hasToolMarker) return false;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (!inString) {
        if (c === '{') depth++;
        else if (c === '}') depth--;
      }
    }
    return depth > 0;
  }

  // v9.1-fix: Simple content hash for deduplication
  function hashContent(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return String(hash);
  }

  // v9.0-fix: Reusable tool block stripper for buffer text
  function stripToolBlocksFromBuffer(text) {
    if (!text) return text;
    let cleaned = text;

    // Pass 1: JSON label + Copy + JSON block
    cleaned = cleaned.replace(/\bJSON\b\s*(?:Copy|复制|複製)?\s*\n\s*(\{[\s\S]*?(?:"tool"|"script")[\s\S]*?\})\s*\n?/gi, '');
    cleaned = cleaned.replace(/\bJSON\b\s*(?:Copy|复制|複製)?\s*\n?\s*(\{[\s\S]*?(?:"tool"|"script")[\s\S]*?\})\s*\n?/gi, '');

    // Pass 2: Code fences with tool JSON or script JSON
    cleaned = cleaned.replace(/```(?:json|javascript|js|text)?\s*\n?[\s\S]*?(?:"tool"|"script")[\s\S]*?\n?```/gi, '');

    // Pass 3: Inline JSON via brace counting — extract response wrappers, skip tool blocks
    let result = '';
    let i = 0;
    while (i < cleaned.length) {
      if (cleaned[i] === '{') {
        let depth = 1, j = i + 1;
        let inString = false, escape = false;
        while (j < cleaned.length && depth > 0) {
          const c = cleaned[j];
          if (escape) escape = false;
          else if (c === '\\') escape = true;
          else if (c === '"') inString = !inString;
          else if (!inString) { if (c === '{') depth++; else if (c === '}') depth--; }
          j++;
        }
        if (depth === 0) {
          const block = cleaned.slice(i, j);
          // Extract {"response": "..."} wrappers — keep the response text
          try {
            const parsed = JSON.parse(block);
            if (parsed.response !== undefined && typeof parsed.response === 'string') {
              result += parsed.response;
              i = j;
              continue;
            }
          } catch {
            // v9.3-fix: JSON.parse failed — try regex extraction for malformed response wrappers
            const respMatch = block.match(/"response"\s*:\s*"((?:\\.|[^"\\])*)"/);
            if (respMatch) {
              result += respMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
              i = j;
              continue;
            }
          }
          // Skip tool call JSON blocks and script JSON blocks
          if (/"tool"\s*:/.test(block) || /"script"\s*:/.test(block)) { i = j; continue; }
        }
      }
      result += cleaned[i];
      i++;
    }

    // Pass 4: Clean up orphaned labels
    result = result.replace(/\bCopy\b\s*(?:复制|複製)?\s*\n?/gi, '');
    result = result.replace(/\bJSON\b\s*\n?/gi, '');

    // Pass 5: Remove orphaned JSON punctuation (braces, brackets that leaked through)
    // Matches lines that are ONLY JSON punctuation characters
    result = result.replace(/^[\s]*[\}\]\)\,]+[\s]*$/gm, '');
    // Remove stray "}" or "]" at start/end of lines
    result = result.replace(/^[\s]*[\}\]\)]+/gm, '');
    result = result.replace(/[\{\[\(]+[\s]*$/gm, '');

    // v9.3-fix: Remove orphaned key-value fragments like "response": "..."} or "tool": "..."
    // v10.1-fix: ONLY remove if they look like trailing JSON fragments (with braces), not mid-sentence text
    result = result.replace(/"response"\s*:\s*"[^"]*"\s*\}[\s,]*$/gim, '');
    result = result.replace(/"tool"\s*:\s*"[^"]*"\s*,?[\s]*\}?[\s,]*$/gim, '');
    result = result.replace(/"script"\s*:\s*"[^"]*"\s*,?[\s]*\}?[\s,]*$/gim, '');

    // v9.5-fix: Remove inline JSON fragments that leaked through (e.g. tool params/snippets)
    // v10.1-fix: Only remove complete inline JSON blocks, not partial text
    result = result.replace(/"params"\s*:\s*\{[^{}]*"(?:command|path|script|code|query)"[^{}]*\}[\s,]*$/gim, '');
    // Matches trailing JSON fragments like: teShell", "params": {...}
    result = result.replace(/\w*"\s*,\s*"params"\s*:\s*\{[^{}]*\}[\s,]*$/gim, '');
    // Matches stray tool/script name fragments only at line end
    result = result.replace(/"(?:tool|script)"\s*:\s*"[^"]*"\s*,?\s*"?\w*"?\s*[:\{\}]?[\s,]*$/gim, '');

    result = result.replace(/\n{3,}/g, '\n\n');
    return result.trim();
  }

  // v9.5: rAF-batched progress chunk flushing — prevents UI freeze on fast streams
  // v8.5-fix: Use toolMsgId instead of tool name to avoid collision between same-type tools
  function flushProgressBuffer(toolMsgId) {
    const buf = progressBuffers.get(toolMsgId);
    if (!buf || buf.chunks.length === 0) return;
    const batch = buf.chunks.splice(0);
    buf.raf = null;
    messages.update(msgs => {
      const lastT = msgs.find(m => m.id === toolMsgId && m.type === 'tool');
      if (lastT) {
        return msgs.map(m =>
          m.id === lastT.id
            ? { ...m, liveOutput: (m.liveOutput || '') + batch.join('') }
            : m
        );
      }
      return msgs;
    });
  }
  function queueProgressChunk(toolMsgId, chunk) {
    let buf = progressBuffers.get(toolMsgId);
    if (!buf) {
      buf = { chunks: [], raf: null };
      progressBuffers.set(toolMsgId, buf);
    }
    buf.chunks.push(chunk);
    if (!buf.raf) {
      buf.raf = requestAnimationFrame(() => flushProgressBuffer(toolMsgId));
    }
  }

  let eventHashSeq = 0;
  function getEventHash(event) {
    // Wave 11-fix: dedup by backend event id when available. Every persisted event
    // has a unique id, so duplicates from reconnect replay collapse safely.
    // When no id is present (rare / synthetic events), fall back to a unique
    // timestamp+seq key so nothing is ever swallowed by content similarity.
    if (event && event.id) {
      return `${event.type || 'unknown'}:${event.id}`;
    }
    const type = event.type || 'unknown';
    const tool = event.tool || '';
    const paramsKey = event.params ? JSON.stringify(event.params).slice(0, 50) : '';
    const text = event.fullText || event.text || event.content || event.fullResponse || '';
    const resultText = event.result?.response || event.result?.content || '';
    return `${currentMessageId || ''}:${type}:${tool}:${paramsKey}:${text.slice(0, 50)}:${resultText.slice(0, 50)}:${++eventHashSeq}`;
  }

  function handleEvent(event) {
    if (!event) return;
    if (event.sessionId && event.sessionId !== sessionId) return;

    // Wave 4 bug 4: ack on RECEIPT (processed or deduped — both prove delivery).
    // Only backend ledger id shapes are acked; local synthetic ids are skipped.
    if (event.id && /^(ev|done|err)-\d/.test(event.id)) ackBatcher.push(event.id);

    // v8.5-fix: Ignore fallback polling events while actively streaming
    if (event.source === 'fallback' && $isStreaming) {
      return;
    }

    // v6.1-fix: If the event has a messageId that doesn't match the current message,
    // it's a stale event from a previous message — ignore it.
    if (event.messageId && currentMessageId && event.messageId !== currentMessageId) {
      return;
    }

    // v5.6-fix: Ignore response events until user message is confirmed in store
    const isResponseEvent = ['assistant', 'thinking', 'response_detected', 'partial', 'done', 'tool', 'action_start', 'action_end', 'action_progress'].includes(event.type);
    if (isResponseEvent && !userMessageAdded) {
      // v9.0-fix: Retry with exponential backoff, max 10 attempts
      event._retryCount = (event._retryCount || 0) + 1;
      if (event._retryCount <= 10) {
        setTimeout(() => handleEvent(event), 100 * event._retryCount);
      } else {
        console.warn('[SSE] Dropping event after 10 retries — user message never confirmed:', event.type);
      }
      return;
    }

    // v9.0-fix: Deduplicate by event hash — prevents duplicate rendering on reconnects
    // NOTE: For action_start/action_end, we use a unique id-based key instead of hash
    // to prevent deduplication of legit sequential tool calls of the same type.
    let dedupKey;
    if (event.type === 'action_start' || event.type === 'action_end' || event.type === 'action_progress') {
      // v10.0-fix: Remove Date.now() from dedupKey — it prevented deduplication entirely,
      // causing pendingToolCount to get stuck > 0 forever. The backend already generates
      // unique ids per event, so tool+id is sufficient.
      dedupKey = `tool:${event.type}:${event.tool || ''}:${event.id || ''}`;
    } else {
      dedupKey = getEventHash(event);
    }
    // DEBUG: temporarily disabled to verify thinking delivery
    // if (processedEventIds.has(dedupKey)) {
    //   return;
    // }
    // processedEventIds.add(dedupKey);
    // // Limit set size to prevent memory leaks — Wave 4: trim to 80% in one pass
    // evictOldestEntries(processedEventIds, 5000);

    // // v3.6-fix: Also deduplicate by backend event ID
    // if (event.id) {
    //   const exists = $messages.some(m => m.id === event.id);
    //   if (exists) return;
    // }


    const { type } = event;

    if (type.startsWith('plan')) {
      console.log('[PLAN UI] SSE event=', type, event, 'planModeState=', get(planModeState));
    }

    switch (type) {
      case 'user': {
        // v3.6-fix: Handle user messages from SSE history sync
        messages.update(msgs => {
          // Avoid duplicates by ID
          if (msgs.some(m => m.id === event.id)) return msgs;
          // v13.0 (F3.4): UUID dedup — the server echoes the clientId generated
          // in handleSend. Same clientId = same message, regardless of timing.
          if (event.clientId && msgs.some(m => m.clientId === event.clientId)) return msgs;
          // Fallback for old messages without clientId: content + 5s window
          const content = event.content || event.text || '';
          const recentDuplicate = msgs.some(m =>
            m.type === 'user' &&
            m.content === content &&
            Date.now() - new Date(m.timestamp).getTime() < 5000
          );
          if (recentDuplicate) return msgs;
          return [...msgs, {
            id: event.id || 'user-' + Date.now(),
            type: 'user',
            content: content,
            files: event.files || [],
            clientId: event.clientId || null,
            timestamp: event.timestamp || new Date().toISOString()
          }];
        });
        break;
      }
      case 'thinking_start': {
        playSound('thinkingStart');
        mascotState.set('thinking');
        mascotMessage.set('Hmm... deixa eu pensar...');
        // v11.8-fix: Each reasoning step gets its own persistent bubble. We do NOT
        // remove previous thinking bubbles; they stay in the chat like tool cards.
        // The user can collapse/expand them. Reset the active thinking id so deltas
        // target the newest reasoning step.
        thinkingId = 'thinking-' + Date.now();
        messages.update(msgs => [...msgs, {
          id: thinkingId,
          type: 'thinking',
          content: event.thinking || '',
          messageId: currentMessageId,
          timestamp: new Date().toISOString()
        }]);
        showTyping = false;
        break;
      }
      case 'thinking_delta': {
        // v10.8-fix: Accumulate thinking text in its own bubble.
        const delta = event.text || event.delta || '';
        if (!delta || !thinkingId) break;
        messages.update(msgs => msgs.map(m =>
          m.id === thinkingId
            ? { ...m, content: (m.content || '') + delta }
            : m
        ));
        break;
      }
      case 'thinking_update': {
        // v11.7-fix: Replace the whole thinking bubble with Kimi's current full
        // reasoning. The Kimi page is the source of truth; deltas can drift/cut.
        const fullText = event.fullText || '';
        console.log(`[ChatArea] thinking_update received: ${fullText.length} chars, thinkingId=${thinkingId}, currentMessageId=${currentMessageId}`);
        if (!fullText) break;
        if (!thinkingId) {
          thinkingId = 'thinking-' + Date.now();
          messages.update(msgs => [...msgs, {
            id: thinkingId,
            type: 'thinking',
            content: fullText,
            timestamp: new Date().toISOString()
          }]);
        } else {
          messages.update(msgs => msgs.map(m =>
            m.id === thinkingId
              // v11.9-fix: never shrink the thinking bubble. A collapsed container
              // or race may send a shorter text; we keep the largest reasoning seen.
              ? { ...m, content: fullText.length >= (m.content || '').length ? fullText : (m.content || '') }
              : m
          ));
        }
        break;
      }
      case 'response_delta': {
        playSound('messageReceived');
        const deltaText = event.text || '';
        // v7.0-fix: Don't process empty deltas.
        if (!deltaText) {
          break;
        }

        // v8.3-fix: Buffer response_delta instead of immediately rendering.
        // This prevents raw JSON/tool blocks from appearing during streaming.
        responseBuffer += deltaText;

        // v10.8-fix: Keep the thinking bubble while response tokens stream in;
        // it is removed only when a complete response is detected or the stream ends.
        showTyping = false;

        // v9.2-fix: Only flush if there's no incomplete JSON block in the buffer.
        // Flushing incomplete JSON causes raw tool JSON to leak into the chat.
        if (!hasIncompleteJsonBlock(responseBuffer)) {
          flushResponseBuffer();
        }
        break;
      }
      case 'response_detected': {
        // v8.3-fix: response_detected carries the FULL extracted response.
        // Add to buffer and flush immediately since this is a complete chunk.
        playSound('messageReceived');
        showTyping = false;
        // v10.8-fix: A complete response has been extracted, but the thinking bubble
        // is kept visible so the user can review the reasoning after the answer arrives.

        const newContent = event.text || event.response || '';
        if (!newContent || newContent.trim().length === 0) {
          console.warn('[ChatArea] response_detected with empty content — skipping, waiting for done');
          break;
        }

        // v9.0-fix: response_detected carries the FULL extracted response.
        // Flush it directly (force) instead of appending to buffer to avoid duplicates.
        flushResponseBuffer(newContent);
        break;
      }
      case 'action_start': {
        mascotState.set('working');
        mascotMessage.set(event.tool ? `Usando ${event.tool}...` : 'Trabalhando...');
        pendingToolCount++; // v9.3-fix
        // Wave 8: internal tools (meta.hidden in tool-registry.cjs → TOOL_HIDDEN)
        // execute normally but never render a card. Keep the pending count so
        // action_end balancing is unchanged; skip the card and the map.
        if (TOOL_HIDDEN[event.tool]) {
          // Wave 8 review: no card, but keep the watchdog safety net — a hidden
          // tool whose action_end never arrives (stream death) must still release
          // the input. Keyed by tool name (plan-mode events carry no
          // toolInstanceId; tools run sequentially); action_end stops it below.
          toolTimers.start('hidden:' + event.tool, {
            timeoutMs: TOOL_TIMEOUT_MS,
            onTimeout: (key) => {
              timedOutToolIds.add(key);
              pendingToolCount = Math.max(0, pendingToolCount - 1);
              if (pendingToolCount <= 0) {
                mascotState.set('idle');
                mascotMessage.set('O que mais posso fazer?');
                isStreaming.set(false);
              }
            },
          });
          break;
        }
        // Wave 10 T1: suppress duplicate tool cards.
        // H2: a cached-result replay (W6-T5) re-emits action_start with
        // cached:true and a fresh toolInstanceId — the original card already
        // covers that execution; the replayed action_end still delivers the
        // result. H4: never create a second card for a backendToolId that is
        // already rendered (duplicate detection / SSE ledger replay —
        // history-loaded cards carry backendToolId too).
        if (!shouldCreateToolCard(get(messages), event)) break;
        const toolId = makeToolCardId(++toolCardSeq);
        const backendToolId = event.toolInstanceId || event.id || ('tool-' + Date.now());
        toolInstanceMap.set(backendToolId, toolId);
        toolStartTimes.set(event.tool, Date.now());

        // v9.5-fix: Close the current assistant bubble before showing the tool card.
        // This ensures the NEXT assistant response starts as a NEW message below the tool,
        // instead of being appended to the previous assistant message.
        // Also remove the last assistant message if it only contains leaked tool JSON or is empty.
        messages.update(msgs => {
          if (msgs.length === 0) return msgs;
          const lastIdx = msgs.length - 1;
          const lastMsg = msgs[lastIdx];
          if (lastMsg && lastMsg.type === 'assistant') {
            const content = lastMsg.content || '';
            const stripped = stripToolBlocksFromBuffer(content);
            const hasToolJson = /"tool"\s*:/.test(content) || /"params"\s*:\s*\{/.test(content) || /"command"\s*:/.test(content);
            // Remove if it's raw JSON, empty after stripping, or very short (likely just a tool call)
            if (hasToolJson || !content.trim() || !stripped.trim() || stripped.trim().length < 10) {
              console.log('[action_start] Removing leaked/empty assistant message before tool card');
              return msgs.slice(0, -1);
            }
          }
          return msgs;
        });
        // CRITICAL: Reset assistant tracking so the next response becomes a NEW message
        currentAssistantId = null;
        responseBuffer = '';
        // v11.9-fix: NEVER freeze the active thinking bubble when a tool starts. The
        // extension/bridge keep emitting thinking_update for the current reasoning step,
        // and new reasoning steps emit thinking_start which creates a fresh bubble.

        messages.update(msgs => [...msgs, {
          id: toolId,
          type: 'tool',
          tool: event.tool,
          backendToolId,
          params: event.params || {},
          result: null,
          duration: 0,
          status: 'running', // v9.4-fix
          liveOutput: '',
          timestamp: new Date().toISOString()
        }]);
        
        // Wave 4 bugs 1+2: UI ticker + watchdog. If action_end never arrives the
        // card is marked failed instead of spinning "running" forever.
        toolTimers.start(toolId, {
          timeoutMs: TOOL_TIMEOUT_MS,
          onTick: (elapsedSec) => {
            const elapsed = elapsedSec.toFixed(1);
            mascotMessage.set(`${event.tool || 'Tool'}... ${elapsed}s`);
            messages.update(msgs => {
              const toolMsg = msgs.find(m => m.id === toolId);
              if (toolMsg && toolMsg.status === 'running') {
                return msgs.map(m => m.id === toolId ? { ...m, duration: parseFloat(elapsed) } : m);
              }
              return msgs;
            });
          },
          onTimeout: (timedOutToolId) => {
            timedOutToolIds.add(timedOutToolId);
            messages.update(msgs => msgs.map(m =>
              m.id === timedOutToolId && m.status === 'running'
                ? { ...m, status: 'failed', result: { success: false, error: `Tool expirou após ${TOOL_TIMEOUT_MS / 1000}s sem resposta do servidor.` } }
                : m
            ));
            pendingToolCount = Math.max(0, pendingToolCount - 1);
            if (pendingToolCount <= 0) {
              mascotState.set('idle');
              mascotMessage.set('O que mais posso fazer?');
              isStreaming.set(false);
            }
          },
        });
        break;
      }
      case 'confirmation_required': {
        mascotState.set('waiting');
        mascotMessage.set('Aguardando confirmação...');
        // v13.0 (F2.3): a toolId that already reached COMPLETED never goes back
        // to CONFIRMATION_REQUIRED — reject stale replays (ledger reconnect).
        const evToolId = event.toolInstanceId || event.id;
        if (evToolId && completedToolInstanceIds.has(evToolId)) {
          console.warn('[ChatArea] stale confirmation_required rejected (tool already completed):', evToolId);
          break;
        }
        const targetToolId = event.toolInstanceId ? toolInstanceMap.get(event.toolInstanceId) : null;
        if (targetToolId) {
          toolTimers.stop(targetToolId); // pause watchdog — confirmation has its own 5-min timeout
          messages.update(msgs => msgs.map(m =>
            m.id === targetToolId
              ? { ...m, status: 'awaiting_confirmation', confirmationId: event.confirmationId, confirmationMessage: event.message || '' }
              : m
          ));
        } else {
          // create a card for confirmations that arrive without a preceding action_start
          const toolId = makeToolCardId(++toolCardSeq);
          if (event.toolInstanceId) toolInstanceMap.set(event.toolInstanceId, toolId);
          messages.update(msgs => [...msgs, {
            id: toolId,
            type: 'tool',
            tool: event.tool,
            params: event.params || {},
            result: null,
            duration: 0,
            status: 'awaiting_confirmation',
            confirmationId: event.confirmationId,
            confirmationMessage: event.message || '',
            timestamp: new Date().toISOString()
          }]);
        }
        break;
      }
      case 'action_progress': {
        if (!event.chunk) break;
        // Wave 8: dedup by backend event id — on reconnect the ledger replays
        // already-rendered chunks (processedEventIds was cleared on reconnect),
        // which used to re-append them to the live tool output.
        if (event.id) {
          const chunkKey = `${sessionId || ''}:${event.id}`;
          if (appliedChunkIds.has(chunkKey)) break;
          appliedChunkIds.add(chunkKey);
          evictOldestEntries(appliedChunkIds, 5000);
        }
        const targetToolId = toolInstanceMap.get(event.toolInstanceId || event.id);
        if (targetToolId) {
          queueProgressChunk(targetToolId, event.chunk);
        }
        break;
      }
      case 'action_end': {
        playSound('toolComplete');
        // v9.4-fix: Stop real-time timer and get accurate duration
        // v8.5-fix: Use toolInstanceMap to match by backend toolInstanceId
        const msgs = get(messages);
        const targetToolId = toolInstanceMap.get(event.toolInstanceId || event.id);
        let lastTool = targetToolId ? msgs.find(m => m.id === targetToolId) : null;
        if (lastTool) {
          toolInstanceMap.delete(event.toolInstanceId || event.id);
          // v13.0 (F2.3): mark as COMPLETED — terminal state, no way back to
          // CONFIRMATION_REQUIRED (stale replay guard in the handler above).
          if (event.toolInstanceId || event.id) {
            completedToolInstanceIds.add(event.toolInstanceId || event.id);
            evictOldestEntries(completedToolInstanceIds, 500);
          }
        }
        // Fallback to old behavior if not found.
        // Wave 10 T1: never for cached replays — with the duplicate card
        // suppressed (H2), a name-based match would steal-fill the ORIGINAL
        // still-running card with the replayed result.
        if (!lastTool && event.cached !== true) {
          const toolMsgs = msgs.filter(m => m.type === 'tool' && m.tool === event.tool && !m.result);
          lastTool = toolMsgs[toolMsgs.length - 1];
        }
        let duration = 0;
        if (lastTool) {
          const elapsed = toolTimers.stop(lastTool.id); // cancels interval AND watchdog
          duration = elapsed !== null
            ? elapsed.toFixed(1)
            : (event.result?._meta?.duration ? (event.result._meta.duration / 1000).toFixed(1) : 0);
        }
        toolStartTimes.delete(event.tool);
        // v9.5: Flush any pending progress buffer immediately so final output is complete
        flushProgressBuffer(lastTool ? lastTool.id : event.tool);
        progressBuffers.delete(lastTool ? lastTool.id : event.tool);
        const isSuccess = event.result?.success !== false;
        messages.update(msgs => {
          // v10.24-fix: Update by matched toolInstanceId, not by tool name.
          const targetId = lastTool ? lastTool.id : null;
          if (targetId) {
            return msgs.map(m => {
              if (m.id !== targetId) return m;
              const updated = { ...m, result: event.result, duration: parseFloat(duration), status: isSuccess ? 'completed' : 'failed' };
              // v13.0 (F2.3): a resolved confirmation must drop its Confirm/Cancel
              // state on the live path too (only history-load did this before).
              delete updated.confirmationId;
              delete updated.confirmationMessage;
              return updated;
            });
          }
          return msgs;
        });
        
        // v9.3-fix: Decrement and check ONLY current turn's tools
        // Wave 4: a watchdog-timed-out card already decremented the count AND
        // already unlocked the input — a late action_end for it must not touch
        // streaming state at all (it could kill the user's NEXT turn mid-stream).
        // Wave 8 review: hidden tools carry no card — cancel their watchdog here
        // and mirror the timed-out guard so a late action_end cannot
        // double-decrement the count after the watchdog already fired.
        const hiddenTimerKey = 'hidden:' + event.tool;
        if (!lastTool) toolTimers.stop(hiddenTimerKey);
        const wasTimedOut = lastTool
          ? timedOutToolIds.delete(lastTool.id)
          : timedOutToolIds.delete(hiddenTimerKey);
        if (!wasTimedOut) {
          pendingToolCount = Math.max(0, pendingToolCount - 1);
          if (pendingToolCount <= 0) {
            mascotState.set('idle');
            mascotMessage.set('O que mais posso fazer?');
            isStreaming.set(false);
          } else {
            mascotMessage.set('Próxima tool...');
          }
        }
        break;
      }
      case 'response_done': {
        showTyping = false;
        // v8.3-fix: Flush any remaining buffer with the final response
        const finalText = event.response || event.text || '';
        if (finalText) {
          responseBuffer = finalText;
          flushResponseBuffer(finalText);
        }
        currentAssistantId = null;
        responseBuffer = '';
        // v10.28-fix: If a context-limit auto-compact happened mid-stream, the backend
        // may not emit compact_end. Ensure the compaction UI is released.
        compactState.set({ active: false, phase: 0, message: '', steps: [] });
        break;
      }
      // W10-T2: the frontend context_limit case was removed — dead code.
      // The soul consumes the bridge's context_limit event internally
      // (auto-compact + resend, see luna-soul.cjs processMessageStream) and
      // only re-emits system/compact_*/done events, never 'context_limit'.
      case 'done': {
        showTyping = false;
        // v10.8-fix: Keep the thinking bubble visible after the stream finishes.
        // The user explicitly wants to see the reasoning alongside the final answer.
        // v10.28-fix: Ensure compaction UI is released even if compact_end was missed.
        compactState.set({ active: false, phase: 0, message: '', steps: [] });
        const finalResponse = event.result?.response || event.response || event.text;

        // v8.5-fix: prevent duplicate final message if response_done already handled it
        // v10.16-fix: Also check for existing assistant message with same messageId
        const msgs = get(messages);
        const alreadyHasDone = msgs.some(m =>
          m.messageId === (event.messageId || currentMessageId) && (m.type === 'done' || m.type === 'assistant')
        );

        // v10.25-fix: Always finalize streaming, even if we skip creating a duplicate message.
        // A 'done' event must release the input, regardless of whether its text was already rendered.
        // v10.35-fix: If the existing assistant bubble contains leaked wrapper fragments,
        // replace it with the clean finalResponse from the backend.
        const targetMsgId = currentAssistantId || msgs.findLast(m =>
          m.type === 'assistant' && m.messageId === (event.messageId || currentMessageId)
        )?.id;
        const existingMsg = targetMsgId ? msgs.find(m => m.id === targetMsgId) : null;
        const existingContent = (existingMsg?.content || '').trim();
        const needsReplace = finalResponse && existingContent && existingContent !== finalResponse.trim();

        if (alreadyHasDone && !needsReplace) {
          // v10.25-fix: text already rendered — skip duplicate message; input is still released below
        } else {
          if (needsReplace && targetMsgId) {
            messages.update(msgs =>
              msgs.map(m => m.id === targetMsgId ? { ...m, content: finalResponse } : m)
            );
          } else if (finalResponse && currentAssistantId) {
            responseBuffer = finalResponse;
            flushResponseBuffer(finalResponse);
          } else if (finalResponse && !currentAssistantId) {
            // v9.4-fix: If response_done reset currentAssistantId but we still have
            // a final response (e.g., no tools were used), create a new assistant message.
            responseBuffer = finalResponse;
            flushResponseBuffer(finalResponse);
          }
        }

        // v9.3-fix: Use pendingToolCount (current turn only) instead of scanning full history
        // v8.5-fix: safety timeout for stuck tools
        const toolStuckTimeout = 300000; // 5 min
        if (pendingToolCount > 0) {
          const stuckTool = Array.from(toolStartTimes.values()).some(startTime => (Date.now() - startTime) > toolStuckTimeout);
          if (stuckTool) {
            console.warn('[done] Tools stuck for >5min — forcing pendingToolCount = 0');
            pendingToolCount = 0;
          } else {
            mascotState.set('working');
            mascotMessage.set('Finalizando tools...');
          }
        }
        if (pendingToolCount <= 0) {
          isStreaming.set(false);
          mascotState.set('idle');
          mascotMessage.set('O que mais posso fazer?');
        } else {
          // v10.36-fix: Some backends never emit action_end for the final tool.
          // Release the input after a short grace period so the user isn't stuck.
          setTimeout(() => {
            if (get(isStreaming)) {
              console.warn('[done] Releasing input after grace period — pendingToolCount still', pendingToolCount);
              isStreaming.set(false);
              mascotState.set('idle');
              mascotMessage.set('O que mais posso fazer?');
              pendingToolCount = 0;
            }
          }, 3000);
        }
        currentAssistantId = null;
        responseBuffer = '';
        break;
      }
      case 'login_required': {
        playSound('error');
        mascotState.set('idle');
        mascotMessage.set('Precisa fazer login primeiro!');
        messages.update(msgs => removeAllThinking(msgs));
        thinkingId = null;
        messages.update(msgs => [...msgs, {
          id: 'login-' + Date.now(),
          type: 'login_required',
          content: event.message || 'Você precisa logar primeiro no Kimi Web.',
          timestamp: new Date().toISOString()
        }]);
        isStreaming.set(false);
        break;
      }
      case 'error': {
        playSound('error');
        mascotState.set('idle');
        mascotMessage.set('Ops, algo deu errado...');
        messages.update(msgs => removeAllThinking(msgs));
        thinkingId = null;
        messages.update(msgs => [...msgs, {
          id: 'err-' + Date.now(),
          type: 'error',
          content: event.error || event.message || event.text || 'Erro desconhecido',
          timestamp: new Date().toISOString()
        }]);
        isStreaming.set(false);
        // Wave 7 review: a plan-mode investigation that dies with an error event
        // must release planModeState — otherwise it stays 'processing' forever and
        // the next user message hits the duplicate guard and is silently dropped.
        if ($planModeState.status === 'processing') {
          planModeState.update(s => ({ ...s, active: false, status: 'idle', plan: null, planPath: null }));
        }
        // v10.28-fix: A compaction may have failed and emitted error instead of compact_error.
        compactState.set({ active: false, phase: 0, message: '', steps: [] });
        break;
      }
      case 'warning':
      case 'system': {
        messages.update(msgs => [...msgs, {
          id: (type === 'warning' ? 'warn-' : 'sys-') + Date.now(),
          type: 'system',
          content: event.message || '',
          timestamp: new Date().toISOString()
        }]);
        break;
      }
      case 'mode_detected': {
        if (event.mode) currentMode.set(event.mode);
        break;
      }
      case 'compact_start': {
        compactState.set({
          active: true,
          phase: 0,
          message: event.message || 'Compactando contexto...',
          steps: [event.message || 'Compactando contexto...']
        });
        // Also add a persistent system message
        messages.update(msgs => [...msgs, {
          id: 'compact-start-' + Date.now(),
          type: 'system',
          content: event.message || 'Compactando contexto...',
          timestamp: new Date().toISOString()
        }]);
        break;
      }
      case 'compact_progress': {
        compactState.update(s => ({
          ...s,
          active: true,
          phase: (s.phase + 1) % 8,
          message: event.message || s.message,
          steps: [...s.steps, event.message || '...']
        }));
        break;
      }
      case 'compact_end': {
        compactState.set({ active: false, phase: 0, message: '', steps: [] });
        messages.update(msgs => [...msgs, {
          id: 'compact-end-' + Date.now(),
          type: 'system',
          content: event.message || 'Contexto compactado',
          timestamp: new Date().toISOString()
        }]);
        break;
      }
      case 'compact_error': {
        compactState.set({ active: false, phase: 0, message: '', steps: [] });
        messages.update(msgs => [...msgs, {
          id: 'compact-err-' + Date.now(),
          type: 'error',
          content: event.message || 'Erro na compactação',
          timestamp: new Date().toISOString()
        }]);
        break;
      }
      case 'plan_error':
      case 'plan_complete': {
        // Wave 7 review: plan_error means the investigation died before producing
        // a plan (cancel/bridge failure) — release planModeState so the chat does
        // not stay locked in 'processing' (silent message drop).
        if (type === 'plan_error' && $planModeState.status === 'processing') {
          planModeState.update(s => ({ ...s, active: false, status: 'idle', plan: null, planPath: null }));
        }
        messages.update(msgs => [...msgs, {
          id: 'plan-' + Date.now(),
          type: 'system',
          content: event.error || event.message || event.text || `${type}`,
          timestamp: new Date().toISOString()
        }]);
        break;
      }
      case 'plan_start': {
        // v10.13-fix: Don't activate planModeState from SSE events — only user can toggle plan mode.
        // This prevents the agent's auto-detected PLAN mode from locking the chat input.
        showTyping = false;
        messages.update(msgs => [...msgs, {
          id: 'plan-start-' + Date.now(),
          type: 'system',
          content: event.message || 'Modo Detetive ativado',
          timestamp: new Date().toISOString()
        }]);
        break;
      }
      case 'plan_delta': {
        // Plan text streaming — update or create plan message
        messages.update(msgs => {
          const lastPlan = msgs.findLast(m => m.type === 'plan');
          if (lastPlan && !lastPlan.isComplete) {
            return msgs.map(m => m.id === lastPlan.id ? { ...m, content: (m.content || '') + (event.text || '') } : m);
          }
          return [...msgs, {
            id: 'plan-delta-' + Date.now(),
            type: 'plan',
            content: event.text || '',
            isComplete: false,
            timestamp: new Date().toISOString()
          }];
        });
        break;
      }
      case 'plan_display': {
        isStreaming.set(false);
        showTyping = false;
        messages.update(msgs => {
          // Remove incomplete plan deltas
          const cleaned = msgs.filter(m => !(m.type === 'plan' && !m.isComplete));
          return [
            // Wave 8: only the newest plan card may offer actions — an earlier
            // awaiting card loses its buttons once a new plan card arrives.
            ...cleaned.map(m =>
              m.type === 'plan' && m.status === 'awaiting_approval' ? { ...m, status: 'revised' } : m
            ),
            {
            id: 'plan-' + Date.now(),
            type: 'plan',
            content: event.plan || '(plano vazio)',
            planPath: event.planPath,
            isComplete: true,
            status: 'awaiting_approval',
            timestamp: new Date().toISOString()
          }];
        });
        break;
      }
      case 'plan_awaiting_approval': {
        isStreaming.set(false);
        showTyping = false;
        planModeState.update(s => ({
          ...s,
          active: true,
          status: 'awaiting_approval',
          plan: event.plan || null,
          planPath: event.planPath || null,
          sessionId: event.sessionId || s.sessionId
        }));
        break;
      }
      case 'plan_approved': {
        // Only deactivate if user had manually activated plan mode
        if ($planModeState.active) {
          planModeState.update(s => ({ ...s, active: false, status: 'idle', plan: null, planPath: null }));
        }
        messages.update(msgs => msgs.map(m =>
          m.type === 'plan' ? { ...m, status: 'approved' } : m
        ));
        messages.update(msgs => [...msgs, {
          id: 'plan-approved-' + Date.now(),
          type: 'system',
          content: 'Plano aprovado! Iniciando execução...',
          timestamp: new Date().toISOString()
        }]);
        break;
      }
      case 'plan_rejected': {
        // Only deactivate if user had manually activated plan mode
        if ($planModeState.active) {
          planModeState.update(s => ({ ...s, active: false, status: 'idle', plan: null, planPath: null }));
        }
        messages.update(msgs => msgs.map(m =>
          m.type === 'plan' ? { ...m, status: 'rejected' } : m
        ));
        messages.update(msgs => [...msgs, {
          id: 'plan-rejected-' + Date.now(),
          type: 'system',
          content: 'Plano rejeitado. Investigação encerrada.',
          timestamp: new Date().toISOString()
        }]);
        break;
      }
      case 'plan_revised': {
        messages.update(msgs => [
          // Wave 8: only the newest plan card may offer actions — the revised
          // card supersedes every earlier awaiting card.
          ...msgs.map(m =>
            m.type === 'plan' && m.status === 'awaiting_approval' ? { ...m, status: 'revised' } : m
          ),
          {
          id: 'plan-revised-' + Date.now(),
          type: 'plan',
          content: event.plan || '',
          planPath: event.planPath,
          isComplete: true,
          status: 'awaiting_approval',
          timestamp: new Date().toISOString()
        }]);
        break;
      }
    }
  }

  async function connectSSE() {
    if (!sessionId) return;
    // NAO reconecta se ja esta conectado na mesma sessao
    if (lastConnectedSessionId === sessionId && sseManager.eventSource) return;

    // v10.16-fix: If streaming in another session, cancel it first so we can switch
    if ($isStreaming && lastConnectedSessionId && lastConnectedSessionId !== sessionId) {
      console.log(`[connectSSE] Cancelling stream in ${lastConnectedSessionId} before switching to ${sessionId}`);
      // Wave 4 review follow-up: drop pending acks BEFORE the await — a batch
      // timer firing mid-await would flush the old session's ids into the new one.
      ackBatcher.reset();
      await cancelStream(lastConnectedSessionId);
      isStreaming.set(false);
    }
    // v4.0-fix: If still streaming in SAME session, skip to avoid overwriting current state
    if ($isStreaming && lastConnectedSessionId === sessionId) {
      console.log('[connectSSE] Skipping history reload while streaming is active in same session');
      return;
    }

    currentAssistantId = null;
    thinkingId = null;
    responseBuffer = ''; // v9.5-fix: Clear buffer on session switch/reconnect
    processedEventIds.clear(); // v4.2: Clear dedup set on reconnect
    ackBatcher.reset(); // pending ids belong to the previous connection's session
    // v10.16-fix: Clear cross-session state to prevent stale tool/ACK bleeds
    currentMessageId = null;
    userMessageAdded = false;
    showTyping = false;
    pendingToolCount = 0;
    // v10.24-fix: Do NOT clear toolInstanceMap here. If action_end arrives after
    // a reconnect, we still need the mapping. It is cleaned by action_end.
    toolStartTimes = new Map();
    toolTimers.clearAll(); // Wave 4 bug 2: cancel intervals AND watchdogs from the previous connection
    timedOutToolIds.clear();
    progressBuffers.clear();
    flushedContentHashes.clear();
    // Wave 4 bug 3: reuse the manager — disconnect() now cancels every pending
    // timer, so discarding the instance (which orphaned its backoff timer) is
    // no longer needed and would reintroduce the zombie.
    sseManager.disconnect();

    // v3.6-fix: Load full message history from backend instead of clearing
    try {
      const history = await fetchSessionMessages(sessionId);
      if (history.ok && history.messages) {
        const loaded = [];
        let currentAssistantContent = '';
        for (const msg of history.messages) {
          if (msg.role === 'user') {
            loaded.push({
              id: msg.id || 'msg-' + Math.random().toString(36).slice(2),
              type: 'user',
              content: msg.content || '',
              files: msg.files || [],
              timestamp: msg.timestamp || new Date().toISOString(),
            });
          } else if (msg.type === 'thinking_start' || msg.type === 'thinking_delta') {
            // v8.5-fix: Ignore thinking events in history load
            continue;
          } else if (msg.type === 'thinking_update' && msg.content) {
            // v11.10-fix: Restore the latest reasoning snapshot on reconnect so the
            // thinking bubble survives page reloads and SSE reconnects.
            const existingIdx = loaded.findLastIndex(m => m.type === 'thinking' && m.messageId === msg.messageId);
            if (existingIdx >= 0) {
              loaded[existingIdx] = {
                ...loaded[existingIdx],
                content: msg.content,
                timestamp: msg.timestamp || new Date().toISOString(),
              };
            } else {
              loaded.push({
                id: msg.id || 'thinking-' + Math.random().toString(36).slice(2),
                type: 'thinking',
                content: msg.content,
                messageId: msg.messageId,
                timestamp: msg.timestamp || new Date().toISOString(),
              });
            }
            continue;
          } else if (msg.type === 'response_delta' && msg.content) {
            currentAssistantContent = msg.content;
          } else if (msg.type === 'done') {
            const finalText = msg.result?.response || msg.content || currentAssistantContent || '';
            if (finalText) {
              loaded.push({
                id: msg.id || 'resp-' + Math.random().toString(36).slice(2),
                type: 'assistant',
                content: finalText,
                timestamp: msg.timestamp || new Date().toISOString(),
              });
            }
            currentAssistantContent = '';
          } else if (msg.type === 'error') {
            loaded.push({
              id: msg.id || 'err-' + Math.random().toString(36).slice(2),
              type: 'error',
              content: msg.content || 'Erro desconhecido',
              timestamp: msg.timestamp || new Date().toISOString(),
            });
          } else if (msg.type === 'action_start' && msg.tool) {
            // Wave 8 review: hidden tools never render cards — not from history
            // either (session switch / reload replays persisted action_start).
            if (TOOL_HIDDEN[msg.tool]) continue;
            loaded.push({
              id: msg.id || 'tool-' + Math.random().toString(36).slice(2),
              type: 'tool',
              tool: msg.tool,
              // Wave 10 T1 (H4): persisted action_start carries toolInstanceId
              // (luna-chat-routes.js); without it, a live SSE ledger replay of
              // the same event would pass the backendToolId dedup and render a
              // duplicate card next to this history-loaded one.
              backendToolId: msg.toolInstanceId || msg.id,
              params: msg.params || {},
              result: null,
              timestamp: msg.timestamp || new Date().toISOString(),
            });
          } else if (msg.type === 'confirmation_required' && msg.confirmationId) {
            // v12.0-fix: restore a pending confirmation after reload/reconnect —
            // the backend promise waits indefinitely, so the card must survive F5.
            if (msg.tool && TOOL_HIDDEN[msg.tool]) continue;
            const pendingTool = msg.toolInstanceId
              ? loaded.slice().reverse().find(m => m.type === 'tool' && m.backendToolId === msg.toolInstanceId && !m.result)
              : null;
            if (pendingTool) {
              pendingTool.status = 'awaiting_confirmation';
              pendingTool.confirmationId = msg.confirmationId;
              pendingTool.confirmationMessage = msg.content || '';
            } else {
              loaded.push({
                id: msg.id || 'tool-' + Math.random().toString(36).slice(2),
                type: 'tool',
                tool: msg.tool,
                backendToolId: msg.toolInstanceId || msg.id,
                params: msg.params || {},
                result: null,
                status: 'awaiting_confirmation',
                confirmationId: msg.confirmationId,
                confirmationMessage: msg.content || '',
                timestamp: msg.timestamp || new Date().toISOString(),
              });
            }
          } else if (msg.type === 'action_end' && msg.result) {
            // Wave 8 review: skip hidden ends too — with their starts skipped,
            // a hidden end would steal-fill the last visible unresolved card.
            if (TOOL_HIDDEN[msg.tool]) continue;
            const lastTool = loaded.slice().reverse().find(m => m.type === 'tool' && !m.result);
            if (lastTool) {
              lastTool.result = msg.result;
              // v12.0-fix: a resolved confirmation must not keep the Confirm/Cancel UI
              lastTool.status = msg.result.success !== false ? 'completed' : 'failed';
              delete lastTool.confirmationId;
              delete lastTool.confirmationMessage;
            }
          }
        }
        // v4.0-fix: Sort by timestamp to ensure chronological order
        loaded.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        messages.set(loaded);
      } else {
        messages.set([]);
      }
    } catch (e) {
      console.error('Failed to load session history:', e);
      messages.set([]);
    }

    sseManager.connect(sessionId, handleEvent);
    lastConnectedSessionId = sessionId;
    // v5.2: Start heartbeat to keep agent page alive
    startHeartbeat('web-' + sessionId, 30000);
  }

  // v10.33: /refresh with real diagnostics + targeted self-heal.
  // The old handler only cleared frontend state and CLAIMED "SSE reconectado"
  // — but connectSSE() early-returns when already connected to the same
  // session, so nothing was reconnected and no server-side problem (bridge
  // down, soul stuck, service dead) was ever detected or repaired.
  // New flow: diagnose → repair what's broken (pm2 selfheal) → force-reconnect
  // → report. Last resort when the API itself is unreachable: page reload.
  async function runAgentRefresh({ resume }) {
    // 1) clear frontend streaming state
    isStreaming.set(false);
    currentAssistantId = null;
    thinkingId = null;
    responseBuffer = '';
    pendingToolCount = 0;
    processedEventIds.clear();
    flushedContentHashes.clear();

    const diagId = 'sys-' + Date.now();
    const setDiag = (content) => {
      messages.update(msgs => {
        const i = msgs.findIndex(m => m.id === diagId);
        if (i === -1) return [...msgs, { id: diagId, type: 'system', content, timestamp: new Date().toISOString() }];
        const copy = msgs.slice();
        copy[i] = { ...copy[i], content };
        return copy;
      });
    };
    setDiag('Diagnosticando conexões (servidor, Soul, Bridge)…');

    // 2) diagnose backend health
    let health = null;
    try { health = await systemHealth(); } catch { health = null; }

    if (!health || !health.status) {
      setDiag('Servidor Luna (API) não responde.\nA página será recarregada em 10s para reconectar tudo…');
      setTimeout(() => window.location.reload(), 10000);
      return;
    }

    // 3) map problems → services to restart (bridge/soul live inside luna-server)
    const st = health.status || {};
    const broken = [];
    const services = [];
    const soulReady = health.lunaSoulReady || st['luna-soul']?.status === 'ready';
    if (!soulReady) { broken.push('Luna Soul não está pronta'); services.push('luna-server'); }
    if (st['kimi-bridge']?.status !== 'connected') { broken.push('Kimi Bridge desconectado'); services.push('luna-server'); }
    if (st['nexo-dashboard'] && st['nexo-dashboard'].status !== 'running') { broken.push('Dashboard (porta 3456) parado'); services.push('nexo-dashboard'); }
    if (st['luna-web-vite'] && st['luna-web-vite'].status !== 'running') { broken.push('Vite (porta 5173) parado'); services.push('luna-vite'); }
    if (st['telegram-bot'] && st['telegram-bot'].status !== 'running') { broken.push('Bot do Telegram parado'); services.push('telegram-bot'); }

    const forceReconnect = async () => {
      // connectSSE() early-returns if eventSource still exists for this
      // session — disconnect first so the reconnect actually happens.
      try { sseManager.disconnect(); } catch { /* ignore */ }
      try { await connectSSE(); } catch { /* ignore */ }
    };

    if (broken.length > 0) {
      setDiag(`Problemas detectados:\n${broken.map(b => '• ' + b).join('\n')}\nReiniciando serviços afetados...`);
      try {
        await selfhealServices([...new Set(services)]);
      } catch { /* the server may restart itself mid-call — expected */ }

      // 4) poll until healthy again (luna-server dies during its own restart)
      let recovered = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000));
        try {
          const h = await systemHealth();
          const s = h?.status || {};
          const okSoul = h?.lunaSoulReady || s['luna-soul']?.status === 'ready';
          const okBridge = s['kimi-bridge']?.status === 'connected';
          if (h && okSoul && okBridge) { recovered = true; break; }
        } catch { /* still restarting */ }
      }

      await forceReconnect();

      if (!recovered) {
        setDiag('Reinício solicitado, mas a saúde ainda não estabilizou.\nA página será recarregada em 10s para uma reconexão limpa…');
        setTimeout(() => window.location.reload(), 10000);
        return;
      }
      setDiag(`Recuperado — Soul pronta e Bridge conectado.\nServiços reiniciados: ${[...new Set(services)].join(', ')}. SSE reconectado.`);
    } else {
      await forceReconnect();
      setDiag('Tudo saudável — Soul pronta, Bridge conectado.\nEstado limpo e SSE reconectado à força.');
    }

    // 5) fullRefresh: resume pending work from history
    if (resume && activeSessionId) {
      try {
        await sendMessage('Continue de onde parou. Leia o historico e execute a proxima acao pendente.', activeSessionId, $currentMode, [], null, sessionProvider);
        await connectSSE();
      } catch (e) {
        console.error('[fullRefresh] Failed to send continuation:', e);
      }
    }
  }

  // v10.32-fix: Sync currentProvider with the selected session's provider so the header
  // and sendMessage use the correct provider (Kimi/DeepSeek/etc).
  $: rawSessionProvider = $sessions.find(s => s.id === sessionId)?.provider;
  $: sessionProvider = (typeof rawSessionProvider === 'string' ? rawSessionProvider : null)
    || (typeof $currentProvider === 'string' ? $currentProvider : null)
    || 'kimi';
  $: if (sessionId && sessionProvider && sessionProvider !== $currentProvider) {
    currentProvider.set(sessionProvider);
  }

  $: if (sessionId && sessionId !== lastConnectedSessionId) {
    // Wave 7 review: plan-mode state belongs to the session where the plan
    // started — without this reset, planModeState.active leaked across sessions
    // and a normal message typed in ANOTHER session was hijacked into a new
    // plan investigation (handleSend's $planModeState.active branch).
    if ($planModeState.active && $planModeState.sessionId && $planModeState.sessionId !== sessionId) {
      planModeState.set({ active: false, status: 'idle', plan: null, planPath: null, sessionId: null });
    }
    connectSSE();
  }

  onMount(() => {
    if (sessionId && sessionId !== lastConnectedSessionId) {
      connectSSE();
    }
  });

  async function handleSend(msg, files) {
    if (!msg.trim()) return;

    // v6.1-fix: Abort any active stream from a previous message before starting
    // a new one. This prevents stale SSE events from the previous message
    // from being processed as part of the new message.
    if ($isStreaming && sessionId) {
      console.log('[handleSend] Aborting previous stream before sending new message');
      await cancelStream(sessionId);
      isStreaming.set(false); // v12.0-fix: reflect the abort locally so connectSSE below isn't skipped
    }

    // v12.0-fix: open the SSE connection BEFORE the POST (see the sendMessage
    // call at the end of this function). The old order (POST → connectSSE)
    // left a window between the POST response and the new SSE's lastMsgIndex
    // snapshot in which events — including 'done' — were appended to the
    // session but never delivered live nor rendered by the history reload:
    // the reply only showed up one message later. Must run BEFORE
    // currentMessageId is assigned (connectSSE resets it) and BEFORE the
    // optimistic user bubble (connectSSE reloads history).
    if (sessionId && !isSlashCommand(msg) && !$planModeState.active) {
      await connectSSE();
    }

    // v6.1-fix: Generate a new message ID for this message. If the backend
    // sends messageId in SSE events, we can validate against it.
    currentMessageId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

    // v5.6-fix: Reset user message tracking for new message
    userMessageAdded = false;

    // v6.0-fix: DO NOT clear processedEventIds — it breaks deduplication of
    // delayed SSE events from the previous message. When a 'done' or
    // 'response_detected' event from msg N-1 arrives after handleSend() was
    // called for msg N, clearing the set allows it to be processed as new,
    // causing the previous response to be "pasted" into the chat again.
    // processedEventIds.clear(); ← REMOVED

    // v9.1-fix: Clear flushed content hashes for new message to allow fresh responses
    flushedContentHashes.clear();

    // v3.7-fix: Auto-create session if none exists
    let activeSessionId = sessionId;
    if (!activeSessionId) {
      try {
        const res = await sessionAction('create', null, msg.slice(0, 40));
        if (res.ok && res.session) {
          activeSessionId = res.session.id;
          // v3.7-fix: Update stores so the session appears in sidebar immediately
          const newSession = { ...res.session, updatedAt: new Date().toISOString() };
          sessions.update(s => [newSession, ...s]);
          currentSessionId.set(res.session.id);
        } else {
          messages.update(msgs => [...msgs, {
            id: 'err-' + Date.now(),
            type: 'error',
            content: 'Falha ao criar sessão',
            timestamp: new Date().toISOString()
          }]);
          return;
        }
      } catch (e) {
        console.error('Create session error:', e);
        messages.update(msgs => [...msgs, {
          id: 'err-' + Date.now(),
          type: 'error',
          content: 'Falha ao criar sessão: ' + e.message,
          timestamp: new Date().toISOString()
        }]);
        return;
      }
    }

    // v3.6-fix: Reset assistant tracking before sending new message
    // v9.5-fix: Also reset responseBuffer to prevent new responses from appending to old ones
    currentAssistantId = null;
    thinkingId = null;
    responseBuffer = '';

    // v11.8-fix: Do NOT remove previous thinking bubbles — the user wants to keep
    // reasoning history visible, just like tool cards. Only reset the active
    // thinking id so the next thinking_start creates a fresh bubble.

    // v8.5-fix: Unify feedback for all modes — always use typing indicator
    showTyping = true;

    const userMsg = {
      id: 'user-' + Date.now(),
      type: 'user',
      content: msg,
      files: files || [],
      clientId: currentMessageId, // v13.0 (F3.4): UUID dedup against the server echo
      timestamp: new Date().toISOString()
    };
    messages.update(msgs => [...msgs, userMsg]);
    userMessageAdded = true;
    await tick(); // Ensure user message is rendered before processing response events
    isStreaming.set(true);
    mascotState.set('thinking');
    mascotMessage.set('Hmm... deixa eu pensar...');

    try {
      playSound('messageSent');

      // v5.0: Slash commands — ALL messages starting with / go to Luna directly, NOT Kimi
      if (isSlashCommand(msg)) {
        const cmd = msg.split(' ')[0];
        const args = msg.split(' ').slice(1);
        const slashDef = SLASH_COMMANDS.find(c => c.cmd === cmd);

        if (!slashDef) {
          isStreaming.set(false);
          messages.update(msgs => [...msgs, {
            id: 'sys-' + Date.now(),
            type: 'system',
            content: `Comando desconhecido: ${cmd}. Digite / para ver os comandos disponiveis.`,
            timestamp: new Date().toISOString()
          }]);
          return;
        }

        let result = null;

        // System handlers (frontend APIs)
        if (['systemRestart', 'systemStatus', 'systemStop', 'systemStart', 'systemHealth', 'systemLogs', 'turnOffAgent', 'refreshAgent', 'fullRefreshAgent', 'agentStatus', 'setVisibleMode', 'setInvisibleMode'].includes(slashDef.handler)) {
          switch (slashDef.handler) {
            case 'systemRestart': result = await systemRestart(); break;
            case 'systemStatus': result = await systemStatus(); break;
            case 'systemStop': result = await systemStop(); break;
            case 'systemStart': result = await systemStart(); break;
            case 'systemHealth': result = await systemHealth(); break;
            case 'systemLogs': result = await systemLogs(); break;
            case 'agentStatus': {
              result = await agentStatus();
              if (result.ok && result.agent) {
                const a = result.agent;
                const statusEmoji = a.state === 'online' ? 'online' : a.state === 'degraded' ? 'degradado' : a.state === 'starting' ? 'iniciando' : 'offline';
                messages.update(msgs => [...msgs, {
                  id: 'sys-' + Date.now(),
                  type: 'system',
                  content: `${statusEmoji} Status do Agente\n\n• Estado: ${a.state}\n• Luna Soul: ${a.lunaSoul}\n• Kimi Bridge: ${a.bridge}\n• Servidor: ${a.server}\n• Paginas ativas: ${a.pages}`,
                  timestamp: new Date().toISOString()
                }]);
              } else {
                messages.update(msgs => [...msgs, {
                  id: 'sys-' + Date.now(),
                  type: 'system',
                  content: 'Não foi possível obter o status do agente.',
                  timestamp: new Date().toISOString()
                }]);
              }
              isStreaming.set(false);
              return;
            }
            case 'setVisibleMode': {
              result = await setVisibleMode(true);
              messages.update(msgs => [...msgs, {
                id: 'sys-' + Date.now(),
                type: 'system',
                content: result.ok ? result.message : 'Erro: ' + result.error,
                timestamp: new Date().toISOString()
              }]);
              isStreaming.set(false);
              return;
            }
            case 'setInvisibleMode': {
              result = await setVisibleMode(false);
              messages.update(msgs => [...msgs, {
                id: 'sys-' + Date.now(),
                type: 'system',
                content: result.ok ? result.message : 'Erro: ' + result.error,
                timestamp: new Date().toISOString()
              }]);
              isStreaming.set(false);
              return;
            }
            case 'turnOffAgent':
              result = await turnOffAgent('web-' + sessionId);
              mascotState.set('sleep');
              mascotMessage.set('Luna dormindo. Envie uma mensagem para acordar.');
              break;
            case 'refreshAgent': {
              await runAgentRefresh({ resume: false });
              return;
            }
            case 'fullRefreshAgent': {
              await runAgentRefresh({ resume: true });
              return;
            }
          }
        }
        // Frontend-only handlers
        else if (slashDef.handler === 'clearChat') {
          messages.set([]);
          isStreaming.set(false);
          return;
        }
        // W10-T2: /compactar — same flow as the header "Compactar" button
        // (mobile access: the button is hidden ≤768px since Wave 8.5).
        // Streams compact_* events through handleEvent → CompactingAnimation.
        else if (slashDef.handler === 'compactContext') {
          if (!activeSessionId) {
            isStreaming.set(false);
            messages.update(msgs => [...msgs, {
              id: 'sys-' + Date.now(),
              type: 'system',
              content: 'Nenhuma sessão ativa para compactar.',
              timestamp: new Date().toISOString()
            }]);
            return;
          }
          try {
            await compactSession(activeSessionId, 'luna-default', (ev) => handleEvent(ev));
          } catch (e) {
            console.error('[/compactar] failed:', e);
            handleEvent({ type: 'compact_error', message: e.message });
          } finally {
            isStreaming.set(false);
          }
          return;
        }
        else if (slashDef.handler === 'newSession') {
          isStreaming.set(false);
          currentSessionId.set(null);
          messages.set([]);
          // v10.18-fix: reset stale plan-mode state when creating a new session
          planModeState.set({ active: false, status: 'idle', plan: null, planPath: null, sessionId: null });
          return;
        }
        else if (slashDef.handler === 'help') {
          isStreaming.set(false);
          const helpText = SLASH_COMMANDS.map(c => `${c.cmd} — ${c.desc}`).join('\n');
          messages.update(msgs => [...msgs, {
            id: 'sys-' + Date.now(),
            type: 'system',
            content: 'Comandos disponiveis:\n\n' + helpText,
            timestamp: new Date().toISOString()
          }]);
          return;
        }
        else if (slashDef.handler === 'changeMode') {
          isStreaming.set(false);
          const mode = args[0];
          if (['instant', 'thinking'].includes(mode)) {
            currentMode.set(mode);
            messages.update(msgs => [...msgs, {
              id: 'sys-' + Date.now(),
              type: 'system',
              content: `Modo alterado para: ${mode}`,
              timestamp: new Date().toISOString()
            }]);
          } else {
            messages.update(msgs => [...msgs, {
              id: 'sys-' + Date.now(),
              type: 'system',
              content: 'Modos disponiveis: instant (Recomendado), thinking',
              timestamp: new Date().toISOString()
            }]);
          }
          return;
        }
        // v9.3: Modal handlers — open rich dashboard modals instead of plain text
        else if (slashDef.modal) {
          isStreaming.set(false);
          activeModal.set(slashDef.modal);
          messages.update(msgs => [...msgs, {
            id: 'sys-' + Date.now(),
            type: 'system',
            content: `Abrindo ${slashDef.modal}...`,
            timestamp: new Date().toISOString()
          }]);
          return;
        }
        // Plan mode
        else if (slashDef.handler === 'planMode') {
          if ($planModeState.status === 'processing') {
            console.log('[handleSend] Plan mode already processing, ignoring duplicate');
            isStreaming.set(false);
            return;
          }
          const planMsg = args.join(' ');
          planModeState.update(s => ({ ...s, active: true, status: 'processing', sessionId: activeSessionId }));
          const planRes = await startPlanMode(planMsg, activeSessionId);
          // Wave 7 review: the server may refuse (409 — another stream active) or
          // fail. Without this check planModeState stayed 'processing' and every
          // later message was silently dropped by the duplicate guard.
          if (!planRes || !planRes.ok) {
            planModeState.update(s => ({ ...s, active: false, status: 'idle', plan: null, planPath: null }));
            isStreaming.set(false);
            showPlanError((planRes && planRes.error) || 'Falha ao iniciar o plano.');
          }
          return;
        }
        // All other tools — execute via luna-tools.cjs backend
        else {
          // Map args to params based on tool type
          let params = {};
          if (args.length > 0) {
            if (['readFile', 'deleteFile', 'getFileInfo', 'listFiles', 'viewDirectory', 'createDirectory', 'removeDirectory', 'gitStatus', 'gitDiff', 'gitLog', 'executeShell', 'runTests', 'checkSyntax', 'installPackages', 'searchWeb', 'downloadFile', 'getCurrentDirectory'].includes(slashDef.handler)) {
              params = args.length === 1 ? args[0] : args;
            } else if (['writeFile', 'appendFile'].includes(slashDef.handler)) {
              params = { filePath: args[0], content: args.slice(1).join(' ') };
            } else if (['moveFile', 'copyFile'].includes(slashDef.handler)) {
              params = { source: args[0], destination: args[1] };
            } else if (['replaceInFile'].includes(slashDef.handler)) {
              params = { filePath: args[0], search: args[1], replacement: args.slice(2).join(' ') };
            } else if (['grep', 'searchFiles'].includes(slashDef.handler)) {
              params = { pattern: args[0], path: args[1] || '.' };
            } else if (['fetchURL'].includes(slashDef.handler)) {
              params = { url: args[0] };
            } else if (['clipboardRead', 'clipboardWrite'].includes(slashDef.handler)) {
              params = args.length > 0 ? args.join(' ') : undefined;
            } else {
              // Dashboard tools — pass as object with positional args
              params = args.length === 1 ? args[0] : Object.fromEntries(args.map((a, i) => [`arg${i}`, a]));
            }
          }
          result = await executeLunaTool(slashDef.handler, params);
        }

        isStreaming.set(false);
        if (result) {
          const content = result.ok
            ? (result.message || result.output || result.result?.stdout || result.result?.output || JSON.stringify(result.result || result, null, 2))
            : (result.error || 'Erro desconhecido');
          messages.update(msgs => [...msgs, {
            id: 'sys-' + Date.now(),
            type: 'system',
            content: content.slice(0, 4000),
            timestamp: new Date().toISOString()
          }]);
        }
      } else if ($planModeState.active) {
        console.log('[handleSend] entering active branch', { statusGet: get(planModeState).status, statusDollar: $planModeState.status });
        // v4.2-fix: Prevent double plan submission
        if ($planModeState.status === 'processing') {
          console.log('[handleSend] Plan mode already processing, ignoring duplicate');
          return;
        }
        const planMsg = msg.startsWith('/plan') ? msg.slice(5).trim() : msg;
        planModeState.update(s => ({ ...s, active: true, status: 'processing', sessionId: activeSessionId }));
        console.log('[handleSend] calling startPlanMode', { planMsg, activeSessionId });
        const planRes = await startPlanMode(planMsg, activeSessionId);
        // Wave 7 review: same refusal handling as the /plan slash branch (409 etc.)
        if (!planRes || !planRes.ok) {
          planModeState.update(s => ({ ...s, active: false, status: 'idle', plan: null, planPath: null }));
          isStreaming.set(false);
          showPlanError((planRes && planRes.error) || 'Falha ao iniciar o plano.');
        }
      } else {
        await sendMessage(msg, activeSessionId, $currentMode, files, currentMessageId, sessionProvider);
        // v7.1-fix: Reconnect SSE after sending a new message in the same session.
        // The previous SSE connection was gracefully closed after 'done'. We need
        // a fresh connection for the new message's streaming response.
        await connectSSE();
      }
    } catch (e) {
      console.error('Send error:', e);
      isStreaming.set(false);
      messages.update(msgs => [...msgs, {
        id: 'err-' + Date.now(),
        type: 'error',
        content: 'Falha ao enviar mensagem: ' + e.message,
        timestamp: new Date().toISOString()
      }]);
    }
  }

  async function handleCancel() {
    if (sessionId) {
      await cancelStream(sessionId);
      isStreaming.set(false);
    }
  }

  // Wave 7: show a visible PT-BR system message when a plan action fails
  // (e.g. server restarted and planModeSessions was lost — previously console-only).
  function showPlanError(msg) {
    messages.update(msgs => [...msgs, {
      id: 'sys-' + Date.now(),
      type: 'system',
      content: 'Aviso: ' + msg,
      timestamp: new Date().toISOString()
    }]);
  }

  // Wave 7: after a plan action, continue the SAME Kimi chat by sending a
  // normal message (same pattern as handleSend: optimistic user bubble,
  // sendMessage + connectSSE so the streaming response is received).
  async function sendPlanFollowUp(text) {
    messages.update(msgs => [...msgs, {
      id: 'user-' + Date.now(),
      type: 'user',
      content: text,
      files: [],
      timestamp: new Date().toISOString()
    }]);
    userMessageAdded = true;
    isStreaming.set(true);
    try {
      await sendMessage(text, sessionId, $currentMode, [], null, sessionProvider);
    } catch (e) {
      // Wave 7 review: the plan action itself already succeeded server-side —
      // only the execution kickoff failed. Unlock the input (isStreaming) and
      // say so honestly instead of leaking a stuck streaming state.
      isStreaming.set(false);
      showPlanError('Ação registrada, mas falhou ao enviar a continuação ao modelo (' + e.message + '). Envie uma mensagem manualmente.');
      return;
    }
    await connectSSE();
  }

  // Wave 7 review: re-entrancy guard — the plan card buttons stay rendered until
  // the SSE echo arrives, so a double-click would POST twice and send the
  // follow-up message twice.
  let planActionPending = false;

  async function handleApprovePlan() {
    if (!sessionId || planActionPending) return;
    planActionPending = true;
    try {
      const res = await approvePlan(sessionId);
      if (!res || !res.ok) {
        planModeState.update(s => ({ ...s, active: false, status: 'idle', plan: null }));
        showPlanError((res && res.error) || 'Nenhum plano ativo encontrado (o servidor pode ter reiniciado). Gere o plano novamente.');
        return;
      }
      planModeState.update(s => ({ ...s, active: false, status: 'idle', plan: null }));
      // Approval actually executes: ask the model to run the plan in this chat.
      await sendPlanFollowUp('Plano aprovado. Execute agora o plano acima, passo a passo, nesta mesma conversa.');
    } catch (e) {
      console.error('Approve plan error:', e);
      showPlanError('Falha ao aprovar o plano: ' + e.message);
    } finally {
      planActionPending = false;
    }
  }

  async function handleRejectPlan() {
    if (!sessionId || planActionPending) return;
    planActionPending = true;
    try {
      const res = await rejectPlan(sessionId);
      if (!res || !res.ok) {
        // Dead/expired plan — close the card so the buttons don't 404 again.
        planModeState.update(s => ({ ...s, active: false, status: 'idle', plan: null }));
        showPlanError((res && res.error) || 'Nenhum plano ativo encontrado (o servidor pode ter reiniciado). Gere o plano novamente.');
        return;
      }
      planModeState.update(s => ({ ...s, active: false, status: 'idle', plan: null }));
    } catch (e) {
      console.error('Reject plan error:', e);
      showPlanError('Falha ao rejeitar o plano: ' + e.message);
    } finally {
      planActionPending = false;
    }
  }

  async function handleRevisePlan(revisedPlan) {
    if (!sessionId || planActionPending) return;
    planActionPending = true;
    try {
      const res = await submitRevision(sessionId, revisedPlan);
      if (!res || !res.ok) {
        showPlanError((res && res.error) || 'Nenhum plano ativo encontrado (o servidor pode ter reiniciado). Gere o plano novamente.');
        return;
      }
      // The model must SEE the revision: send it as a normal message in this chat.
      await sendPlanFollowUp('Plano revisado pelo usuário:\n\n' + revisedPlan);
    } catch (e) {
      console.error('Revise plan error:', e);
      showPlanError('Falha ao revisar o plano: ' + e.message);
    } finally {
      planActionPending = false;
    }
  }

  function handleClear() {
    messages.set([]);
  }

  function handleExport() {
    const msgs = $messages;
    const content = msgs.map(m => {
      const role = m.type === 'user' ? 'Usuario' : m.type === 'assistant' ? 'Luna' : 'Sistema';
      return `[${role}] ${m.content || ''}`;
    }).join('\n\n---\n\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `luna-chat-${sessionId || 'export'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  onDestroy(() => {
    toolTimers.clearAll();
    ackBatcher.flush(); // Wave 4 bug 4: last best-effort ack while sessionId is still set
    sseManager.disconnect();
    stopHeartbeat();
    mascotState.set('sleep');
  });
</script>

<div class="chat-area">
  <ChatHeader
    title={$messages.find(m => m.type === 'user')?.content?.slice(0, 50) || 'Nova Conversa'}
    mode={$currentMode}
    provider={$currentProvider}
    isStreaming={$isStreaming}
    sessionId={sessionId}
    on:modeChange={(e) => currentMode.set(e.detail)}
    on:providerChange={(e) => {
      const newProvider = e.detail;
      currentProvider.set(newProvider);
      // v11.1-fix: Also update the session in the sessions store so sendMessage
      // uses the newly selected provider immediately.
      sessions.update(list => list.map(s => s.id === sessionId ? { ...s, provider: newProvider } : s));
    }}
    on:clear={handleClear}
    on:export={handleExport}
    on:compactEvent={(e) => handleEvent(e.detail)}
    on:openConfig
    on:newChat
    on:editTitle
    on:goHome={() => currentSessionId.set(null)}
  />

  <!-- v10.12: Moon-phase compacting animation overlay -->
  <CompactingAnimation />

  <MessagesList
    messages={$messages}
    showTyping={showTyping}
    currentMode={$currentMode}
    onApprovePlan={handleApprovePlan}
    onRejectPlan={handleRejectPlan}
    onRevisePlan={handleRevisePlan}
    onConfirmTool={handleConfirmTool}
    onCancelTool={handleCancelTool}
  />

  <ChatInput
    onSend={handleSend}
    onCancel={handleCancel}
    disabled={$isStreaming}
  />

  <!-- v9.3: Rich modal responses for dashboard slash commands -->
  <TaskDashboardModal
    open={$activeModal === 'tasks'}
    onClose={() => activeModal.set(null)}
  />
  <LeadDashboardModal
    open={$activeModal === 'leads'}
    onClose={() => activeModal.set(null)}
  />
  <FinanceDashboardModal
    open={$activeModal === 'finance'}
    onClose={() => activeModal.set(null)}
  />
  <VotingDashboardModal
    open={$activeModal === 'voting'}
    onClose={() => activeModal.set(null)}
  />
</div>

<style>
  .chat-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }
  /* Header is now self-contained, no wrapper needed */
</style>
