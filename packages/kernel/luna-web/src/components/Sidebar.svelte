<script>
  import { onMount, onDestroy } from 'svelte';
  import { ClipboardList, MessageSquare, FilePenLine, Trash2, Moon, BrainCircuit, Zap, XCircle, CircleDot } from 'lucide-svelte';
  import { formatTime } from '../utils.js';
  import { user, mascotState } from '../stores.js';
  import { logout } from '../api.js';
  import MoonPhase from './MoonPhase.svelte';

  export let sessions = [];
  export let currentId = null;
  export let onSelect = () => {};
  export let onNew = () => {};
  export let onRename = () => {};
  export let onDelete = () => {};
  export let onOpenConfig = () => {};
  export let mobileOpen = false;
  export let collapsed = false;
  export let onToggleCollapse = () => {};
  export let loading = false;

  let editingId = null;
  let editTitle = '';
  let contextMenuId = null;
  let contextMenuPos = { x: 0, y: 0 };
  let sidebarEl;
  let searchQuery = ''; // v8.4-fix: Session search filter

  $: sortedSessions = [...sessions].sort((a, b) =>
    new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  );

  // v8.4-fix: Filter sessions by search query (case-insensitive)
  $: filteredSessions = searchQuery.trim()
    ? sortedSessions.filter(s =>
        (s.title || 'Sem titulo').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sortedSessions;

  function startRename(session, e) {
    e.stopPropagation();
    editingId = session.id;
    editTitle = session.title || 'Sem titulo';
    contextMenuId = null;
  }

  function commitRename() {
    if (editingId && editTitle.trim()) {
      onRename(editingId, editTitle.trim());
    }
    editingId = null;
  }

  function cancelRename() {
    editingId = null;
  }

  function handleKeydown(e, session) {
    if (e.key === 'Enter') {
      commitRename();
    } else if (e.key === 'Escape') {
      cancelRename();
    }
  }

  function showContextMenu(e, session) {
    e.preventDefault();
    e.stopPropagation();
    contextMenuId = session.id;
    contextMenuPos = { x: e.clientX, y: e.clientY };
  }

  function handleDelete(id) {
    contextMenuId = null;
    if (confirm('Tem certeza que deseja excluir esta sessão?')) {
      onDelete(id);
    }
  }

  function handleClickOutside() {
    contextMenuId = null;
  }

  onMount(() => {
    const handleKey = (e) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onNew();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });
</script>

<svelte:window on:click={handleClickOutside} />

<!-- Mobile overlay -->
{#if mobileOpen}
  <div class="mobile-overlay" on:click={() => mobileOpen = false} />
{/if}

<aside class="sidebar" class:mobile-open={mobileOpen} class:collapsed bind:this={sidebarEl}>
  <!-- Toggle collapse button -->
  <button class="collapse-toggle" on:click={onToggleCollapse} title={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      {#if collapsed}
        <polyline points="9 18 15 12 9 6"/>
      {:else}
        <polyline points="15 18 9 12 15 6"/>
      {/if}
    </svg>
  </button>
  <!-- Logo minimal no topo — so o texto -->
  <div class="logo-area">
    <span class="logo-text-top">Luna Web</span>
    <span class="logo-version-top">v5.0</span>
  </div>

  <!-- New Session Button -->
  <button class="new-session-btn" on:click={onNew} title="Nova Sessao (Ctrl+K)">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    Nova Sessao
  </button>

  <!-- v8.4-fix: Search Box -->
  {#if !collapsed}
    <div class="search-sessions">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        type="text"
        placeholder="Buscar conversas..."
        bind:value={searchQuery}
        on:keydown={(e) => e.key === 'Escape' && (searchQuery = '')}
      />
      {#if searchQuery}
        <button class="search-clear" on:click={() => searchQuery = ''}>×</button>
      {/if}
    </div>
  {/if}

  <!-- Sessions Label -->
  <div class="section-label"><ClipboardList size={12} strokeWidth={1.5} /> Sessoes {#if searchQuery}({filteredSessions.length}){/if}</div>

  <!-- Session List -->
  <div class="session-list">
    {#if loading && filteredSessions.length === 0}
      <div class="session-loader">
        <MoonPhase size={56} color="#c9a227" glowIntensity={0.25} animated={true} />
        <span class="session-loader-text">Carregando conversas...</span>
      </div>
    {:else if filteredSessions.length === 0}
      <div class="empty-state">
        <div class="empty-icon"><MessageSquare size={32} strokeWidth={1.5} /></div>
        <div class="empty-text">{searchQuery ? 'Nenhuma sessao encontrada' : 'Nenhuma sessao ainda'}</div>
        <div class="empty-hint">{searchQuery ? 'Tente outro termo' : 'Clique em "Nova Sessao" para comecar'}</div>
      </div>
    {:else}
      {#each filteredSessions as session (session.id)}
        <div
          class="session-item"
          class:active={session.id === currentId}
          on:click={() => { onSelect(session.id); mobileOpen = false; }}
          on:contextmenu={(e) => showContextMenu(e, session)}
          on:dblclick={(e) => startRename(session, e)}
        >
          <div class="session-indicator" style="background-color: {session.id === currentId ? 'var(--luna-accent)' : 'transparent'}"></div>
          <div class="session-content">
            {#if editingId === session.id}
              <input
                class="session-edit-input"
                bind:value={editTitle}
                on:blur={commitRename}
                on:keydown={(e) => handleKeydown(e, session)}
                autofocus
              />
            {:else}
              <div class="session-title" class:active={session.id === currentId}>
                {session.title || 'Sem titulo'}
              </div>
              <div class="session-time">{formatTime(session.updatedAt)}</div>
            {/if}
          </div>
          <button
            class="session-menu-btn"
            on:click={(e) => showContextMenu(e, session)}
            aria-label="Menu da sessao"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2"/>
              <circle cx="12" cy="12" r="2"/>
              <circle cx="12" cy="19" r="2"/>
            </svg>
          </button>

          <!-- Context Menu -->
          {#if contextMenuId === session.id}
            <div class="context-menu" style="top: 8px; right: 8px;">
              <button class="context-item" on:click={(e) => startRename(session, e)}>
                <FilePenLine size={14} strokeWidth={1.5} /> Renomear
              </button>
              <button class="context-item" on:click={() => handleDelete(session.id)}>
                <Trash2 size={14} strokeWidth={1.5} /> Excluir
              </button>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <!-- Footer -->
  <div class="sidebar-footer">
    {#if $user}
      <div class="user-bar">
        <span class="user-avatar" style="background: {$user.color || '#e94560'}">{$user.name?.[0]?.toUpperCase() || '?'}</span>
        <span class="user-name">{$user.name}</span>
        <button class="logout-btn" on:click={() => { logout(); user.set(null); window.location.reload(); }} title="Sair">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    {/if}
    <button class="footer-btn" on:click={onOpenConfig}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
      Configuracoes
    </button>
    <!-- Luna — Moon Phase Avatar + Status -->
    <div class="footer-luna-row">
      <div class="footer-moon-wrapper">
        <span class="moon-phase" aria-label="Fases da Lua"></span>
        <span class="moon-atmosphere"></span>
        <span class="moon-stars">
          <span class="star s1"></span>
          <span class="star s2"></span>
          <span class="star s3"></span>
        </span>
      </div>
      <div class="footer-mascot-info">
        <span class="footer-mascot-name">Luna</span>
        <span class="footer-mascot-status" data-state={$mascotState}>
          {#if $mascotState === 'sleep'}
            <Moon size={12} strokeWidth={1.5} /> Dormindo
          {:else if $mascotState === 'thinking'}
            <BrainCircuit size={12} strokeWidth={1.5} /> Pensando
          {:else if $mascotState === 'working'}
            <Zap size={12} strokeWidth={1.5} /> Trabalhando
          {:else if $mascotState === 'error'}
            <XCircle size={12} strokeWidth={1.5} /> Erro
          {:else}
            <CircleDot size={12} strokeWidth={1.5} /> Online
          {/if}
        </span>
      </div>
    </div>
  </div>
</aside>

<!-- Mobile Toggle -->
<button class="mobile-toggle" on:click={() => mobileOpen = !mobileOpen} aria-label="Menu">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <line x1="3" y1="6" x2="21" y2="6"/>
    <line x1="3" y1="12" x2="21" y2="12"/>
    <line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
</button>

<style>
  .sidebar {
    width: 260px;
    min-width: 260px;
    background: rgba(18, 18, 31, 0.82);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    z-index: 20;
    transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .sidebar.collapsed {
    width: 44px;
    min-width: 44px;
  }
  .sidebar.collapsed .logo-area,
  .sidebar.collapsed .new-session-btn,
  .sidebar.collapsed .section-label,
  .sidebar.collapsed .session-list,
  .sidebar.collapsed .sidebar-footer {
    opacity: 0;
    pointer-events: none;
    width: 0;
    overflow: hidden;
    padding: 0;
    margin: 0;
    border: none;
    flex-shrink: 0;
  }
  .collapse-toggle {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 25;
    background: transparent;
    border: none;
    color: var(--luna-text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    opacity: 0.6;
  }
  .collapse-toggle:hover {
    opacity: 1;
    background: rgba(255,255,255,0.08);
    color: var(--luna-text);
  }
  .sidebar.collapsed .collapse-toggle {
    position: static;
    margin: 8px auto;
    opacity: 0.8;
  }
  .logo-area {
    padding: 16px;
    border-bottom: 1px solid var(--luna-border);
    flex-shrink: 0;
  }

  .logo-area {
    padding: 16px;
    border-bottom: 1px solid var(--luna-border);
    flex-shrink: 0;
    position: relative;
  }
  .logo-area::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 30% 50%, rgba(255,215,0,0.06) 0%, transparent 60%);
    animation: logoGlow 4s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes logoGlow {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }

  .new-session-btn {
    margin: 12px 16px;
    padding: 10px 16px;
    background: var(--luna-accent);
    color: white;
    border: none;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.2s;
    flex-shrink: 0;
  }
  .new-session-btn:hover {
    background: var(--luna-primary-hover);
    transform: translateY(-1px);
  }
  .new-session-btn:active {
    transform: translateY(0);
  }
  .section-label {
    padding: 8px 16px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--luna-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }
  .session-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px;
  }
  .empty-state {
    padding: 32px 16px;
    text-align: center;
    color: var(--luna-text-secondary);
  }
  .empty-icon { font-size: 32px; margin-bottom: 8px; }
  .empty-text { font-size: 14px; font-weight: 500; margin-bottom: 4px; }
  .empty-hint { font-size: 12px; opacity: 0.7; }
  .session-loader {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 16px;
    gap: 14px;
    color: var(--luna-text-secondary);
  }
  .session-loader-text {
    font-size: 13px;
    font-weight: 500;
    color: var(--luna-text);
    letter-spacing: 0.02em;
  }
  .session-item {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    border-radius: 8px;
    cursor: pointer;
    position: relative;
    transition: background 0.15s;
    margin-bottom: 2px;
    min-height: 48px;
  }
  .session-item:hover {
    background: rgba(255,255,255,0.04);
  }
  .session-item.active {
    background: rgba(233,69,96,0.08);
  }
  .session-indicator {
    width: 3px;
    height: 20px;
    border-radius: 2px;
    margin-right: 10px;
    flex-shrink: 0;
    transition: background 0.2s;
  }
  .session-content {
    flex: 1;
    min-width: 0;
  }
  .session-title {
    font-size: 14px;
    color: var(--luna-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .session-title.active {
    font-weight: 500;
    color: var(--luna-accent);
  }
  .session-time {
    font-size: 11px;
    color: var(--luna-text-secondary);
    font-family: 'JetBrains Mono', monospace;
  }
  .session-edit-input {
    width: 100%;
    background: var(--luna-bg);
    border: 1px solid var(--luna-accent);
    border-radius: 6px;
    padding: 4px 8px;
    color: var(--luna-text);
    font-size: 14px;
    outline: none;
  }
  .session-menu-btn {
    background: none;
    border: none;
    color: var(--luna-text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    opacity: 0;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .session-item:hover .session-menu-btn {
    opacity: 1;
  }
  .session-menu-btn:hover {
    color: var(--luna-text);
    background: rgba(255,255,255,0.06);
  }
  .context-menu {
    position: absolute;
    right: 8px;
    top: 36px;
    background: var(--luna-elevated);
    border: 1px solid var(--luna-border);
    border-radius: 8px;
    padding: 4px;
    z-index: 100;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    min-width: 140px;
  }
  .context-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: none;
    color: var(--luna-text);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    border-radius: 6px;
    transition: background 0.15s;
  }
  .context-item:hover {
    background: rgba(255,255,255,0.06);
  }
  .sidebar-footer {
    padding: 12px 16px;
    border-top: 1px solid var(--luna-border);
    flex-shrink: 0;
  }
  .footer-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: none;
    color: var(--luna-text-secondary);
    font-size: 13px;
    cursor: pointer;
    border-radius: 8px;
    transition: all 0.15s;
    margin-bottom: 8px;
  }
  .footer-btn:hover {
    background: rgba(255,255,255,0.04);
    color: var(--luna-text);
  }
  .footer-luna-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    margin-top: 4px;
    position: relative;
  }
  .footer-mascot-avatar {
    flex-shrink: 0;
    position: relative;
  }
  .footer-mascot-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .footer-mascot-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--luna-text);
    letter-spacing: -0.2px;
  }
  .footer-mascot-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 500;
    font-family: 'JetBrains Mono', monospace;
    transition: color 0.4s ease;
  }
  .footer-mascot-status[data-state="idle"] { color: #4ECDC4; }
  .footer-mascot-status[data-state="thinking"] { color: #FFD93D; }
  .footer-mascot-status[data-state="working"] { color: #9B59B6; }
  .footer-mascot-status[data-state="sleep"] { color: #5D8AA8; }
  .footer-mascot-status[data-state="error"] { color: #E74C3C; }

  /* Lua animada no footer */
  .footer-moon-wrapper {
    position: relative;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .footer-moon-wrapper .moon-phase {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 30% 30%, rgba(255,235,128,0.9) 0%, transparent 25%),
      radial-gradient(circle at 70% 55%, rgba(200,170,0,0.4) 0%, transparent 20%),
      radial-gradient(circle at 45% 75%, rgba(200,170,0,0.3) 0%, transparent 18%),
      radial-gradient(circle at 60% 25%, rgba(200,170,0,0.25) 0%, transparent 15%),
      #ffd700;
    position: relative;
    z-index: 2;
    animation: moonPhase 60s linear infinite;
    will-change: box-shadow;
  }
  .footer-moon-wrapper .moon-phase::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    animation: moonPhaseShadow 60s linear infinite;
    will-change: box-shadow;
  }
  .footer-moon-wrapper .moon-atmosphere {
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    z-index: 1;
    animation: moonAtmosphere 60s linear infinite;
    pointer-events: none;
  }
  .footer-moon-wrapper .moon-stars {
    position: absolute;
    inset: -8px;
    z-index: 0;
    pointer-events: none;
  }
  .footer-moon-wrapper .moon-stars .star {
    position: absolute;
    border-radius: 50%;
    background: #fff;
  }
  .footer-moon-wrapper .moon-stars .star.s1 {
    width: 2px; height: 2px;
    top: 2px; right: 4px;
    animation: starTwinkle 2.1s ease-in-out infinite;
  }
  .footer-moon-wrapper .moon-stars .star.s2 {
    width: 1.5px; height: 1.5px;
    bottom: 3px; left: 2px;
    animation: starTwinkle 2.8s ease-in-out infinite 0.7s;
  }
  .footer-moon-wrapper .moon-stars .star.s3 {
    width: 1px; height: 1px;
    top: 8px; left: -2px;
    animation: starTwinkle 3.5s ease-in-out infinite 1.4s;
  }

  @keyframes moonPhaseShadow {
    0%   { box-shadow: inset -22px 0 0 0 rgba(15,15,26,0.85); }
    12%  { box-shadow: inset -11px 0 0 0 rgba(15,15,26,0.85); }
    25%  { box-shadow: inset 0px 0 0 0 rgba(15,15,26,0.85); }
    38%  { box-shadow: inset 11px 0 0 0 rgba(15,15,26,0.85); }
    50%  { box-shadow: inset 22px 0 0 0 rgba(15,15,26,0.85); }
    62%  { box-shadow: inset 11px 0 0 0 rgba(15,15,26,0.85); }
    75%  { box-shadow: inset 0px 0 0 0 rgba(15,15,26,0.85); }
    88%  { box-shadow: inset -11px 0 0 0 rgba(15,15,26,0.85); }
    100% { box-shadow: inset -22px 0 0 0 rgba(15,15,26,0.85); }
  }
  @keyframes moonPhase {
    0%   { box-shadow: 0 0 6px rgba(255,215,0,0.35), 0 0 12px rgba(255,215,0,0.1); }
    12%  { box-shadow: 0 0 8px rgba(255,215,0,0.5), 0 0 16px rgba(255,215,0,0.15); }
    25%  { box-shadow: 0 0 4px rgba(255,215,0,0.15), 0 0 8px rgba(255,215,0,0.05); }
    38%  { box-shadow: 0 0 8px rgba(255,215,0,0.5), 0 0 16px rgba(255,215,0,0.15); }
    50%  { box-shadow: 0 0 6px rgba(255,215,0,0.35), 0 0 12px rgba(255,215,0,0.1); }
    62%  { box-shadow: 0 0 8px rgba(255,215,0,0.5), 0 0 16px rgba(255,215,0,0.15); }
    75%  { box-shadow: 0 0 4px rgba(255,215,0,0.15), 0 0 8px rgba(255,215,0,0.05); }
    88%  { box-shadow: 0 0 8px rgba(255,215,0,0.5), 0 0 16px rgba(255,215,0,0.15); }
    100% { box-shadow: 0 0 6px rgba(255,215,0,0.35), 0 0 12px rgba(255,215,0,0.1); }
  }
  @keyframes moonAtmosphere {
    0%   { box-shadow: 0 0 0 0 rgba(255,215,0,0); }
    12%  { box-shadow: 0 0 8px 2px rgba(255,215,0,0.15); }
    25%  { box-shadow: 0 0 0 0 rgba(255,215,0,0); }
    38%  { box-shadow: 0 0 8px 2px rgba(255,215,0,0.15); }
    50%  { box-shadow: 0 0 0 0 rgba(255,215,0,0); }
    62%  { box-shadow: 0 0 8px 2px rgba(255,215,0,0.15); }
    75%  { box-shadow: 0 0 0 0 rgba(255,215,0,0); }
    88%  { box-shadow: 0 0 8px 2px rgba(255,215,0,0.15); }
    100% { box-shadow: 0 0 0 0 rgba(255,215,0,0); }
  }
  @keyframes starTwinkle {
    0%, 100% { opacity: 0.2; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); box-shadow: 0 0 4px rgba(255,255,255,0.5); }
  }

  .user-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: rgba(255,255,255,0.03);
    border-radius: 10px;
    margin-bottom: 8px;
    border: 1px solid rgba(255,255,255,0.04);
  }
  .user-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .user-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--luna-text);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .logout-btn {
    background: transparent;
    border: none;
    color: var(--luna-text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }
  .logout-btn:hover {
    background: rgba(239, 68, 68, 0.1);
    color: #fca5a5;
  }
  .mobile-overlay {
    display: none;
  }
  .mobile-toggle {
    display: none;
  }

  /* v8.4-fix: Session search box */
  .search-sessions {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    margin: 8px 12px 4px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
    transition: all 0.2s;
  }
  .search-sessions:focus-within {
    border-color: var(--luna-accent);
    background: rgba(255,255,255,0.06);
  }
  .search-sessions svg {
    flex-shrink: 0;
    color: var(--luna-text-secondary);
  }
  .search-sessions input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--luna-text);
    font-size: 13px;
    padding: 0;
  }
  .search-sessions input::placeholder {
    color: var(--luna-text-secondary);
  }
  .search-clear {
    background: transparent;
    border: none;
    color: var(--luna-text-secondary);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 2px;
    border-radius: 4px;
  }
  .search-clear:hover {
    color: var(--luna-text);
  }

  @media (max-width: 768px) {
    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      z-index: 40;
      transform: translateX(-100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .sidebar.mobile-open {
      transform: translateX(0);
    }
    .mobile-overlay {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 35;
    }
    .mobile-toggle {
      display: flex;
      position: fixed;
      top: 12px;
      left: 12px;
      z-index: 30;
      background: var(--luna-surface);
      border: 1px solid var(--luna-border);
      color: var(--luna-text);
      padding: 8px;
      border-radius: 8px;
      cursor: pointer;
    }
  }
</style>
