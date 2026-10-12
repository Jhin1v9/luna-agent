<script context="module">
  import { Marked } from 'marked';

  // Wave 4 bug 8: ONE Marked instance per module. Previously the renderer was
  // registered per instance, mutating the global marked config once per message.
  const lunaRenderer = {
    code(token) {
      const code = token.text;
      const language = token.lang || '';
      const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<div class="code-block-wrapper">
        <div class="code-header">
          <span class="code-lang">${language || 'text'}</span>
          <button class="copy-btn" data-code="${encodeURIComponent(code)}">Copiar</button>
        </div>
        <pre><code class="hljs ${language ? 'language-' + language : ''}">${escaped}</code></pre>
      </div>`;
    },
    codespan(token) {
      const code = token.text;
      const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<code class="inline-code">${escaped}</code>`;
    }
  };

  const lunaMarked = new Marked({
    renderer: lunaRenderer,
    gfm: true,
    breaks: false,
    headerIds: false,
    mangle: false
  });
</script>

<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { BarChart3, Terminal, CheckCircle2, Copy, ThumbsUp, ThumbsDown, RefreshCcw, Moon } from 'lucide-svelte';
  import { createDebouncedScheduler } from '../lib/debounce.js';
  import { formatTime } from '../utils.js';
  import LunaAvatar from './LunaAvatar.svelte';

  export let content = '';
  export let timestamp = '';
  export let onFeedback = () => {};
  export let isStreaming = false;
  // Wave 10 T3: only the last assistant message runs the infinite border
  // gradient / avatar pulse — N spinning borders over the canvas is what
  // froze iOS as the conversation grew.
  export let isLast = false;

  $: avatarState = (isStreaming && isLast) ? 'thinking' : 'idle';

  // Visual personality detection
  $: hasCode = content.includes('```') || /function|class|const|let|var|import|export/.test(content);
  $: hasSearch = /search|pesquis|buscar|encontrar|resultados?/i.test(content);
  $: hasAction = /pronto|feito|completado|done|finished|success/i.test(content) && (hasCode || content.length > 200);
  $: hasTable = /\|.*\|/.test(content);
  $: personalityClass = [
    hasCode ? 'has-code' : '',
    hasSearch ? 'has-search' : '',
    hasAction ? 'has-action' : '',
    hasTable ? 'has-table' : ''
  ].filter(Boolean).join(' ');

  let contentEl;
  let copiedCode = null;
  let copiedMessage = false;

  let renderedHtml = content ? renderMarkdown(content) : '';

  // Wave 4 bug 8: coalesce render+highlight during streaming (one pass per
  // 120ms instead of one per delta); render immediately when not streaming
  // so final/historical content is never delayed.
  const renderScheduler = createDebouncedScheduler(() => {
    renderedHtml = renderMarkdown(content);
    highlightCode();
  }, 120);

  let lastScheduledContent = null;

  $: scheduleRender(content, isStreaming);

  function scheduleRender(_content, streaming) {
    // Wave 4 review follow-up: skip redundant renders — unrelated messages
    // re-fire when the global isStreaming flag flips. Never skip while a
    // debounced render is pending (the immediate path must be able to flush it).
    if (_content === lastScheduledContent && !renderScheduler.pending) return;
    lastScheduledContent = _content;
    renderScheduler.schedule(!streaming);
  }

  function renderMarkdown(text) {
    if (!text) return '';
    // Unescape literal \n sequences that may come from JSON
    const working = text.trim().replace(/\\n/g, '\n');
    try {
      let html = lunaMarked.parse(working, { async: false });
      // Wrap native <table> elements for the Luna glow frame
      html = html.replace(/<table>/g, '<div class="md-table-wrapper"><table>');
      html = html.replace(/<\/table>/g, '</table></div>');
      return html;
    } catch (e) {
      console.warn('Markdown render error:', e);
      return `<p>${working.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`;
    }
  }

  async function highlightCode() {
    await tick();
    if (!contentEl) return;
    const hljs = await import('highlight.js');
    const blocks = contentEl.querySelectorAll('pre code');
    blocks.forEach(block => {
      try {
        hljs.default.highlightElement(block);
      } catch (e) {
        console.warn('Highlight error:', e);
      }
    });
  }

  async function handleCopy(e) {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const code = decodeURIComponent(btn.dataset.code);
    try {
      await navigator.clipboard.writeText(code);
      copiedCode = btn;
      btn.textContent = 'Copiado!';
      btn.classList.add('copied');
      setTimeout(() => {
        if (copiedCode === btn) {
          btn.textContent = 'Copiar';
          btn.classList.remove('copied');
          copiedCode = null;
        }
      }, 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(content || '');
      copiedMessage = true;
      setTimeout(() => copiedMessage = false, 2000);
    } catch (err) {
      console.error('Copy message failed:', err);
    }
  }

  onMount(() => {
    highlightCode();
  });

  // Wave 4 review follow-up: cancel any armed debounced render on destroy so a
  // late timer can't fire into a destroyed component.
  onDestroy(() => renderScheduler.cancel());
</script>

<div class="assistant-message-wrapper {personalityClass}">
  <div class="assistant-message" class:animated={isLast}>
    <div class="message-header">
      <LunaAvatar state={avatarState} size={32} animate={isLast} />
      <span class="name">Luna</span>
      {#if hasTable}
        <span class="content-badge table-badge"><BarChart3 size={12} strokeWidth={1.5} /> tabela</span>
      {/if}
      {#if hasCode}
        <span class="content-badge code-badge"><Terminal size={12} strokeWidth={1.5} /> código</span>
      {/if}
    </div>
    <button class="copy-message-btn" on:click={copyMessage} title="Copiar mensagem" aria-label="Copiar mensagem">
      {#if copiedMessage}<CheckCircle2 size={14} strokeWidth={1.5} />{:else}<Copy size={14} strokeWidth={1.5} />{/if}
      <span>{copiedMessage ? 'Copiado' : 'Copiar'}</span>
    </button>
    <div class="message-body" bind:this={contentEl} on:click={handleCopy} on:keydown={(e) => e.key === 'Enter' && handleCopy(e)} role="button" tabindex="0" aria-label="Clique para copiar codigo">
      {@html renderedHtml}
    </div>
    <div class="message-footer">
      {#if timestamp}
        <span class="message-time" title={new Date(timestamp).toLocaleString('pt-BR')}>
          {formatTime(timestamp)}
        </span>
      {/if}
      <div class="feedback-buttons">
        <button class="feedback-btn" on:click={() => onFeedback('up')} title="Boa resposta" aria-label="Gostei">
          <ThumbsUp size={14} strokeWidth={1.5} />
        </button>
        <button class="feedback-btn" on:click={() => onFeedback('down')} title="Resposta ruim" aria-label="Nao gostei">
          <ThumbsDown size={14} strokeWidth={1.5} />
        </button>
        <button class="feedback-btn" on:click={() => onFeedback('retry')} title="Tentar novamente" aria-label="Tentar novamente">
          <RefreshCcw size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
    <!-- Luna signature -->
    <div class="luna-signature" aria-hidden="true"><Moon size={14} strokeWidth={1.5} /></div>
  </div>
</div>

<style>
  .assistant-message-wrapper {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    margin-right: auto;
    max-width: 92%;
    animation: fadeInUp 300ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .assistant-message {
    position: relative;
    background: rgba(18, 18, 31, 0.72);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-radius: 16px;
    border-top-left-radius: 4px;
    padding: 16px 20px;
    color: var(--luna-text);
    font-size: 15px;
    line-height: 1.65;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.25),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }
  .assistant-message::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--luna-accent), transparent 40%, transparent 60%, var(--luna-accent));
    background-size: 200% 100%;
    z-index: -1;
    opacity: 0.55;
    pointer-events: none;
  }
  /* Wave 10 T3: border gradient spins only on the last assistant message */
  .assistant-message.animated::before {
    animation: gradientRotate 5s linear infinite;
  }
  .assistant-message::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: linear-gradient(180deg, var(--luna-accent-glow), transparent 55%);
    z-index: -2;
    opacity: 0.35;
    pointer-events: none;
  }
  /* Wave 10 T3: the blur layer only on the last (animated) message */
  .assistant-message.animated::after {
    filter: blur(10px);
  }
  @keyframes gradientRotate {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
  }
  .message-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .name {
    font-weight: 600;
    font-size: 14px;
    color: var(--luna-accent);
    text-shadow: 0 0 12px var(--luna-accent-glow);
  }
  .content-badge {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
    margin-left: 4px;
  }
  .table-badge {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(99, 102, 241, 0.15));
    border: 1px solid rgba(168, 85, 247, 0.35);
    color: #d8b4fe;
    box-shadow: 0 0 10px rgba(168, 85, 247, 0.15);
  }
  .code-badge {
    background: linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(59, 130, 246, 0.15));
    border: 1px solid rgba(6, 182, 212, 0.35);
    color: #a5f3fc;
    box-shadow: 0 0 10px rgba(6, 182, 212, 0.15);
  }

  /* ── Native Markdown Typography ── */
  .message-body :global(p) {
    margin-bottom: 0.85rem;
    line-height: 1.75;
  }
  .message-body :global(p:last-child) {
    margin-bottom: 0;
  }
  .message-body :global(h1),
  .message-body :global(h2),
  .message-body :global(h3),
  .message-body :global(h4) {
    margin-top: 1.35rem;
    margin-bottom: 0.6rem;
    font-weight: 700;
    color: var(--luna-text);
    letter-spacing: -0.01em;
    text-shadow: 0 0 18px var(--luna-accent-glow), 0 0 40px rgba(168, 85, 247, 0.15);
  }
  .message-body :global(h1) { font-size: 1.55rem; }
  .message-body :global(h2) { font-size: 1.3rem; }
  .message-body :global(h3) { font-size: 1.1rem; }
  .message-body :global(h4) { font-size: 1rem; }
  .message-body :global(strong) {
    font-weight: 700;
    color: #f1f5f9;
    text-shadow: 0 0 8px rgba(255, 255, 255, 0.08);
  }
  .message-body :global(em) {
    color: #cbd5e1;
    font-style: italic;
  }

  /* ── Links ── */
  .message-body :global(a) {
    color: var(--luna-primary);
    text-decoration: none;
    border-bottom: 1px solid transparent;
    transition: all 0.2s;
    font-weight: 500;
  }
  .message-body :global(a:hover) {
    color: var(--luna-primary-hover);
    border-bottom-color: var(--luna-primary-hover);
    text-shadow: 0 0 8px rgba(233, 69, 96, 0.3);
  }

  /* ── Lists ── */
  .message-body :global(ul),
  .message-body :global(ol) {
    margin: 0.75rem 0 1rem 0.25rem;
    padding-left: 1.25rem;
  }
  .message-body :global(li) {
    position: relative;
    margin-bottom: 0.4rem;
    padding-left: 0.25rem;
    line-height: 1.7;
  }
  .message-body :global(ul) {
    list-style: none;
  }
  .message-body :global(ul li::before) {
    content: '';
    position: absolute;
    left: -1.25rem;
    top: 0.45em;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--luna-accent) 0%, transparent 70%);
    box-shadow: 0 0 8px var(--luna-accent-glow);
  }
  .message-body :global(ol) {
    counter-reset: luna-ol;
    list-style: none;
  }
  .message-body :global(ol li) {
    counter-increment: luna-ol;
  }
  .message-body :global(ol li::before) {
    content: counter(luna-ol) ".";
    position: absolute;
    left: -1.25rem;
    color: var(--luna-accent);
    font-weight: 700;
    font-size: 0.85em;
    text-shadow: 0 0 8px var(--luna-accent-glow);
  }

  /* ── Blockquote ── */
  .message-body :global(blockquote) {
    display: flex;
    gap: 12px;
    border-left: none;
    padding: 14px 16px;
    margin: 1rem 0;
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.08), rgba(99, 102, 241, 0.05));
    border: 1px solid rgba(168, 85, 247, 0.15);
    box-shadow: 0 0 20px rgba(168, 85, 247, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.03);
    color: var(--luna-text-secondary);
    font-style: italic;
  }
  .message-body :global(blockquote::before) {
    content: '✦';
    font-size: 1.3rem;
    opacity: 0.8;
    filter: drop-shadow(0 0 6px rgba(255, 215, 0, 0.4));
  }
  .message-body :global(blockquote > p:last-child) {
    margin-bottom: 0;
  }

  /* ── Horizontal rule ── */
  .message-body :global(hr) {
    border: none;
    border-top: 1px solid var(--luna-border);
    margin: 1.25rem 0;
  }

  /* ── Tables ── */
  .message-body :global(.md-table-wrapper) {
    position: relative;
    overflow-x: auto;
    margin: 1.25rem 0;
    border-radius: 14px;
    padding: 1px;
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.25), rgba(6, 182, 212, 0.15), rgba(168, 85, 247, 0.25));
    background-size: 200% 200%;
    animation: tableGlow 6s ease infinite;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35), 0 0 40px rgba(168, 85, 247, 0.1);
  }
  @keyframes tableGlow {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }
  .message-body :global(table) {
    position: relative;
    z-index: 1;
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 13.5px;
    border-radius: 13px;
    overflow: hidden;
    background: rgba(13, 13, 26, 0.85);
  }
  .message-body :global(thead) {
    background: linear-gradient(90deg, rgba(168, 85, 247, 0.22), rgba(6, 182, 212, 0.12));
  }
  .message-body :global(th) {
    padding: 12px 14px;
    font-weight: 700;
    color: #f8fafc;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.06em;
    border-bottom: 1px solid rgba(168, 85, 247, 0.35);
    text-shadow: 0 0 10px rgba(168, 85, 247, 0.35);
    white-space: nowrap;
  }
  .message-body :global(td) {
    padding: 11px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: #e2e8f0;
    transition: background 0.15s, color 0.15s;
  }
  .message-body :global(tr:last-child td) {
    border-bottom: none;
  }
  .message-body :global(tbody tr:nth-child(even)) {
    background: rgba(255, 255, 255, 0.015);
  }
  .message-body :global(tbody tr:hover td) {
    background: rgba(168, 85, 247, 0.08);
    color: #fff;
  }
  .message-body :global(td:first-child) {
    font-weight: 600;
    color: #f1f5f9;
  }

  /* ── Inline code ── */
  .message-body :global(.inline-code) {
    background: rgba(255, 255, 255, 0.06);
    padding: 2px 7px;
    border-radius: 5px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    color: var(--luna-primary-hover);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  /* ── Code blocks ── */
  .message-body :global(.code-block-wrapper) {
    margin: 1rem 0;
    border-radius: 12px;
    overflow: hidden;
    background: rgba(10, 10, 20, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.06);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  }
  .message-body :global(.code-header) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 14px;
    background: linear-gradient(90deg, rgba(168, 85, 247, 0.12), rgba(6, 182, 212, 0.08));
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .message-body :global(.code-lang) {
    font-size: 11px;
    color: #c4b5fd;
    font-family: 'JetBrains Mono', monospace;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }
  .message-body :global(.copy-btn) {
    font-size: 11px;
    padding: 4px 12px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: var(--luna-text-secondary);
    cursor: pointer;
    transition: all 0.15s;
    font-family: 'JetBrains Mono', monospace;
  }
  .message-body :global(.copy-btn:hover) {
    background: rgba(255, 255, 255, 0.12);
    color: var(--luna-text);
    border-color: rgba(255, 255, 255, 0.18);
  }
  .message-body :global(.copy-btn.copied) {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
    border-color: rgba(34, 197, 94, 0.3);
  }
  .message-body :global(pre) {
    margin: 0;
    padding: 14px 16px;
    overflow-x: auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    line-height: 1.6;
  }
  .message-body :global(pre code) {
    background: none;
    padding: 0;
    font-family: 'JetBrains Mono', monospace;
  }

  .message-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--luna-border);
  }
  .message-time {
    font-size: 11px;
    color: var(--luna-text-secondary);
    font-family: 'JetBrains Mono', monospace;
  }
  .feedback-buttons {
    display: flex;
    gap: 4px;
  }
  .feedback-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    font-size: 14px;
    opacity: 0.5;
    transition: all 0.15s;
    min-width: 32px;
    min-height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .feedback-btn:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.06);
  }
  .luna-signature {
    position: absolute;
    bottom: 6px;
    right: 10px;
    font-size: 10px;
    opacity: 0.15;
    pointer-events: none;
    transition: opacity 0.3s;
  }
  .assistant-message:hover .luna-signature {
    opacity: 0.35;
  }

  /* Copy message button */
  .copy-message-btn {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    color: var(--luna-text-secondary);
    font-size: 12px;
    cursor: pointer;
    opacity: 0;
    transition: all 0.2s;
    z-index: 2;
  }
  .assistant-message:hover .copy-message-btn {
    opacity: 1;
  }
  .copy-message-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: var(--luna-text);
    border-color: rgba(255, 255, 255, 0.15);
  }

  /* Visual personality effects */
  .assistant-message-wrapper.has-code .assistant-message::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(var(--luna-accent-rgb, 168, 85, 247), 0.02) 2px,
      rgba(var(--luna-accent-rgb, 168, 85, 247), 0.02) 4px
    );
    pointer-events: none;
    z-index: 0;
  }
  .assistant-message-wrapper.has-search .assistant-message {
    background: linear-gradient(135deg, var(--luna-surface) 0%, rgba(var(--luna-accent-rgb, 168, 85, 247), 0.03) 100%);
  }
  .assistant-message-wrapper.has-action .assistant-message {
    animation: successPulse 1s ease-out;
  }
  .assistant-message-wrapper.has-table .assistant-message.animated::before {
    opacity: 0.75;
    animation: gradientRotate 3s linear infinite;
  }
  @keyframes successPulse {
    0% { box-shadow: 0 0 0 0 var(--luna-accent-glow); }
    50% { box-shadow: 0 0 24px 6px var(--luna-accent-glow); }
    100% { box-shadow: 0 0 0 0 transparent; }
  }

  /* Tool badge styling */
  .md-tool-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(99, 102, 241, 0.1));
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 8px;
    padding: 4px 10px;
    font-size: 13px;
    font-weight: 500;
    color: #c4b5fd;
    font-family: var(--font-mono, 'SF Mono', monospace);
    white-space: nowrap;
  }
  .md-inline-code {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 12px;
    color: #a5b4fc;
    font-family: var(--font-mono, 'SF Mono', monospace);
    word-break: break-all;
  }

  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Wave 10 T3: backdrop-filter over the animated canvas melts the iOS
     compositor as the conversation grows — solid fallback on mobile */
  @media (max-width: 768px) {
    .assistant-message {
      background: rgba(18, 18, 31, 0.95);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }

  /* Wave 10 T3: kill the infinite border animation for reduced-motion users
     (app.css only shrinks durations; the canvas loop is gated in JS) */
  @media (prefers-reduced-motion: reduce) {
    .assistant-message::before,
    .assistant-message.animated::before {
      animation: none;
    }
  }
</style>
