<script>
  import { formatDuration } from '../utils.js';
  // Wave 5: icon/color maps are GENERATED from the backend tool registry
  // (packages/kernel/lib/tool-registry.cjs → scripts/gen-tool-meta.cjs).
  // Never hand-edit toolMeta.generated.js — update the registry and regenerate.
  import { TOOL_COLORS, TOOL_ICONS } from '../lib/toolMeta.generated.js';
  import { Ban, Radio } from 'lucide-svelte';
  import LunaIcon from '../lib/icons/LunaIcon.svelte';

  export let tool = '';
  export let params = {};
  export let result = undefined;
  export let duration = 0;
  export let status = 'running'; // v9.4: external status from parent
  export let liveOutput = ''; // v9.5: real-time streaming output

  // v3.3: destructive-operation confirmation gate
  export let confirmationId = null;
  export let confirmationMessage = '';
  export let onConfirm = () => {};
  export let onCancel = () => {};

  // v11.8-debug: log confirmation gate lifecycle
  $: if (confirmationId) console.log('[ToolCard] confirmation gate rendered:', { tool, confirmationId, confirmationMessage });

  function handleConfirm() {
    console.log('[ToolCard] Confirm clicked:', { confirmationId, tool });
    if (onConfirm && confirmationId) onConfirm(confirmationId);
  }
  function handleCancel() {
    console.log('[ToolCard] Cancel clicked:', { confirmationId, tool });
    if (onCancel && confirmationId) onCancel(confirmationId);
  }

  $: displayStatus = status || (result ? (result.success !== false ? 'completed' : 'failed') : 'running');
  $: color = TOOL_COLORS[tool] || '#6b7280';
  $: icon = TOOL_ICONS[tool] || 'fallback';
  $: displayPath = params?.path || params?.file || params?.dir || params?.url || '';
  $: displayCommand = params?.command || params?.code || params?.script || '';

  // v11.8-fix: strip stray code fences from tool output so ```json / ``` don't leak into the UI.
  // Also remove JSON tool/script wrappers that sometimes leak into friendly messages.
  function cleanCodeFences(text) {
    if (!text || typeof text !== 'string') return text;
    return text
      .replace(/```[a-z0-9]*\s*\n?/gim, '')
      .replace(/\n?```\s*/gim, '')
      .replace(/\{\s*"tool"\s*:\s*"[^"]+"[\s\S]*?"params"\s*:\s*\{[\s\S]*?\}\s*\}/g, '')
      .replace(/\{\s*"script"\s*:\s*"[\s\S]*?"\s*,?\s*"language"\s*:\s*"[^"]*"\s*\}/g, '')
      .replace(/^\s*JSON\s*(?:Copy|复制|複製)?\s*\n?/gim, '')
      .trim();
  }

  // v12.4-fix: readFile places file content in result.result.content; include it
  // in the output scan so the frontend actually shows what was read.
  // v13.0 (F3.1): field-contract rendering — any result with at least one known
  // field produces a card body, so new/structured tools never render empty.
  // Priority: unified text (F2.2) → output/stdout/content → structured
  // (entries / git status / search results) → JSON dump of the inner result.
  function renderEntries(entries) {
    if (!Array.isArray(entries)) return '';
    const lines = [];
    const walk = (items) => {
      for (const it of items) {
        lines.push((it.prefix || '') + it.name + (it.type === 'dir' ? '/' : ''));
        if (it.children) walk(it.children);
      }
    };
    walk(entries);
    return lines.join('\n');
  }
  function renderGitStatus(r) {
    const files = Array.isArray(r.files) ? r.files.join('\n') : '';
    return `Branch: ${r.branch || '?'}\nModificados: ${r.modified ?? 0} | Adicionados: ${r.added ?? 0} | Deletados: ${r.deleted ?? 0} | Não rastreados: ${r.untracked ?? 0}${files ? '\n' + files : ''}`;
  }
  function renderSearchResults(results) {
    if (!Array.isArray(results)) return '';
    return results.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n');
  }
  $: inner = result?.result !== undefined ? result.result : result;
  $: structuredOutput =
    inner?.entries ? renderEntries(inner.entries)
    : inner?.modified !== undefined ? renderGitStatus(inner)
    : inner?.results ? renderSearchResults(inner.results)
    : '';
  $: rawResultOutput = inner?.text !== undefined ? inner.text : result?.output !== undefined ? result.output : result?.stdout !== undefined ? result.stdout : result?.result?.stdout !== undefined ? result.result.stdout : result?.result?.output !== undefined ? result.result.output : result?.content !== undefined ? result.content : result?.result?.content !== undefined ? result.result.content : structuredOutput || (inner && typeof inner === 'object' && Object.keys(inner).length > 0 ? JSON.stringify(inner, null, 2) : '');
  $: resultOutput = cleanCodeFences(rawResultOutput);
  // v13.0 (owner directive 2026-08-13): no 500-char display cap — full output
  // is shown (the block is already collapsible via <details>).
  $: truncatedOutput = resultOutput || '';

  // Wave 8: the backend wraps results one level deeper
  // (action_end.result = {success, mode, tool, result: <inner>}) — read the
  // inner level too, without dropping the legacy flat reads above.
  $: errorText = result?.error || result?.result?.error || '';
  // v11.8-fix: friendlyMessage is NOT an error; it's a human-readable summary.
  // Detect whether it signals success or failure so we can color it correctly.
  // Expanded regexes to catch Portuguese/Spanish/English variants with or without emoji.
  $: friendlyMessageRaw = result?.friendlyMessage || result?.result?.friendlyMessage || '';
  $: friendlyMessage = cleanCodeFences(friendlyMessageRaw);
  $: friendlyIsSuccess = friendlyMessage && /^(✅|✔|success|sucesso|executado|concluído|done|ok|pronto|finalizado|completo|exit\s*0|script\s+bash\s+executado\s+\(exit\s*0\))/i.test(friendlyMessage);
  // v12.2-fix: 'cancelado'/'cancelada' deliberately removed — the user denying
  // a destructive action is NOT an error and must not render red.
  $: friendlyIsError = friendlyMessage && /^(❌|✖|error|erro|falha|failed|falhou|falhou|timeout|expirou|exit\s*(?:1|[2-9][0-9]?))/i.test(friendlyMessage);
  $: paramsJson = params && Object.keys(params).length > 0 ? JSON.stringify(params, null, 2) : '';
  // Wave 8 review: cap the fallback body like truncatedOutput — a tool with
  // huge params (e.g. a big inline payload) must not dump it all into the DOM.
  $: paramsJsonDisplay = paramsJson.length > 500 ? paramsJson.slice(0, 500) + '...' : paramsJson;

  // Cinema animations per tool type
  $: toolAnimationClass = displayStatus === 'running' ? `anim-${tool}` : '';
  $: cardClasses = [
    'tool-card',
    displayStatus === 'running' ? 'running' : '',
    displayStatus === 'completed' ? 'success' : '',
    displayStatus === 'failed' ? 'error' : '',
    displayStatus === 'awaiting_confirmation' ? 'awaiting-confirmation' : '',
    displayStatus === 'cancelled' ? 'cancelled' : '',
    toolAnimationClass
  ].filter(Boolean).join(' ');
</script>

<div
  class={cardClasses}
  style="--tool-color: {color}"
>
  <div class="tool-header">
    <div class="tool-info">
      <span class="tool-icon">
        <LunaIcon name={icon} size={18} ariaLabel={tool} />
      </span>
      <span class="tool-name">{tool}</span>
    </div>
    <div class="tool-status">
      {#if displayStatus === 'running'}
        <span class="status-badge running">
          <span class="luna-spinner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <!-- Lua crescente girando -->
              <path class="moon-phase" d="M12 2 A10 10 0 1 1 12 22 A7 7 0 1 0 12 2Z" fill="currentColor"/>
              <!-- Estrela orbitando -->
              <circle class="orbit-star" cx="12" cy="3" r="1.5" fill="currentColor"/>
            </svg>
          </span>
          {formatDuration(duration)}
        </span>
      {:else if displayStatus === 'completed'}
        <span class="status-badge success">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {formatDuration(duration)}
        </span>
      {:else if displayStatus === 'cancelled'}
        <span class="status-badge cancelled">
          <Ban size={12} strokeWidth={2.5} />
          Cancelado
        </span>
      {:else if displayStatus === 'awaiting_confirmation'}
        <span class="status-badge awaiting">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          Aguardando confirmação
        </span>
      {:else}
        <span class="status-badge error">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          Erro
        </span>
      {/if}
    </div>
  </div>

  {#if displayPath}
    <code class="tool-path">{displayPath}</code>
  {/if}

  {#if displayCommand}
    <details class="tool-command-details">
      <summary>Ver comando</summary>
      <pre class="command-content">{displayCommand}</pre>
    </details>
  {/if}

  {#if displayStatus === 'running'}
    <div class="progress-bar">
      <div class="progress-fill"></div>
    </div>
  {/if}

  {#if displayStatus === 'awaiting_confirmation'}
    <div class="confirmation-box">
      <p class="confirmation-message">{confirmationMessage || 'Essa operação precisa de confirmação.'}</p>
      <div class="confirmation-actions">
        <button class="confirm-btn" on:click={handleConfirm}>Confirmar</button>
        <button class="cancel-btn" on:click={handleCancel}>Cancelar</button>
      </div>
    </div>
  {/if}

  {#if displayStatus === 'running' && liveOutput}
    <details class="tool-output live" open>
      <summary><Radio size={14} strokeWidth={1.5} style="display:inline-block; vertical-align:middle; margin-right:4px;" /> Output em tempo real</summary>
      <pre class="output-content live-content">{liveOutput}</pre>
    </details>
  {:else if truncatedOutput && displayStatus !== 'running'}
    <!-- v12.5-fix: open output by default so the user sees the result without clicking -->
    <details class="tool-output" open={displayStatus === 'failed' || truncatedOutput.length > 0}>
      <summary>{displayStatus === 'failed' ? 'Ver erro' : 'Ver output'}</summary>
      <pre class="output-content" class:output-success={displayStatus === 'completed'} class:output-error={displayStatus === 'failed'}>{truncatedOutput}</pre>
    </details>
  {/if}

  <!-- Wave 8: never render a blank card — when there is no command/path and
       no known output, show the raw params as the card body. -->
  {#if !displayPath && !displayCommand && !truncatedOutput && !errorText && !friendlyMessage && !(displayStatus === 'running' && liveOutput) && paramsJson}
    <pre class="output-content">{paramsJsonDisplay}</pre>
  {/if}

  {#if result?.warning}
    <div class="tool-warning">{result.warning}</div>
  {/if}

  {#if friendlyMessage}
    <div class="info-message" class:info-success={friendlyIsSuccess} class:info-error={friendlyIsError}>{friendlyMessage}</div>
  {/if}

  {#if errorText}
    <div class="error-message">{errorText}</div>
  {/if}
</div>

<style>
  .tool-card {
    background: rgba(18, 18, 31, 0.65);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.06);
    border-left: 3px solid var(--tool-color);
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 13px;
    max-width: 100%;
    animation: springIn 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .tool-card.success {
    border-left-color: #22c55e;
  }
  .tool-card.error {
    border-left-color: #ef4444;
    border-color: rgba(239, 68, 68, 0.2);
  }
  @keyframes springIn {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
    50% { box-shadow: 0 0 12px 2px rgba(255,255,255,0.03); }
  }
  .tool-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .tool-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tool-icon {
    font-size: 16px;
    display: inline-block;
  }
  /* ═══════════════════════════════════════════════════════════
     Cinema animations — Tema Luna / Cosmos
     Cada tool tem uma animação única relacionada a astros
     ═══════════════════════════════════════════════════════════ */

  /* executeShell: Raio caindo do céu (meteoro no terminal) */
  .anim-executeShell .tool-icon {
    animation: meteorStrike 0.9s ease-in-out infinite;
    filter: drop-shadow(0 0 4px #a855f7);
  }
  @keyframes meteorStrike {
    0%   { transform: translateY(-6px) scale(1); opacity: 1; filter: drop-shadow(0 0 2px #a855f7); }
    40%  { transform: translateY(2px) scale(1.2); opacity: 0.8; filter: drop-shadow(0 0 8px #d8b4fe); }
    60%  { transform: translateY(0) scale(1); opacity: 1; filter: drop-shadow(0 0 12px #a855f7); }
    100% { transform: translateY(-6px) scale(1); opacity: 1; }
  }

  /* writeFile: Constelação sendo traçada no céu */
  .anim-writeFile .tool-icon {
    animation: constellationDraw 1.6s ease-in-out infinite;
  }
  @keyframes constellationDraw {
    0%   { transform: rotate(0deg) scale(1); filter: drop-shadow(0 0 2px #3b82f6); }
    25%  { transform: rotate(-8deg) scale(1.1); filter: drop-shadow(0 0 6px #60a5fa); }
    50%  { transform: rotate(0deg) scale(1); filter: drop-shadow(0 0 2px #3b82f6); }
    75%  { transform: rotate(8deg) scale(1.1); filter: drop-shadow(0 0 6px #93c5fd); }
    100% { transform: rotate(0deg) scale(1); }
  }

  /* readFile: Olho estelar abrindo no cosmos */
  .anim-readFile .tool-icon {
    animation: stellarEye 1.4s ease-in-out infinite;
  }
  @keyframes stellarEye {
    0%, 100% { transform: scaleY(1); filter: drop-shadow(0 0 2px #22c55e); }
    45%      { transform: scaleY(0.3); filter: drop-shadow(0 0 8px #4ade80); }
    55%      { transform: scaleY(1.1); filter: drop-shadow(0 0 12px #86efac); }
  }

  /* searchWeb/searchFiles: Telescópio escaneando o céu */
  .anim-searchWeb .tool-icon,
  .anim-searchFiles .tool-icon {
    animation: telescopeScan 1.8s ease-in-out infinite;
  }
  @keyframes telescopeScan {
    0%   { transform: rotate(0deg) scale(1); filter: drop-shadow(0 0 2px #f97316); }
    25%  { transform: rotate(-15deg) scale(1.15); filter: drop-shadow(0 0 8px #fb923c); }
    50%  { transform: rotate(0deg) scale(1); filter: drop-shadow(0 0 2px #f97316); }
    75%  { transform: rotate(15deg) scale(1.15); filter: drop-shadow(0 0 8px #fdba74); }
    100% { transform: rotate(0deg) scale(1); }
  }

  /* browser/web_search: Planeta sendo orbitado por luas */
  .anim-browser .tool-icon,
  .anim-web_search .tool-icon {
    animation: planetOrbit 2s ease-in-out infinite;
  }
  @keyframes planetOrbit {
    0%   { transform: rotate(0deg) scale(1); filter: drop-shadow(0 0 2px #3b82f6); }
    50%  { transform: rotate(180deg) scale(1.1); filter: drop-shadow(0 0 10px #60a5fa); }
    100% { transform: rotate(360deg) scale(1); filter: drop-shadow(0 0 2px #3b82f6); }
  }

  /* git: Galáxia espiral girando */
  .anim-gitStatus .tool-icon,
  .anim-gitDiff .tool-icon,
  .anim-gitLog .tool-icon,
  .anim-gitCommit .tool-icon {
    animation: galaxySpin 2.2s ease-in-out infinite;
  }
  @keyframes galaxySpin {
    0%   { transform: rotate(0deg) scale(1); filter: drop-shadow(0 0 2px #6b7280); }
    30%  { transform: rotate(-120deg) scale(1.1); filter: drop-shadow(0 0 6px #9ca3af); }
    60%  { transform: rotate(-240deg) scale(1.05); filter: drop-shadow(0 0 4px #d1d5db); }
    100% { transform: rotate(-360deg) scale(1); filter: drop-shadow(0 0 2px #6b7280); }
  }

  /* replaceInFile: Estrelas trocando de lugar no céu */
  .anim-replaceInFile .tool-icon {
    animation: starSwap 1.3s ease-in-out infinite;
  }
  @keyframes starSwap {
    0%   { transform: translateX(0) scale(1); filter: drop-shadow(0 0 2px #06b6d4); }
    33%  { transform: translateX(-5px) scale(1.15); filter: drop-shadow(0 0 8px #22d3ee); }
    66%  { transform: translateX(5px) scale(1.15); filter: drop-shadow(0 0 8px #67e8f9); }
    100% { transform: translateX(0) scale(1); filter: drop-shadow(0 0 2px #06b6d4); }
  }

  /* ipython: Serpente de luz cósmica */
  .anim-ipython .tool-icon {
    animation: cosmicSerpent 1.5s ease-in-out infinite;
  }
  @keyframes cosmicSerpent {
    0%   { transform: translateY(0) rotate(0deg); filter: drop-shadow(0 0 2px #f59e0b); }
    25%  { transform: translateY(-3px) rotate(-5deg); filter: drop-shadow(0 0 6px #fbbf24); }
    50%  { transform: translateY(0) rotate(0deg); filter: drop-shadow(0 0 10px #fcd34d); }
    75%  { transform: translateY(3px) rotate(5deg); filter: drop-shadow(0 0 6px #fbbf24); }
    100% { transform: translateY(0) rotate(0deg); }
  }

  /* dashboard tools: Painel de controle estelar piscando */
  .anim-dashboardCreateTask .tool-icon,
  .anim-dashboardListTasks .tool-icon,
  .anim-dashboardCreateLead .tool-icon,
  .anim-dashboardListLeads .tool-icon,
  .anim-dashboardGetFinanceSummary .tool-icon {
    animation: stellarDashboard 1.1s steps(2) infinite;
  }
  @keyframes stellarDashboard {
    0%, 100% { opacity: 1; filter: drop-shadow(0 0 2px #ec4899); }
    50%      { opacity: 0.5; filter: drop-shadow(0 0 10px #f472b6); }
  }

  /* Fallback para tools sem animação específica */
  .tool-card.running .tool-icon:not([class*="anim-"]) {
    animation: genericStarPulse 1.4s ease-in-out infinite;
  }
  @keyframes genericStarPulse {
    0%, 100% { transform: scale(1); filter: drop-shadow(0 0 2px currentColor); }
    50%      { transform: scale(1.2); filter: drop-shadow(0 0 8px currentColor); }
  }
  .tool-name {
    font-weight: 600;
    color: var(--luna-text);
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
  }
  .tool-status {
    flex-shrink: 0;
  }
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    font-family: 'JetBrains Mono', monospace;
  }
  .status-badge.running {
    background: rgba(255,255,255,0.06);
    color: var(--luna-text-secondary);
  }
  .status-badge.success {
    background: rgba(34, 197, 94, 0.12);
    color: #4ade80;
  }
  .status-badge.error {
    background: rgba(239, 68, 68, 0.12);
    color: #fca5a5;
  }
  /* v12.2: cancelled = deliberate user denial — neutral, never red */
  .tool-card.cancelled {
    border-left-color: #6b7280;
    opacity: 0.75;
  }
  .status-badge.cancelled {
    background: rgba(107, 114, 128, 0.15);
    color: #9ca3af;
    border: 1px solid rgba(107, 114, 128, 0.25);
  }
  .luna-spinner {
    display: inline-block;
    animation: moonSpin 1.4s linear infinite;
    color: var(--tool-color, var(--luna-accent));
  }
  .luna-spinner .moon-phase {
    animation: moonPhaseShift 2s ease-in-out infinite;
  }
  .luna-spinner .orbit-star {
    animation: starOrbit 1s linear infinite;
    transform-origin: 12px 12px;
  }
  @keyframes moonSpin {
    to { transform: rotate(360deg); }
  }
  @keyframes moonPhaseShift {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  @keyframes starOrbit {
    0%   { transform: rotate(0deg) translateY(-9px); opacity: 1; }
    50%  { transform: rotate(180deg) translateY(-9px); opacity: 0.5; }
    100% { transform: rotate(360deg) translateY(-9px); opacity: 1; }
  }
  .tool-path {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: var(--luna-text-secondary);
    background: rgba(0,0,0,0.2);
    padding: 4px 8px;
    border-radius: 6px;
    margin-bottom: 8px;
    word-break: break-all;
  }
  .progress-bar {
    height: 3px;
    background: rgba(255,255,255,0.06);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 8px;
    position: relative;
  }
  .progress-bar::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: repeating-linear-gradient(
      90deg,
      transparent 0px,
      transparent 8px,
      rgba(255,255,255,0.03) 8px,
      rgba(255,255,255,0.03) 9px
    );
  }
  .progress-fill {
    height: 100%;
    width: 40%;
    background: linear-gradient(90deg, transparent, var(--tool-color), var(--tool-color), transparent);
    border-radius: 2px;
    animation: starStream 1.8s infinite linear;
    position: relative;
  }
  .progress-fill::after {
    content: '✦';
    position: absolute;
    right: -2px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 8px;
    color: var(--tool-color);
    animation: starTwinkle 0.6s ease-in-out infinite;
    text-shadow: 0 0 4px var(--tool-color);
  }
  @keyframes starStream {
    0% { transform: translateX(-150%); }
    100% { transform: translateX(250%); }
  }
  @keyframes starTwinkle {
    0%, 100% { opacity: 1; transform: translateY(-50%) scale(1); }
    50% { opacity: 0.5; transform: translateY(-50%) scale(1.4); }
  }

  /* Glow sutil no card quando running */
  .tool-card.running {
    border-color: var(--tool-color);
    animation: springIn 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
               lunaGlow 2s ease-in-out infinite;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.2), 0 0 12px var(--luna-accent-border);
  }
  @keyframes lunaGlow {
    0%, 100% { box-shadow: 0 0 0 1px rgba(0,0,0,0.2), 0 0 8px var(--luna-accent-border); }
    50% { box-shadow: 0 0 0 1px rgba(0,0,0,0.2), 0 0 20px var(--luna-accent-glow); }
  }
  .tool-output {
    margin-top: 8px;
  }
  .tool-output summary {
    font-size: 12px;
    color: var(--luna-text-secondary);
    cursor: pointer;
    padding: 4px 0;
    font-family: 'JetBrains Mono', monospace;
    transition: color 0.15s;
  }
  .tool-output summary:hover {
    color: var(--luna-text);
  }
  .output-content {
    margin-top: 6px;
    padding: 10px 12px;
    background: rgba(0,0,0,0.2);
    border-radius: 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    line-height: 1.6;
    color: var(--luna-text-secondary);
    max-height: 300px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .tool-output.live summary {
    color: #4ade80;
    animation: pulse-live 1.5s ease-in-out infinite;
  }
  .live-content {
    background: rgba(74, 222, 128, 0.05);
    border: 1px solid rgba(74, 222, 128, 0.15);
    color: #86efac;
  }
  @keyframes pulse-live {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  .tool-warning {
    margin-top: 8px;
    padding: 8px 12px;
    background: rgba(245, 158, 11, 0.1);
    border-radius: 6px;
    color: #fbbf24;
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    word-break: break-word;
  }
  .error-message {
    margin-top: 8px;
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border-radius: 6px;
    color: #fca5a5;
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    word-break: break-word;
  }
  .info-message {
    margin-top: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    word-break: break-word;
    background: rgba(255, 255, 255, 0.06);
    color: var(--luna-text-secondary);
  }
  .info-message.info-success {
    background: rgba(34, 197, 94, 0.12);
    color: #86efac;
  }
  .info-message.info-error {
    background: rgba(239, 68, 68, 0.1);
    color: #fca5a5;
  }
  .output-content.output-success {
    background: rgba(34, 197, 94, 0.08);
    border: 1px solid rgba(34, 197, 94, 0.15);
    color: #86efac;
  }
  .output-content.output-error {
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.15);
    color: #fca5a5;
  }
  .tool-command-details {
    margin: 6px 0;
    font-size: 12px;
  }
  .tool-command-details summary {
    cursor: pointer;
    color: var(--luna-text-secondary);
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    user-select: none;
  }
  .tool-command-details summary:hover {
    color: var(--luna-accent);
  }
  .command-content {
    margin-top: 6px;
    padding: 8px 10px;
    background: rgba(0,0,0,0.25);
    border-radius: 6px;
    color: var(--luna-primary-hover);
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
  }

  .tool-card.awaiting-confirmation {
    border-left-color: #f59e0b;
    box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.15);
  }
  .status-badge.awaiting {
    background: rgba(245, 158, 11, 0.12);
    color: #fbbf24;
    border: 1px solid rgba(245, 158, 11, 0.25);
  }
  .confirmation-box {
    margin-top: 10px;
    padding: 10px 12px;
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.2);
    border-radius: 8px;
  }
  .confirmation-message {
    margin: 0 0 10px 0;
    font-size: 13px;
    color: #fbbf24;
  }
  .confirmation-actions {
    display: flex;
    gap: 8px;
  }
  .confirm-btn, .cancel-btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid transparent;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .confirm-btn {
    background: #16a34a;
    color: #fff;
  }
  .confirm-btn:hover {
    background: #15803d;
  }
  .cancel-btn {
    background: #dc2626;
    color: #fff;
  }
  .cancel-btn:hover {
    background: #b91c1c;
  }

  /* Wave 10 T3: backdrop-filter over the animated canvas melts the iOS
     compositor as the conversation grows — solid fallback on mobile */
  @media (max-width: 768px) {
    .tool-card {
      background: rgba(18, 18, 31, 0.94);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }
</style>
