<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { Zap, Brain, Globe, Drama } from 'lucide-svelte';
  import { lunaStore, MODE_COLORS } from '../stores.js';
  import { fetchPersonas, setSessionPersona, setSessionProvider, fetchProviders, compactSession } from '../api.js';

  const dispatch = createEventDispatcher();

  // ── Props ──
  export let title = 'Nova Conversa';
  export let mode = 'instant';
  export let provider = 'kimi';
  $: safeProvider = typeof provider === 'string' ? provider : 'kimi';
  export let isStreaming = false;
  export let sessionId = null;
  export let isSidebarOpen = false;
  export let isMobile = false;
  export let currentPersona = 'default';

  // ── Mode Switch ──
  const modes = [
    { id: 'instant', label: 'Instant', icon: Zap },
    { id: 'thinking', label: 'Thinking', icon: Brain },
  ];

  function setMode(m) {
    if (m === mode) return;
    dispatch('modeChange', m);
  }

  // ── Persona Selector ──
  let personas = [];
  let personaLoading = false;
  let personaDropdownOpen = false;

  // ── Provider Selector ──
  let providers = [];
  let providerLoading = false;
  let providerDropdownOpen = false;

  onMount(async () => {
    try {
      const [personaData, providerData] = await Promise.all([fetchPersonas(), fetchProviders()]);
      if (personaData.ok && personaData.personas) personas = personaData.personas;
      if (providerData.ok && providerData.providers) providers = providerData.providers;
    } catch (e) {
      console.error('Failed to load header data:', e);
    }
  });

  async function selectPersona(personaId) {
    if (!sessionId || personaId === currentPersona) {
      personaDropdownOpen = false;
      return;
    }
    personaLoading = true;
    try {
      const res = await setSessionPersona(sessionId, personaId);
      if (res.ok) {
        currentPersona = personaId;
        dispatch('personaChange', personaId);
      }
    } catch (e) {
      console.error('Failed to set persona:', e);
    } finally {
      personaLoading = false;
      personaDropdownOpen = false;
    }
  }

  async function selectProvider(providerId) {
    const id = typeof providerId === 'string' ? providerId : 'kimi';
    if (id === safeProvider) {
      providerDropdownOpen = false;
      return;
    }
    providerLoading = true;
    try {
      if (sessionId) {
        const res = await setSessionProvider(sessionId, id);
        if (!res.ok) throw new Error(res.error || 'Failed to set provider');
      }
      provider = id;
      dispatch('providerChange', id);
    } catch (e) {
      console.error('Failed to set provider:', e);
    } finally {
      providerLoading = false;
      providerDropdownOpen = false;
    }
  }

  function handleClickOutside(e) {
    if (personaDropdownOpen && !e.target.closest('.persona-wrapper')) {
      personaDropdownOpen = false;
    }
    if (providerDropdownOpen && !e.target.closest('.provider-wrapper')) {
      providerDropdownOpen = false;
    }
  }

  $: currentPersonaName = personas.find(p => p.id === currentPersona)?.name || currentPersona;
  $: currentProviderName = providers.find(p => p.name === safeProvider)?.displayName || safeProvider;
  $: theme = MODE_COLORS[mode] || MODE_COLORS.instant;

  // ── Status ──
  $: statusText = isStreaming
    ? 'Pensando...'
    : $lunaStore.isOnline
      ? 'Online'
      : 'Offline';

  $: statusDot = isStreaming
    ? 'bg-amber-400 animate-pulse'
    : $lunaStore.isOnline
      ? 'bg-emerald-400'
      : 'bg-red-400';

  // ── Actions ──
  function onNewChat()    { dispatch('newChat'); }
  function onOpenConfig() { dispatch('openConfig'); }
  function onClear()      { dispatch('clear'); }
  function onExport()     { dispatch('export'); }
  function onToggleSidebar() { dispatch('toggleSidebar'); }
  function onGoHome()     { dispatch('goHome'); }

  let compacting = false;
  async function onCompact() {
    if (!sessionId || compacting) return;
    compacting = true;
    try {
      await compactSession(sessionId, 'luna-default', (ev) => {
        // Forward compact events to parent (ChatArea) so it can show animation
        dispatch('compactEvent', ev);
      });
    } catch (e) {
      console.error('Compact failed:', e);
      dispatch('compactEvent', { type: 'compact_error', message: e.message });
    } finally {
      compacting = false;
    }
  }
</script>

<svelte:window on:click={handleClickOutside} />

<!-- ═══════════════════════════════════════════════════════════════ -->
<!--  CHAT HEADER — LUNA WEB v3.0                                   -->
<!--  Full-width • Mode Switch • Persona • Functional • Alive        -->
<!-- ═══════════════════════════════════════════════════════════════ -->

<header
  class="chat-header"
  style="--accent: {theme.primary}; --accent-glow: {theme.glow}; --accent-border: {theme.border};"
>
  <!-- Animated top border -->
  <div class="header-glow-line"></div>

  <!-- LEFT: Brand + Title -->
  <div class="header-left">
    <!-- Moon dots — clickable to go home -->
    <button class="moon-dots" on:click={onGoHome} title="Ir para Home">
      <span class="moon-dot md-1"></span>
      <span class="moon-dot md-2"></span>
      <span class="moon-dot md-3"></span>
      <span class="moon-dot md-4"></span>
    </button>

    <!-- Luna Avatar -->
    <div class="avatar-ring" style="--avatar-glow: {theme.glow}">
      <div class="avatar-core">
        <span class="avatar-letter">L</span>
      </div>
      <!-- Orbiting particle -->
      <div class="avatar-orbit"></div>
    </div>

    <!-- Title block -->
    <div class="title-block">
      <h1 class="chat-title luna-moon-title" title={title} on:click={() => dispatch('editTitle')}>
        {#if title && title !== 'Nova Conversa'}
          {title.length > 35 ? title.slice(0, 35) + '…' : title}
        {:else}
          LUNA
        {/if}
      </h1>
      <div class="status-row">
        <span class="status-dot {statusDot}"></span>
        <span class="status-text">{statusText}</span>
        {#if mode}
          <span class="mode-badge" style="color: {theme.primary}; border-color: {theme.border}">
            {theme.name}
          </span>
        {/if}
      </div>
    </div>
  </div>

  <!-- CENTER: Mode Switcher -->
  <div class="header-center">
    <div class="mode-switcher" role="group" aria-label="Modo de raciocínio">
      {#each modes as m}
        <button
          class="mode-btn"
          class:active={mode === m.id}
          on:click={() => setMode(m.id)}
          title={m.label}
          aria-pressed={mode === m.id}
          style={mode === m.id
            ? `background: ${MODE_COLORS[m.id].primary}22; color: ${MODE_COLORS[m.id].primary}; border-color: ${MODE_COLORS[m.id].primary}44; box-shadow: 0 0 12px ${MODE_COLORS[m.id].glow}`
            : ''}
        >
          <span class="mode-icon"><svelte:component this={m.icon} size={14} strokeWidth={1.5} /></span>
          <span class="mode-label">{m.id}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- RIGHT: Actions -->
  <div class="header-right">
    <!-- Provider Selector (integrated) -->
    <div class="provider-wrapper">
      <button
        class="provider-btn"
        on:click|stopPropagation={() => providerDropdownOpen = !providerDropdownOpen}
        disabled={providerLoading}
        title="Provider: {currentProviderName}"
      >
        <span class="provider-emoji"><Globe size={14} strokeWidth={1.5} /></span>
        <span class="provider-name">{currentProviderName}</span>
        <svg class="provider-chevron" class:open={providerDropdownOpen} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {#if providerDropdownOpen}
        <div class="provider-dropdown">
          {#each providers as p}
            <button
              class="provider-option"
              class:active={safeProvider === p.name}
              on:click={() => selectProvider(p.name)}
            >
              <span class="provider-option-name">{p.displayName || p.name}</span>
            </button>
          {:else}
            <div class="provider-empty">Nenhum provider encontrado</div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Persona Selector (integrated) -->
    <div class="persona-wrapper">
      <button
        class="persona-btn"
        on:click|stopPropagation={() => personaDropdownOpen = !personaDropdownOpen}
        disabled={personaLoading || !sessionId}
        title="Personalidade: {currentPersonaName}"
      >
        <span class="persona-emoji"><Drama size={14} strokeWidth={1.5} /></span>
        <span class="persona-name">{currentPersonaName}</span>
        <svg class="persona-chevron" class:open={personaDropdownOpen} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {#if personaDropdownOpen}
        <div class="persona-dropdown">
          {#each personas as persona}
            <button
              class="persona-option"
              class:active={currentPersona === persona.id}
              on:click={() => selectPersona(persona.id)}
            >
              <span class="persona-option-name">{persona.name}</span>
              {#if persona.description}
                <span class="persona-option-desc">{persona.description}</span>
              {/if}
            </button>
          {:else}
            <div class="persona-empty">Nenhuma persona encontrada</div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Compact -->
    <button class="icon-btn" on:click={onCompact} disabled={compacting || !sessionId} title="Compactar contexto" aria-label="Compactar">
      {#if compacting}
        <svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"/>
        </svg>
      {:else}
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/>
        </svg>
      {/if}
    </button>

    <!-- Clear -->
    <button class="icon-btn" on:click={onClear} title="Limpar conversa" aria-label="Limpar">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397M4.772 5.79c.342.052.682.107 1.022.166m1.022-.165l.543 12.695M12 4.5v15"/>
      </svg>
    </button>

    <!-- Export -->
    <button class="icon-btn" on:click={onExport} title="Exportar conversa" aria-label="Exportar">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>
      </svg>
    </button>

    <!-- New Chat -->
    <button class="new-chat-btn" on:click={onNewChat} title="Novo Chat (Ctrl/Cmd+K)">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>
      </svg>
      <span class="new-chat-label">Novo</span>
    </button>

    <!-- Config -->
    <button class="icon-btn config-btn" on:click={onOpenConfig} title="Configurações" aria-label="Configurações">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
      </svg>
    </button>
  </div>
</header>

<style>
  /* ── Base Header ── */
  .chat-header {
    position: relative;
    width: 100%;
    min-height: 64px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1rem;
    gap: 0.75rem;
    background: linear-gradient(135deg, rgba(10,10,26,0.95) 0%, rgba(18,18,35,0.95) 50%, rgba(10,10,26,0.95) 100%);
    border-bottom: 1px solid var(--accent-border, rgba(168,85,247,0.15));
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    flex-shrink: 0;
    z-index: 50;
    overflow: visible;
  }

  @media (min-width: 640px) {
    .chat-header {
      min-height: 72px;
      padding: 0 1.25rem;
      gap: 1rem;
    }
  }

  /* ── Glow Line ── */
  .header-glow-line {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, transparent 0%, var(--accent, #a855f7) 30%, var(--accent, #a855f7) 70%, transparent 100%);
    opacity: 0.6;
    animation: shimmer 4s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%, 100% { opacity: 0.4; transform: scaleX(0.8); }
    50% { opacity: 0.8; transform: scaleX(1); }
  }

  /* ── Left Section ── */
  .header-left {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-shrink: 0;
    min-width: 0;
  }

  /* Moon dots — clickable home nav */
  .moon-dots {
    display: flex;
    align-items: center;
    gap: 3px;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 8px;
    transition: background 0.2s ease;
  }
  .moon-dots:hover {
    background: rgba(255,255,255,0.05);
  }
  .moon-dots:hover .moon-dot {
    filter: brightness(1.3) drop-shadow(0 0 6px rgba(226,232,240,0.6));
  }
  .moon-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%);
    box-shadow: 0 0 4px rgba(226,232,240,0.3);
    transition: all 0.3s ease;
  }
  .md-1 { opacity: 0.4; transform: scale(0.6); }
  .md-2 { opacity: 0.7; transform: scale(0.8); }
  .md-3 { opacity: 1.0; transform: scale(1.0); box-shadow: 0 0 8px rgba(226,232,240,0.5); }
  .md-4 { opacity: 0.7; transform: scale(0.8); }
  @keyframes moonDotFloat {
    0%, 100% { transform: translateY(0) scale(var(--s, 1)); }
    50% { transform: translateY(-3px) scale(var(--s, 1)); }
  }
  .md-1 { animation: moonDotFloat 3s ease-in-out infinite; --s: 0.6; }
  .md-2 { animation: moonDotFloat 3s ease-in-out infinite 0.5s; --s: 0.8; }
  .md-3 { animation: moonDotFloat 3s ease-in-out infinite 1s; --s: 1.0; }
  .md-4 { animation: moonDotFloat 3s ease-in-out infinite 1.5s; --s: 0.8; }

  /* Luna title moon styling */
  .luna-moon-title {
    background: linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 40%, #94a3b8 70%, #e2e8f0 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    filter: drop-shadow(0 0 8px rgba(226, 232, 240, 0.35));
    letter-spacing: 2px;
  }

  .sidebar-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 0.5rem;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    color: var(--luna-text-secondary, #94a3b8);
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }
  .sidebar-toggle:hover {
    background: rgba(255,255,255,0.08);
    border-color: var(--accent-border);
    color: var(--accent);
  }

  /* Avatar */
  .avatar-ring {
    position: relative;
    width: 38px;
    height: 38px;
    flex-shrink: 0;
  }
  .avatar-core {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent, #a855f7) 0%, #1e1b4b 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 16px var(--avatar-glow, rgba(168,85,247,0.3));
    position: relative;
    z-index: 2;
  }
  .avatar-letter {
    color: white;
    font-weight: 800;
    font-size: 1.125rem;
    line-height: 1;
    text-shadow: 0 0 8px rgba(255,255,255,0.3);
  }
  .avatar-orbit {
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    border-top-color: var(--accent, rgba(168,85,247,0.4));
    animation: spin 3s linear infinite;
    z-index: 1;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Title block */
  .title-block {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .chat-title {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--luna-text, #e2e8f0);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 180px;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition: color 0.2s ease;
  }
  .chat-title:hover {
    color: var(--accent);
  }
  @media (min-width: 640px) {
    .chat-title { max-width: 280px; font-size: 1rem; }
  }
  @media (min-width: 1024px) {
    .chat-title { max-width: 400px; }
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 1px;
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    box-shadow: 0 0 6px currentColor;
    flex-shrink: 0;
  }
  .status-text {
    font-size: 0.6875rem;
    color: var(--luna-text-secondary, #94a3b8);
    font-weight: 500;
    letter-spacing: 0.02em;
  }
  .mode-badge {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 4px;
    border: 1px solid;
    background: rgba(255,255,255,0.02);
    flex-shrink: 0;
  }

  /* ── Center Section: Mode Switcher ── */
  .header-center {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    min-width: 0;
  }

  .mode-switcher {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 3px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    backdrop-filter: blur(10px);
  }

  .mode-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border-radius: 9px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--luna-text-secondary, #94a3b8);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
    text-transform: capitalize;
  }
  .mode-btn:hover:not(.active) {
    background: rgba(255,255,255,0.04);
    color: var(--luna-text, #e2e8f0);
  }
  .mode-btn.active {
    cursor: default;
  }
  .mode-icon {
    font-size: 0.8125rem;
    line-height: 1;
  }
  .mode-label {
    display: none;
  }
  @media (min-width: 640px) {
    .mode-label { display: inline; }
    .mode-btn { padding: 6px 14px; font-size: 0.8125rem; }
  }

  /* ── Right Section ── */
  .header-right {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
  }
  @media (min-width: 640px) {
    .header-right { gap: 0.5rem; }
  }

  /* Icon button base */
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    color: var(--luna-text-secondary, #94a3b8);
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }
  .icon-btn:hover {
    background: rgba(255,255,255,0.07);
    border-color: var(--accent-border);
    color: var(--accent);
    box-shadow: 0 0 12px var(--accent-glow);
    transform: translateY(-1px);
  }
  .icon-btn:active {
    transform: scale(0.95) translateY(0);
  }

  /* Config button accent */
  .config-btn:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
    box-shadow: 0 0 16px var(--accent-glow);
  }

  /* New Chat button */
  .new-chat-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border-radius: 10px;
    background: linear-gradient(135deg, var(--accent) 0%, rgba(255,255,255,0.1) 100%);
    background-size: 200% 200%;
    border: 1px solid var(--accent-border);
    color: white;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s ease;
    flex-shrink: 0;
    box-shadow: 0 2px 8px var(--accent-glow);
  }
  .new-chat-btn:hover {
    background-position: 100% 0;
    box-shadow: 0 4px 20px var(--accent-glow);
    transform: translateY(-1px);
  }
  .new-chat-btn:active {
    transform: scale(0.97) translateY(0);
  }
  .new-chat-label {
    display: none;
  }
  @media (min-width: 640px) {
    .new-chat-label { display: inline; }
    .new-chat-btn { padding: 7px 14px; }
  }

  /* ── Persona Selector (integrated) ── */
  .persona-wrapper {
    position: relative;
  }
  .persona-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border-radius: 10px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    color: var(--luna-text-secondary, #94a3b8);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
    max-width: 120px;
  }
  .persona-btn:hover:not(:disabled) {
    background: rgba(255,255,255,0.07);
    border-color: var(--accent-border);
    color: var(--accent);
  }
  .persona-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .persona-emoji {
    font-size: 0.875rem;
    flex-shrink: 0;
  }
  .persona-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 80px;
  }
  .persona-chevron {
    flex-shrink: 0;
    transition: transform 0.2s ease;
    opacity: 0.6;
  }
  .persona-chevron.open {
    transform: rotate(180deg);
  }

  /* Persona dropdown */
  .persona-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 180px;
    max-width: 260px;
    background: linear-gradient(145deg, #1a1a2e 0%, #0f0f1a 100%);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 100;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03);
    animation: dropdownIn 0.15s ease-out;
  }
  @keyframes dropdownIn {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .persona-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 8px 10px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--luna-text, #e2e8f0);
    font-size: 0.8125rem;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: all 0.15s ease;
  }
  .persona-option:hover {
    background: rgba(255,255,255,0.05);
  }
  .persona-option.active {
    background: var(--accent-glow);
    color: var(--accent);
  }
  .persona-option-name {
    font-weight: 600;
  }
  .persona-option-desc {
    font-size: 0.6875rem;
    color: var(--luna-text-secondary, #94a3b8);
    margin-top: 1px;
  }
  .persona-empty {
    padding: 12px;
    color: var(--luna-text-secondary, #94a3b8);
    font-size: 0.8125rem;
    text-align: center;
  }

  /* ── Provider Selector (integrated) ── */
  .provider-wrapper {
    position: relative;
  }
  .provider-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border-radius: 10px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    color: var(--luna-text-secondary, #94a3b8);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
    max-width: 140px;
  }
  .provider-btn:hover:not(:disabled) {
    background: rgba(255,255,255,0.07);
    border-color: var(--accent-border);
    color: var(--accent);
  }
  .provider-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .provider-emoji {
    font-size: 0.875rem;
    flex-shrink: 0;
  }
  .provider-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 90px;
  }
  .provider-chevron {
    flex-shrink: 0;
    transition: transform 0.2s ease;
    opacity: 0.6;
  }
  .provider-chevron.open {
    transform: rotate(180deg);
  }
  .provider-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 160px;
    max-width: 260px;
    background: linear-gradient(145deg, #1a1a2e 0%, #0f0f1a 100%);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 100;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03);
    animation: dropdownIn 0.15s ease-out;
  }
  .provider-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 8px 10px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--luna-text, #e2e8f0);
    font-size: 0.8125rem;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: all 0.15s ease;
  }
  .provider-option:hover {
    background: rgba(255,255,255,0.05);
  }
  .provider-option.active {
    background: var(--accent-glow);
    color: var(--accent);
  }
  .provider-option-name {
    font-weight: 600;
  }
  .provider-empty {
    padding: 12px;
    color: var(--luna-text-secondary, #94a3b8);
    font-size: 0.8125rem;
    text-align: center;
  }

  /* ── Responsive: slim the right group so nothing overflows off-screen ── */
  /* Secondary actions leave the mobile header — still reachable via slash
     commands (/limpar) and the config drawer. */
  @media (max-width: 768px) {
    .header-right .icon-btn[aria-label="Compactar"],
    .header-right .icon-btn[aria-label="Limpar"],
    .header-right .icon-btn[aria-label="Exportar"] { display: none; }
  }
  @media (max-width: 640px) {
    .chat-header { padding: 0 0.5rem; gap: 0.4rem; }
    .persona-name, .persona-chevron { display: none; }
    .persona-btn { padding: 6px 8px; max-width: none; }
  }
  @media (max-width: 480px) {
    .header-center { display: none; }
    .chat-title { max-width: 120px; }
    .provider-name, .provider-chevron { display: none; }
    .provider-btn { padding: 6px 8px; max-width: none; }
    /* every pixel counts on a 360-390px phone: brand dots go (avatar stays,
       home is reachable via the sidebar), icon buttons slim to 32px */
    .moon-dots { display: none; }
    .icon-btn { width: 32px; height: 32px; border-radius: 9px; }
  }
</style>
