<script>
  import { slide } from 'svelte/transition';
  import { Search, AlertTriangle, File, Terminal, Lightbulb, Play, CheckCircle2, Hourglass, Wrench, CircleDot, Brain } from 'lucide-svelte';

  export let text = '';
  export let isExpanded = true;

  $: displayText = text || '';
  $: lines = displayText.split('\n').filter(l => l.trim());

  // Contextual icon mapping for thinking lines
  function getLineIcon(line) {
    const lower = line.toLowerCase();
    if (lower.includes('search') || lower.includes('buscar') || lower.includes('pesquisar') || lower.includes('find')) return Search;
    if (lower.includes('error') || lower.includes('erro') || lower.includes('fail') || lower.includes('falha')) return AlertTriangle;
    if (lower.includes('file') || lower.includes('arquivo') || lower.includes('write') || lower.includes('read') || lower.includes('save')) return File;
    if (lower.includes('code') || lower.includes('script') || lower.includes('function') || lower.includes('class')) return Terminal;
    if (lower.includes('idea') || lower.includes('ideia') || lower.includes('consider') || lower.includes('maybe') || lower.includes('talvez')) return Lightbulb;
    if (lower.includes('step') || lower.includes('passo') || lower.includes('next') || lower.includes('depois')) return Play;
    if (lower.includes('done') || lower.includes('complete') || lower.includes('finished') || lower.includes('pronto')) return CheckCircle2;
    if (lower.includes('wait') || lower.includes('aguarde') || lower.includes('loading')) return Hourglass;
    if (lower.includes('tool') || lower.includes('execute') || lower.includes('run') || lower.includes('shell')) return Wrench;
    return CircleDot;
  }

  function getLineClass(line) {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('erro') || lower.includes('fail')) return 'line-error';
    if (lower.includes('done') || lower.includes('complete') || lower.includes('success')) return 'line-success';
    if (lower.includes('warning') || lower.includes('caution')) return 'line-warning';
    if (lower.includes('code') || lower.includes('```') || lower.includes('function')) return 'line-code';
    return '';
  }
</script>

<div class="thinking-bubble" class:expanded={isExpanded}>
  <button class="thinking-header" on:click={() => isExpanded = !isExpanded} aria-expanded={isExpanded}>
    <span class="thinking-icon"><Brain size={15} strokeWidth={1.5} /></span>
    <span class="thinking-title">Pensando</span>
    <span class="thinking-dots">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </span>
    <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class:rotated={isExpanded}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  </button>

  {#if isExpanded}
    <div class="thinking-content" transition:slide={{ duration: 200 }}>
      {#if lines.length > 0}
        {#each lines as line}
          <div class="thinking-line {getLineClass(line)}">
            <span class="line-icon"><svelte:component this={getLineIcon(line)} size={11} strokeWidth={1.5} /></span>
            <span class="line-text">{line}</span>
          </div>
        {/each}
      {:else}
        <div class="thinking-placeholder">Analisando...</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .thinking-bubble {
    position: relative;
    background: rgba(18, 18, 31, 0.6);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px dashed rgba(255,255,255,0.08);
    border-radius: 12px;
    max-width: 85%;
    animation: fadeIn 300ms cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  }
  .thinking-bubble::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: linear-gradient(180deg, var(--luna-accent), transparent);
    opacity: 0.6;
  }
  .thinking-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: none;
    border: none;
    color: var(--luna-text-secondary);
    font-size: 13px;
    cursor: pointer;
    width: 100%;
    text-align: left;
    border-radius: 12px;
    transition: color 0.15s;
    font-family: 'JetBrains Mono', monospace;
  }
  .thinking-header:hover {
    color: var(--luna-accent);
  }
  .thinking-icon {
    font-size: 15px;
    animation: pulse 2s infinite;
  }
  .thinking-title {
    font-weight: 500;
  }
  .thinking-dots {
    display: flex;
    gap: 3px;
    margin-left: 4px;
  }
  .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--luna-accent);
    animation: bounceDots 1.4s infinite ease-in-out both;
  }
  .dot:nth-child(1) { animation-delay: -0.32s; }
  .dot:nth-child(2) { animation-delay: -0.16s; }
  .chevron {
    margin-left: auto;
    transition: transform 0.2s;
    opacity: 0.5;
  }
  .chevron.rotated {
    transform: rotate(180deg);
  }
  .thinking-content {
    padding: 0 14px 12px 18px;
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    color: var(--luna-text-secondary);
    line-height: 1.7;
  }
  .thinking-line {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 2px 0;
    word-break: break-word;
    transition: color 0.15s;
  }
  .thinking-line:hover {
    color: var(--luna-text);
  }
  .line-icon {
    flex-shrink: 0;
    font-size: 11px;
    margin-top: 1px;
    opacity: 0.7;
  }
  .line-text {
    flex: 1;
  }
  .line-error {
    color: #fca5a5;
  }
  .line-success {
    color: #4ade80;
  }
  .line-warning {
    color: #fbbf24;
  }
  .line-code {
    color: var(--luna-accent);
    background: rgba(0,0,0,0.15);
    border-radius: 4px;
    padding: 2px 6px;
    margin: 1px 0;
    font-size: 11px;
  }
  .thinking-placeholder {
    opacity: 0.5;
    font-style: italic;
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  @keyframes bounceDots {
    0%, 80%, 100% { transform: scale(0); opacity: 0.3; }
    40% { transform: scale(1); opacity: 1; }
  }

  /* Wave 10 T3: backdrop-filter over the animated canvas melts the iOS
     compositor as the conversation grows — solid fallback on mobile */
  @media (max-width: 768px) {
    .thinking-bubble {
      background: rgba(18, 18, 31, 0.92);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }
</style>
