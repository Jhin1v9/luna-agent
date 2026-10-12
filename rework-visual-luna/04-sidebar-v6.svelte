<!-- ═══════════════════════════════════════════════════════════════
     LUNA WEB v6.0 — SIDEBAR MILIONÁRIO
     Deep Space Aurora | Glassmorphism Supreme | Motion First
     Arquiteto: Luna AI | 2026-08-07
     ═══════════════════════════════════════════════════════════════ -->

<script>
  // ─── Props ───
  export let sessions = [];
  export let activeSessionId = null;
  export let collapsed = false;
  export let mobileOpen = false;
  export let connected = true;
  export let aiState = 'idle'; // idle | thinking | happy | error | typing

  // ─── Event Dispatchers ───
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  // ─── Handlers ───
  function onNew() { dispatch('new'); }
  function onSelect(session) { dispatch('select', session); }
  function onToggleCollapse() { dispatch('toggleCollapse'); }
  function onToggleMobile() { dispatch('toggleMobile'); }
  function onDelete(session) { dispatch('delete', session); }
  function onRename(session) { dispatch('rename', session); }

  // ─── Context Menu ───
  let contextMenu = { show: false, x: 0, y: 0, session: null };
  function showContextMenu(e, session) {
    e.preventDefault();
    contextMenu = { show: true, x: e.clientX, y: e.clientY, session };
  }
  function hideContextMenu() { contextMenu = { ...contextMenu, show: false }; }

  // ─── Formatters ───
  function formatTime(date) {
    const d = new Date(date);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Agora';
    if (diff < 3600000) return `${Math.floor(diff/60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }

  // ─── Keyboard ───
  function handleKeydown(e) {
    if (e.key === 'Escape') {
      hideContextMenu();
      if (mobileOpen) onToggleMobile();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} on:click={hideContextMenu} />

<!-- ═══ MOBILE OVERLAY ═══ -->
{#if mobileOpen}
  <div class="mobile-overlay" class:open={mobileOpen} on:click={onToggleMobile}></div>
{/if}

<!-- ═══ SIDEBAR ═══ -->
<aside
  class="sidebar"
  class:collapsed
  class:mobile-open={mobileOpen}
  class:thinking={aiState === 'thinking'}
>
  <!-- Aurora Glow Background -->
  <div class="sidebar-aurora"></div>

  <!-- ─── Collapse Toggle ─── -->
  <button
    class="collapse-toggle"
    on:click={onToggleCollapse}
    title={collapsed ? 'Expandir' : 'Colapsar'}
  >
    <svg class="chevron" class:rotated={collapsed} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  </button>

  <!-- ─── Logo Area ─── -->
  <div class="logo-area">
    <div class="logo-moon">
      <svg class="moon-svg" viewBox="0 0 32 32" fill="none">
        <defs>
          <linearGradient id="moonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#c4b5fd"/>
            <stop offset="100%" stop-color="#a78bfa"/>
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="14" stroke="url(#moonGrad)" stroke-width="1.5" opacity="0.8"/>
        <path class="moon-shadow" d="M16 2a14 14 0 0 1 0 28 14 14 0 0 0 0-28z" fill="url(#moonGrad)" opacity="0.25"/>
        <circle cx="16" cy="16" r="3" fill="url(#moonGrad)" opacity="0.6">
          <animate attributeName="opacity" values="0.6;0.9;0.6" dur="3s" repeatCount="indefinite"/>
        </circle>
      </svg>
    </div>
    {#if !collapsed}
      <div class="logo-text-group" in:fade={{ duration: 200 }}>
        <span class="logo-brand">Luna</span>
        <span class="logo-sub">Kernel</span>
      </div>
      <span class="logo-badge">v6.0</span>
    {/if}
  </div>

  <!-- ─── New Session Hero Button ─── -->
  <button class="new-session-hero" on:click={onNew} title="Nova Sessão (Ctrl+K)">
    <div class="hero-glow"></div>
    <span class="hero-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </span>
    {#if !collapsed}
      <span class="hero-text" in:fade={{ duration: 200 }}>Nova Sessão</span>
      <kbd class="hero-kbd" in:fade={{ duration: 200 }}>Ctrl K</kbd>
    {/if}
  </button>

  <!-- ─── Section Label ─── -->
  {#if !collapsed}
    <div class="section-label" in:fade={{ duration: 200 }}>
      <span>Sessões</span>
      <span class="section-count">{sessions.length}</span>
    </div>
  {/if}

  <!-- ─── Session List ─── -->
  <div class="session-list luna-scroll">
    {#if sessions.length === 0}
      <div class="empty-state">
        <svg class="empty-moon" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="1" opacity="0.3"/>
          <path d="M24 8a16 16 0 0 1 0 32 16 16 0 0 0 0-32z" fill="currentColor" opacity="0.1"/>
        </svg>
        <p class="empty-title">Nenhuma sessão</p>
        <p class="empty-hint">Pressione <kbd>Ctrl K</kbd> para começar</p>
      </div>
    {:else}
      {#each sessions as session, i (session.id)}
        <div
          class="session-card"
          class:active={session.id === activeSessionId}
          on:click={() => onSelect(session)}
          on:contextmenu|preventDefault={(e) => showContextMenu(e, session)}
          style="animation-delay: {i * 50}ms"
        >
          <div class="session-glow"></div>
          <div class="session-content">
            <div class="session-header">
              <span class="session-title">{session.title || 'Nova Sessão'}</span>
              {#if session.messageCount > 0}
                <span class="session-badge">{session.messageCount}</span>
              {/if}
            </div>
            {#if !collapsed}
              <div class="session-meta" in:fade={{ duration: 200 }}>
                <span class="session-excerpt">{session.excerpt || 'Clique para conversar...'}</span>
                <span class="session-time">{formatTime(session.updatedAt)}</span>
              </div>
            {/if}
          </div>
          <button
            class="session-menu-btn"
            on:click|stopPropagation={(e) => showContextMenu(e, session)}
            title="Opções"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/>
              <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
              <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/>
            </svg>
          </button>
        </div>
      {/each}
    {/if}
  </div>

  <!-- ─── Luna Mascote Footer ─── -->
  <div class="sidebar-footer">
    <div class="luna-mascot" class:thinking={aiState === 'thinking'} class:happy={aiState === 'happy'} class:error={aiState === 'error'} class:typing={aiState === 'typing'}>
      <div class="mascot-glow"></div>
      <svg class="mascot-face" viewBox="0 0 40 40" fill="none">
        <defs>
          <radialGradient id="faceGrad" cx="50%" cy="40%">
            <stop offset="0%" stop-color="#c4b5fd"/>
            <stop offset="100%" stop-color="#7c3aed"/>
          </radialGradient>
        </defs>
        <circle cx="20" cy="20" r="18" fill="url(#faceGrad)" opacity="0.9"/>
        <!-- Eyes -->
        <g class="eyes">
          <circle class="eye-left" cx="14" cy="16" r="2.5" fill="#0a0a0f"/>
          <circle class="eye-right" cx="26" cy="16" r="2.5" fill="#0a0a0f"/>
        </g>
        <!-- Mouth -->
        <path class="mouth" d="M14 26 Q20 30 26 26" stroke="#0a0a0f" stroke-width="1.5" stroke-linecap="round" fill="none"/>
        <!-- Glow -->
        <circle cx="20" cy="20" r="22" stroke="currentColor" stroke-width="0.5" opacity="0.3" class="mascot-ring"/>
      </svg>
    </div>
    {#if !collapsed}
      <div class="mascot-info" in:fade={{ duration: 200 }}>
        <span class="mascot-name">Luna</span>
        <span class="mascot-status" class:online={connected}>
          <span class="status-dot"></span>
          {connected ? 'Online' : 'Offline'}
        </span>
      </div>
    {/if}
  </div>

  <!-- ─── Context Menu ─── -->
  {#if contextMenu.show}
    <div
      class="context-menu"
      style="top: {contextMenu.y}px; left: {contextMenu.x}px;"
      on:click|stopPropagation
    >
      <button class="ctx-item" on:click={() => { onRename(contextMenu.session); hideContextMenu(); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Renomear
      </button>
      <button class="ctx-item" on:click={() => { onDelete(contextMenu.session); hideContextMenu(); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        Excluir
      </button>
    </div>
  {/if}
</aside>

<!-- ═══════════════════════════════════════════════════════════════
     STYLES — Deep Space Aurora | Glassmorphism Supreme
     ═══════════════════════════════════════════════════════════════ -->
<style>
  /* ─── Import Tokens ─── */
  @import './03-design-tokens.css';

  /* ─── Sidebar Container ─── */
  .sidebar {
    position: relative;
    width: var(--luna-sidebar-width);
    height: 100vh;
    background: var(--luna-bg-base);
    border-right: 1px solid var(--luna-border-subtle);
    display: flex;
    flex-direction: column;
    padding: 16px 12px;
    gap: 12px;
    overflow: hidden;
    transition: width var(--luna-duration-slow) var(--luna-spring);
    z-index: 100;
  }

  .sidebar.collapsed {
    width: var(--luna-sidebar-collapsed);
    padding: 16px 8px;
  }

  .sidebar-aurora {
    position: absolute;
    inset: 0;
    background: var(--luna-gradient-nebula);
    pointer-events: none;
    opacity: 0.5;
  }

  /* ─── Collapse Toggle ─── */
  .collapse-toggle {
    position: absolute;
    top: 16px;
    right: -12px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--luna-bg-elevated);
    border: 1px solid var(--luna-border-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--luna-text-secondary);
    transition: all var(--luna-duration-normal) var(--luna-spring);
    z-index: 10;
  }

  .collapse-toggle:hover {
    color: var(--luna-text-primary);
    border-color: var(--luna-border-glow);
    box-shadow: var(--luna-shadow-glow);
  }

  .chevron {
    width: 14px;
    height: 14px;
    transition: transform var(--luna-duration-slow) var(--luna-spring);
  }

  .chevron.rotated {
    transform: rotate(180deg);
  }

  /* ─── Logo Area ─── */
  .logo-area {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 4px;
    position: relative;
  }

  .logo-moon {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    filter: drop-shadow(0 0 8px rgba(167,139,250,0.4));
    animation: moon-breathe 4s ease-in-out infinite;
  }

  .moon-svg {
    width: 100%;
    height: 100%;
  }

  .logo-text-group {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
  }

  .logo-brand {
    font-family: var(--luna-font-sans);
    font-size: var(--luna-text-lg);
    font-weight: 700;
    color: var(--luna-text-primary);
    letter-spacing: -0.02em;
  }

  .logo-sub {
    font-family: var(--luna-font-sans);
    font-size: var(--luna-text-xs);
    font-weight: 500;
    color: var(--luna-text-accent);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .logo-badge {
    margin-left: auto;
    font-family: var(--luna-font-mono);
    font-size: 10px;
    font-weight: 600;
    color: var(--luna-text-tertiary);
    background: rgba(255,255,255,0.04);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--luna-border-subtle);
  }

  /* ─── New Session Hero ─── */
  .new-session-hero {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 12px;
    border: none;
    background: var(--luna-gradient-hero);
    color: white;
    font-family: var(--luna-font-sans);
    font-size: var(--luna-text-sm);
    font-weight: 600;
    cursor: pointer;
    overflow: hidden;
    transition: all var(--luna-duration-normal) var(--luna-spring);
    box-shadow: 0 4px 16px rgba(102,126,234,0.3);
  }

  .new-session-hero:hover {
    transform: scale(1.02);
    box-shadow: 0 6px 24px rgba(102,126,234,0.4), var(--luna-shadow-glow);
  }

  .new-session-hero:active {
    transform: scale(0.98);
  }

  .hero-glow {
    position: absolute;
    inset: -2px;
    background: var(--luna-gradient-hero);
    filter: blur(12px);
    opacity: 0.5;
    z-index: -1;
    transition: opacity var(--luna-duration-normal);
  }

  .new-session-hero:hover .hero-glow {
    opacity: 0.8;
  }

  .hero-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform var(--luna-duration-normal) var(--luna-spring);
  }

  .new-session-hero:hover .hero-icon {
    transform: rotate(90deg);
  }

  .hero-text {
    flex: 1;
    text-align: left;
  }

  .hero-kbd {
    font-family: var(--luna-font-mono);
    font-size: 10px;
    font-weight: 500;
    color: rgba(255,255,255,0.7);
    background: rgba(255,255,255,0.1);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.15);
  }

  /* ─── Section Label ─── */
  .section-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 4px 4px;
    font-family: var(--luna-font-sans);
    font-size: var(--luna-text-xs);
    font-weight: 600;
    color: var(--luna-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .section-count {
    font-family: var(--luna-font-mono);
    font-size: 10px;
    color: var(--luna-text-muted);
    background: rgba(255,255,255,0.04);
    padding: 1px 6px;
    border-radius: 10px;
  }

  /* ─── Session List ─── */
  .session-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px 0;
  }

  /* ─── Session Card ─── */
  .session-card {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    cursor: pointer;
    border: 1px solid transparent;
    background: transparent;
    transition: all var(--luna-duration-normal) var(--luna-smooth);
    animation: fade-up var(--luna-duration-slow) var(--luna-smooth) forwards;
    opacity: 0;
  }

  .session-card:hover {
    background: rgba(255,255,255,0.03);
    border-color: var(--luna-border-subtle);
    transform: translateX(4px);
  }

  .session-card.active {
    background: rgba(102,126,234,0.08);
    border-color: var(--luna-border-glow);
    box-shadow: var(--luna-shadow-glow);
  }

  .session-card.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--luna-gradient-aurora);
  }

  .session-glow {
    position: absolute;
    inset: 0;
    border-radius: 10px;
    background: var(--luna-gradient-aurora);
    opacity: 0;
    filter: blur(16px);
    z-index: -1;
    transition: opacity var(--luna-duration-normal);
  }

  .session-card:hover .session-glow {
    opacity: 0.05;
  }

  .session-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .session-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .session-title {
    font-family: var(--luna-font-sans);
    font-size: var(--luna-text-sm);
    font-weight: 500;
    color: var(--luna-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .session-card.active .session-title {
    color: var(--luna-text-accent);
  }

  .session-badge {
    font-family: var(--luna-font-mono);
    font-size: 10px;
    font-weight: 600;
    color: var(--luna-text-primary);
    background: rgba(102,126,234,0.3);
    padding: 1px 6px;
    border-radius: 10px;
    flex-shrink: 0;
  }

  .session-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .session-excerpt {
    font-family: var(--luna-font-sans);
    font-size: var(--luna-text-xs);
    color: var(--luna-text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .session-time {
    font-family: var(--luna-font-mono);
    font-size: 10px;
    color: var(--luna-text-muted);
    flex-shrink: 0;
  }

  .session-menu-btn {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--luna-text-tertiary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all var(--luna-duration-fast);
    flex-shrink: 0;
    margin-top: 2px;
  }

  .session-card:hover .session-menu-btn {
    opacity: 1;
  }

  .session-menu-btn:hover {
    background: rgba(255,255,255,0.06);
    color: var(--luna-text-primary);
  }

  /* ─── Empty State ─── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px 16px;
    text-align: center;
    color: var(--luna-text-tertiary);
  }

  .empty-moon {
    width: 48px;
    height: 48px;
    opacity: 0.3;
    animation: moon-breathe 4s ease-in-out infinite;
  }

  .empty-title {
    font-family: var(--luna-font-sans);
    font-size: var(--luna-text-sm);
    font-weight: 500;
    color: var(--luna-text-secondary);
    margin: 0;
  }

  .empty-hint {
    font-family: var(--luna-font-sans);
    font-size: var(--luna-text-xs);
    color: var(--luna-text-tertiary);
    margin: 0;
  }

  .empty-hint kbd {
    font-family: var(--luna-font-mono);
    font-size: 10px;
    background: rgba(255,255,255,0.06);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--luna-border-subtle);
  }

  /* ─── Sidebar Footer ─── */
  .sidebar-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    margin-top: auto;
    border-radius: 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid var(--luna-border-subtle);
  }

  /* ─── Luna Mascote ─── */
  .luna-mascot {
    position: relative;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
  }

  .mascot-glow {
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(167,139,250,0.3) 0%, transparent 70%);
    opacity: 0.6;
    transition: all var(--luna-duration-normal);
  }

  .mascot-face {
    width: 100%;
    height: 100%;
    position: relative;
    z-index: 1;
  }

  .mascot-ring {
    transition: all var(--luna-duration-normal);
  }

  /* Mascote States */
  .luna-mascot.thinking .mascot-glow {
    background: radial-gradient(circle, rgba(245,158,11,0.4) 0%, transparent 70%);
    animation: glow-pulse 2s ease-in-out infinite;
  }

  .luna-mascot.thinking .eye-left,
  .luna-mascot.thinking .eye-right {
    animation: blink 2s ease-in-out infinite;
  }

  .luna-mascot.happy .mascot-glow {
    background: radial-gradient(circle, rgba(16,185,129,0.4) 0%, transparent 70%);
  }

  .luna-mascot.happy .mouth {
    d: path("M12 24 Q20 32 28 24");
  }

  .luna-mascot.error .mascot-glow {
    background: radial-gradient(circle, rgba(239,68,68,0.4) 0%, transparent 70%);
  }

  .luna-mascot.error .eye-left,
  .luna-mascot.error .eye-right {
    display: none;
  }

  .luna-mascot.error .mouth {
    d: path("M14 28 L20 24 L26 28");
  }

  .luna-mascot.typing .mascot-glow {
    background: radial-gradient(circle, rgba(59,130,246,0.4) 0%, transparent 70%);
  }

  .mascot-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mascot-name {
    font-family: var(--luna-font-sans);
    font-size: var(--luna-text-sm);
    font-weight: 600;
    color: var(--luna-text-primary);
  }

  .mascot-status {
    font-family: var(--luna-font-sans);
    font-size: 10px;
    color: var(--luna-text-tertiary);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--luna-text-muted);
    transition: background var(--luna-duration-normal);
  }

  .mascot-status.online .status-dot {
    background: #10b981;
    box-shadow: 0 0 6px rgba(16,185,129,0.5);
  }

  /* ─── Context Menu ─── */
  .context-menu {
    position: fixed;
    min-width: 160px;
    background: var(--luna-bg-overlay);
    backdrop-filter: blur(24px) saturate(1.2);
    -webkit-backdrop-filter: blur(24px) saturate(1.2);
    border: 1px solid var(--luna-border-subtle);
    border-radius: 10px;
    padding: 6px;
    z-index: 1000;
    box-shadow: var(--luna-shadow-lg);
    animation: spring-in var(--luna-duration-fast) var(--luna-spring);
  }

  .ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--luna-text-secondary);
    font-family: var(--luna-font-sans);
    font-size: var(--luna-text-sm);
    cursor: pointer;
    transition: all var(--luna-duration-fast);
    text-align: left;
  }

  .ctx-item:hover {
    background: rgba(255,255,255,0.06);
    color: var(--luna-text-primary);
  }

  .ctx-item svg {
    flex-shrink: 0;
    opacity: 0.7;
  }

  /* ─── Mobile ─── */
  .mobile-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 99;
    opacity: 0;
    transition: opacity var(--luna-duration-normal);
    pointer-events: none;
  }

  .mobile-overlay.open {
    opacity: 1;
    pointer-events: all;
  }

  /* ─── Keyframes ─── */
  @keyframes fade-up {
    0% { opacity: 0; transform: translateY(8px); }
    100% { opacity: 1; transform: translateY(0); }
  }

  @keyframes blink {
    0%, 90%, 100% { transform: scaleY(1); }
    95% { transform: scaleY(0.1); }
  }

  /* ─── Responsive ─── */
  @media (max-width: 768px) {
    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      transform: translateX(-100%);
      z-index: 100;
    }

    .sidebar.mobile-open {
      transform: translateX(0);
    }

    .collapse-toggle {
      display: none;
    }
  }

  /* ─── Reduced Motion ─── */
  @media (prefers-reduced-motion: reduce) {
    .sidebar,
    .session-card,
    .chevron,
    .new-session-hero,
    .collapse-toggle {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
