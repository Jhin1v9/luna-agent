<script>
  import { onMount, tick } from 'svelte';
  import { Moon, Terminal, Search, Code, Lock } from 'lucide-svelte';
  import { isStreaming } from '../stores.js';
  import { scrollManager } from '../utils.js';
  import UserMessage from './UserMessage.svelte';
  import AssistantMessage from './AssistantMessage.svelte';
  import ThinkingBubble from './ThinkingBubble.svelte';
  import ToolCard from './ToolCard.svelte';
  import ToolGroup from './ToolGroup.svelte';
  import PlanCard from './PlanCard.svelte';
  import TypingIndicator from './TypingIndicator.svelte';

  export let messages = [];
  export let showTyping = false;
  export let currentMode = 'instant';
  export let onApprovePlan = () => {};
  export let onRejectPlan = () => {};
  export let onRevisePlan = () => {};
  export let onConfirmTool = () => {};
  export let onCancelTool = () => {};

  let listEl;
  let userScrolledUp = false;
  let showNewMessagesBadge = false;

  // Wave 10 T3: index of the last assistant message — only it gets the
  // infinite border-gradient/avatar animations (see AssistantMessage).
  $: lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === 'assistant') return i;
    }
    return -1;
  })();

  // v12.6-fix: group consecutive tool cards to reduce visual noise. Sequences of
  // 3+ tools render as a collapsible ToolGroup; 1-2 tools keep their full cards.
  const TOOL_GROUP_THRESHOLD = 3;
  $: messageSlots = (() => {
    const slots = [];
    let i = 0;
    while (i < messages.length) {
      if (messages[i].type === 'tool') {
        let j = i;
        while (j < messages.length && messages[j].type === 'tool') j++;
        const toolRun = messages.slice(i, j);
        if (toolRun.length >= TOOL_GROUP_THRESHOLD) {
          slots.push({ type: 'tool_group', id: `tool-group-${toolRun[0].id}`, tools: toolRun, index: i });
        } else {
          for (let k = 0; k < toolRun.length; k++) {
            slots.push({ type: 'message', message: toolRun[k], index: i + k });
          }
        }
        i = j;
      } else {
        slots.push({ type: 'message', message: messages[i], index: i });
        i++;
      }
    }
    return slots;
  })();

  $: if (messages.length > 0) {
    tick().then(() => {
      if (!userScrolledUp) {
        // Wave 10 T3: instant scroll while streaming — a smooth-scroll
        // animation restarted on every token delta is pure compositor cost.
        scrollManager.scrollToBottom(listEl, $isStreaming ? 'auto' : 'smooth');
      } else {
        showNewMessagesBadge = true;
      }
    });
  }

  function handleScroll() {
    if (!listEl) return;
    const nearBottom = scrollManager.isNearBottom(listEl, 100);
    userScrolledUp = !nearBottom;
    if (nearBottom) showNewMessagesBadge = false;
  }

  function scrollToBottom() {
    scrollManager.scrollToBottom(listEl, 'smooth');
    userScrolledUp = false;
    showNewMessagesBadge = false;
  }

  onMount(() => {
    scrollManager.scrollToBottom(listEl, 'auto');
  });
</script>

<div
  class="messages-list"
  bind:this={listEl}
  on:scroll={handleScroll}
  aria-live="polite"
  aria-label="Mensagens do chat"
>
  {#if messages.length === 0}
    <div class="welcome">
      <div class="welcome-icon"><Moon size={48} strokeWidth={1.5} /></div>
      <h2 class="welcome-title">Bem-vindo a Luna Web</h2>
      <p class="welcome-subtitle">Como posso ajudar voce hoje?</p>
      <div class="welcome-suggestions">
        <button class="suggestion" on:click>
          <Terminal size={14} strokeWidth={1.5} /> Crie um app React com Tailwind
        </button>
        <button class="suggestion" on:click>
          <Search size={14} strokeWidth={1.5} /> Pesquise as ultimas noticias de IA
        </button>
        <button class="suggestion" on:click>
          <Code size={14} strokeWidth={1.5} /> Execute um script Python
        </button>
      </div>
    </div>
  {:else}
    <div class="messages-container">
      {#each messageSlots as slot (slot.id || slot.message?.id || slot.index)}
        {@const message = slot.type === 'message' ? slot.message : null}
        {@const i = slot.index}
        <div class="message-wrapper" class:system-msg={message?.type === 'system' || message?.type === 'error' || message?.type === 'login_required'}>
          {#if slot.type === 'tool_group'}
            <ToolGroup tools={slot.tools} onConfirmTool={onConfirmTool} onCancelTool={onCancelTool} />
          {:else if message.type === 'user'}
            <UserMessage content={message.content} timestamp={message.timestamp} files={message.files} />
          {:else if message.type === 'assistant'}
            <AssistantMessage content={message.content} timestamp={message.timestamp} isStreaming={$isStreaming} isLast={i === lastAssistantIndex} />
          {:else if message.type === 'thinking'}
            <ThinkingBubble text={message.content} />
          {:else if message.type === 'tool'}
            <ToolCard
              tool={message.tool}
              params={message.params}
              result={message.result}
              duration={message.duration}
              status={message.status || 'running'}
              liveOutput={message.liveOutput || ''}
              confirmationId={message.confirmationId}
              confirmationMessage={message.confirmationMessage}
              onConfirm={onConfirmTool}
              onCancel={onCancelTool}
            />
          {:else if message.type === 'plan'}
            <PlanCard
              plan={message.content}
              status={message.status || 'awaiting_approval'}
              on:approve={onApprovePlan}
              on:reject={onRejectPlan}
              on:revise={(e) => onRevisePlan(e.detail)}
            />
          {:else if message.type === 'system' || message.type === 'error'}
            <div class="system-banner" class:error={message.type === 'error'}>
              {message.content}
            </div>
          {:else if message.type === 'login_required'}
            <div class="system-banner login-required">
              <Lock size={14} strokeWidth={1.5} /> {message.content}
              <button class="retry-btn" on:click={() => location.reload()}>Recarregar página</button>
            </div>
          {/if}
        </div>
      {/each}
      <!-- v8.3-fix: Typing indicator for INSTANT mode when no thinking bubble is present -->
      {#if showTyping && currentMode === 'instant' && !messages.some(m => m.type === 'thinking')}
        <div class="message-wrapper">
          <TypingIndicator text="Luna está respondendo" />
        </div>
      {/if}
    </div>
  {/if}

  {#if showNewMessagesBadge}
    <button class="new-messages-badge" on:click={scrollToBottom}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
      Novas mensagens
    </button>
  {/if}

  <!-- Bottom spacer to prevent last message being hidden behind input -->
  <div class="messages-bottom-spacer" aria-hidden="true"></div>
</div>

<style>
  .messages-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px;
    position: relative;
    /* Wave 10 T3: no CSS scroll-behavior — it turns behavior:'auto' scrolls
       into smooth ones; explicit 'smooth' in scrollTo still works */
  }
  .messages-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 900px;
    margin: 0 auto;
    width: 100%;
    padding-bottom: 8px;
  }
  .messages-bottom-spacer {
    height: 12px;
    flex-shrink: 0;
  }
  @media (max-width: 640px) {
    .messages-list {
      padding: 10px;
    }
    .messages-container {
      gap: 12px;
    }
  }
  .message-wrapper {
    animation: fadeInUp 300ms cubic-bezier(0.4, 0, 0.2, 1);
    /* Wave 10 T3: cheap-man's virtualization — off-screen messages skip
       layout/paint; intrinsic size keeps the scrollbar stable */
    content-visibility: auto;
    contain-intrinsic-size: auto 120px;
  }
  .message-wrapper.system-msg {
    animation: fadeIn 200ms ease;
  }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 50vh;
    text-align: center;
    animation: fadeInUp 500ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .welcome-icon {
    font-size: 48px;
    margin-bottom: 16px;
  }
  .welcome-title {
    font-size: 24px;
    font-weight: 600;
    color: var(--luna-text);
    margin-bottom: 8px;
  }
  .welcome-subtitle {
    font-size: 15px;
    color: var(--luna-text-secondary);
    margin-bottom: 24px;
  }
  .welcome-suggestions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: 400px;
  }
  .suggestion {
    padding: 12px 16px;
    background: rgba(18, 18, 31, 0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid var(--luna-border);
    border-radius: 10px;
    color: var(--luna-text);
    font-size: 14px;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
  }
  .suggestion:hover {
    background: rgba(26, 26, 46, 0.75);
    border-color: rgba(255,255,255,0.1);
    transform: translateY(-1px);
  }
  .system-banner {
    padding: 10px 16px;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 8px;
    color: var(--luna-text-secondary);
    font-size: 13px;
    text-align: center;
  }
  .system-banner.error {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }
  .system-banner.login-required {
    background: rgba(245, 158, 11, 0.1);
    border-color: rgba(245, 158, 11, 0.2);
    color: #fbbf24;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .retry-btn {
    background: rgba(245, 158, 11, 0.2);
    border: 1px solid rgba(245, 158, 11, 0.3);
    color: #fbbf24;
    padding: 4px 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .retry-btn:hover {
    background: rgba(245, 158, 11, 0.3);
  }
  .new-messages-badge {
    position: absolute;
    bottom: 80px;
    right: 24px;
    padding: 8px 16px;
    background: rgba(233, 69, 96, 0.9);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: white;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 4px 24px rgba(233, 69, 96, 0.3), 0 0 0 1px rgba(255,255,255,0.05);
    animation: fadeIn 200ms ease;
    z-index: 10;
    transition: all 0.2s ease;
  }
  .new-messages-badge:hover {
    transform: translateY(-2px);
    background: rgba(233, 69, 96, 1);
    box-shadow: 0 6px 28px rgba(233, 69, 96, 0.4), 0 0 0 1px rgba(255,255,255,0.08);
  }
</style>
