<script>
  import { currentMode, MODE_COLORS, currentProvider } from '../stores.js';
  import { onMount } from 'svelte';
  import { Moon, Globe, MessageSquare, Zap, Brain } from 'lucide-svelte';
  import { fetchProviders } from '../api.js';
  import ToolsPanel from './ToolsPanel.svelte';
  import LeadDashboardModal from './LeadDashboardModal.svelte';
  import TaskDashboardModal from './TaskDashboardModal.svelte';

  export let sessions = [];
  export let onNewSession = () => {};
  export let onSelectSession = (id) => {};

  $: theme = MODE_COLORS[$currentMode] || MODE_COLORS.thinking;
  $: recentSessions = [...sessions].sort((a, b) =>
    new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  ).slice(0, 6);

  let mounted = false;
  let showLeadsModal = false;
  let showTasksModal = false;

  // Provider selector state
  let providers = [];
  let providerDropdownOpen = false;
  let providerLoading = false;

  onMount(async () => {
    mounted = true;
    try {
      const res = await fetchProviders();
      if (res.ok && res.providers) providers = res.providers;
    } catch (e) {
      console.error('Failed to load providers on welcome screen:', e);
    }
  });

  $: currentProviderName = providers.find(p => p.name === $currentProvider)?.displayName || $currentProvider;

  function selectProvider(providerId) {
    const id = typeof providerId === 'string' ? providerId : 'kimi';
    if (id === $currentProvider) {
      providerDropdownOpen = false;
      return;
    }
    currentProvider.set(id);
    providerDropdownOpen = false;
  }

  function handleClickOutside(e) {
    if (providerDropdownOpen && !e.target.closest('.welcome-provider-wrapper')) {
      providerDropdownOpen = false;
    }
  }
</script>

<svelte:window on:click={handleClickOutside} />

<div class="welcome-screen" style="--accent: {theme.primary}; --glow: {theme.glow}">
  <div class="welcome-content" class:mounted>
    <!-- Tools Panel -->
    <ToolsPanel 
      onLeads={() => showLeadsModal = true}
      onTasks={() => showTasksModal = true}
    />

    <!-- Logo -->
    <div class="welcome-logo">
      <span class="logo-moon"><Moon size={56} strokeWidth={1.5} /></span>
      <h1 class="welcome-title moon-glow">LUNA</h1>
      <p class="welcome-subtitle">Seu assistente autônomo inteligente</p>
    </div>

    <!-- Provider Selector -->
    <div class="welcome-provider-wrapper">
      <button
        class="welcome-provider-btn"
        on:click|stopPropagation={() => providerDropdownOpen = !providerDropdownOpen}
        disabled={providerLoading}
        title="Provider: {currentProviderName}"
      >
        <span class="welcome-provider-emoji"><Globe size={15} strokeWidth={1.5} /></span>
        <span class="welcome-provider-name">{currentProviderName}</span>
        <svg class="welcome-provider-chevron" class:open={providerDropdownOpen} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {#if providerDropdownOpen}
        <div class="welcome-provider-dropdown">
          {#each providers as p}
            <button
              class="welcome-provider-option"
              class:active={$currentProvider === p.name}
              on:click={() => selectProvider(p.name)}
            >
              <span class="welcome-provider-option-name">{p.displayName || p.name}</span>
            </button>
          {:else}
            <div class="welcome-provider-empty">Nenhum provider encontrado</div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Main CTA -->
    <button class="new-chat-btn" on:click={() => onNewSession($currentProvider)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span>Nova Conversa</span>
      <kbd class="shortcut">Ctrl K</kbd>
    </button>

    <!-- Recent Sessions -->
    {#if recentSessions.length > 0}
      <div class="recent-section">
        <h3 class="recent-title"><MessageSquare size={16} strokeWidth={1.5} /> Conversas recentes</h3>
        <div class="recent-list">
          {#each recentSessions as session (session.id)}
            <button
              class="recent-item"
              on:click={() => onSelectSession(session.id)}
            >
              <span class="recent-dot" style="background: {session.mode && MODE_COLORS[session.mode] ? MODE_COLORS[session.mode].primary : theme.primary}"></span>
              <span class="recent-name">{session.title || 'Sem título'}</span>
              <span class="recent-time">{new Date(session.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Tips -->
    <div class="tips-section">
      <div class="tip-card">
        <span class="tip-icon"><Zap size={20} strokeWidth={1.5} /></span>
        <div class="tip-text">
          <strong>Modo Instant <span class="badge-recommended">Recomendado</span></strong>
          <span>Respostas rápidas sem raciocínio</span>
        </div>
      </div>
      <div class="tip-card">
        <span class="tip-icon"><Brain size={20} strokeWidth={1.5} /></span>
        <div class="tip-text">
          <strong>Modo Thinking</strong>
          <span>Raciocínio passo a passo</span>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Modals - rendered outside welcome-content to avoid transform context breaking position:fixed -->
<LeadDashboardModal open={showLeadsModal} onClose={() => showLeadsModal = false} />
<TaskDashboardModal open={showTasksModal} onClose={() => showTasksModal = false} />

<style>
  .welcome-screen {
    flex: 1;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 24px;
    overflow-y: auto;
    background: transparent;
    position: relative;
  }
  .welcome-screen::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at 50% 30%, rgba(168,85,247,0.08) 0%, transparent 60%);
    animation: welcomeGlow 8s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes welcomeGlow {
    0%, 100% { opacity: 0.5; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.1); }
  }

  .welcome-content {
    max-width: 560px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 28px;
    opacity: 0;
    transition: opacity 0.6s ease;
  }
  .welcome-content.mounted {
    opacity: 1;
  }

  .welcome-logo {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .logo-moon {
    font-size: 56px;
    line-height: 1;
    filter: drop-shadow(0 0 24px var(--glow));
    animation: float 3s ease-in-out infinite;
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }
  .welcome-title {
    font-size: 42px;
    font-weight: 800;
    color: var(--luna-text);
    letter-spacing: 4px;
    margin: 0;
    background: linear-gradient(135deg, var(--luna-text) 0%, var(--accent) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .moon-glow {
    background: linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 40%, #94a3b8 70%, #e2e8f0 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    filter: drop-shadow(0 0 12px rgba(226, 232, 240, 0.45)) drop-shadow(0 0 30px rgba(148, 163, 184, 0.25));
    animation: moonPulse 4s ease-in-out infinite;
  }
  @keyframes moonPulse {
    0%, 100% { filter: drop-shadow(0 0 12px rgba(226, 232, 240, 0.4)) drop-shadow(0 0 30px rgba(148, 163, 184, 0.2)); }
    50% { filter: drop-shadow(0 0 20px rgba(226, 232, 240, 0.7)) drop-shadow(0 0 50px rgba(148, 163, 184, 0.4)); }
  }
  .welcome-subtitle {
    font-size: 15px;
    color: var(--luna-text-secondary);
    margin: 0;
    font-weight: 400;
  }

  .new-chat-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 28px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 14px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 4px 24px var(--glow);
    width: 100%;
    max-width: 320px;
    justify-content: center;
    position: relative;
  }
  .new-chat-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 32px var(--glow);
    filter: brightness(1.1);
  }
  .new-chat-btn:active {
    transform: translateY(0);
  }
  .shortcut {
    position: absolute;
    right: 14px;
    font-size: 11px;
    font-weight: 500;
    opacity: 0.7;
    font-family: 'JetBrains Mono', monospace;
    background: rgba(255,255,255,0.15);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .recent-section {
    width: 100%;
  }
  .recent-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--luna-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 12px 0;
    padding-left: 4px;
  }
  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .recent-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(18, 18, 31, 0.55);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    color: var(--luna-text);
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
    width: 100%;
  }
  .recent-item:hover {
    background: rgba(255,255,255,0.04);
    border-color: var(--accent);
    transform: translateX(4px);
  }
  .recent-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .recent-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }
  .recent-time {
    font-size: 11px;
    color: var(--luna-text-secondary);
    font-family: 'JetBrains Mono', monospace;
    flex-shrink: 0;
  }

  .tips-section {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    width: 100%;
  }
  .tip-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 14px;
    background: rgba(18, 18, 31, 0.55);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    transition: all 0.15s ease;
    animation: tipFloat 6s ease-in-out infinite;
  }
  .tip-card:nth-child(2) { animation-delay: -2s; }
  .tip-card:nth-child(3) { animation-delay: -4s; }
  @keyframes tipFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }
  .tip-card:hover {
    border-color: var(--accent);
    background: rgba(255,255,255,0.03);
  }
  .tip-icon {
    font-size: 20px;
    line-height: 1;
    flex-shrink: 0;
  }
  .tip-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tip-text strong {
    font-size: 13px;
    color: var(--luna-text);
    font-weight: 600;
  }
  .tip-text span {
    font-size: 12px;
    color: var(--luna-text-secondary);
  }

  .badge-recommended {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    background: linear-gradient(135deg, #10b981, #059669);
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    border-radius: 999px;
    white-space: nowrap;
    box-shadow: 0 0 8px rgba(16,185,129,0.35);
    animation: pulse-badge 2s ease-in-out infinite;
    margin-left: 4px;
    vertical-align: middle;
  }
  @keyframes pulse-badge {
    0%, 100% { box-shadow: 0 0 6px rgba(16,185,129,0.3); }
    50% { box-shadow: 0 0 12px rgba(16,185,129,0.6); }
  }
  /* ── Provider Selector on Welcome Screen ── */
  .welcome-provider-wrapper {
    position: relative;
    margin-bottom: 12px;
  }
  .welcome-provider-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 12px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    color: var(--luna-text-secondary, #94a3b8);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }
  .welcome-provider-btn:hover:not(:disabled) {
    background: rgba(255,255,255,0.09);
    border-color: var(--accent);
    color: var(--accent);
  }
  .welcome-provider-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .welcome-provider-emoji {
    font-size: 0.95rem;
  }
  .welcome-provider-name {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .welcome-provider-chevron {
    transition: transform 0.2s ease;
    opacity: 0.6;
  }
  .welcome-provider-chevron.open {
    transform: rotate(180deg);
  }
  .welcome-provider-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    min-width: 170px;
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
  .welcome-provider-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 8px 10px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--luna-text, #e2e8f0);
    font-size: 0.85rem;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease;
  }
  .welcome-provider-option:hover {
    background: rgba(255,255,255,0.06);
  }
  .welcome-provider-option.active {
    background: rgba(255,255,255,0.1);
    color: var(--accent);
  }
  .welcome-provider-empty {
    padding: 10px;
    color: var(--luna-text-secondary);
    font-size: 0.8rem;
    text-align: center;
  }
  @keyframes dropdownIn {
    from { opacity: 0; transform: translateX(-50%) translateY(-6px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  @media (max-width: 640px) {
    .welcome-title { font-size: 32px; }
    .tips-section { grid-template-columns: 1fr; }
    .new-chat-btn { max-width: 100%; }
    .shortcut { display: none; }
  }
</style>
