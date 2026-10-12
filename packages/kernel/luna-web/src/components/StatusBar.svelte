<script>
  import { planModeState } from '../stores.js';
  import { Search, FileSearch, ClipboardList, CheckCircle, XCircle } from 'lucide-svelte';

  export let status = 'connected';
  export let onOpenConfig = () => {};

  $: statusColor = status === 'connected' ? '#22c55e' : status === 'error' ? '#ef4444' : status === 'reconnecting' ? '#f59e0b' : '#eab308';
  $: statusText = status === 'connected' ? 'Conectado' : status === 'error' ? 'Erro' : status === 'reconnecting' ? 'Reconectando...' : 'Desconectado';

  $: planStatus = $planModeState.active ? $planModeState.status : null;
  $: planStatusConfig = {
    investigating: { text: 'Investigando...', icon: FileSearch, color: '#ffd700' },
    awaiting_approval: { text: 'Aguardando aprovação', icon: ClipboardList, color: '#ffd700' },
    approved: { text: 'Plano aprovado — executando', icon: CheckCircle, color: '#4ade80' },
    rejected: { text: 'Plano rejeitado', icon: XCircle, color: '#fca5a5' },
  }[planStatus] || null;
</script>

<div class="status-bar" role="complementary" aria-label="Barra de status">
  <div class="status-left">
    <span class="status-dot" style="background-color: {statusColor}"></span>
    <span class="status-text">{statusText}</span>
    {#if planStatusConfig}
      <span class="separator">|</span>
      <span class="plan-indicator" style="color: {planStatusConfig.color}">
        <svelte:component this={planStatusConfig.icon} size={12} />
        <span>{planStatusConfig.text}</span>
      </span>
    {/if}
  </div>
  <div class="status-center">
    <span class="version">Luna Kernel v5.0</span>
    <span class="separator">|</span>
    <span class="bot-name">@lunanexobot</span>
  </div>
  <button
    class="config-btn"
    on:click={onOpenConfig}
    aria-label="Configuracoes"
    title="Configuracoes"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  </button>
</div>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 16px;
    background: var(--luna-surface);
    border-top: 1px solid var(--luna-border);
    font-size: 12px;
    color: var(--luna-text-secondary);
    font-family: 'JetBrains Mono', monospace;
    flex-shrink: 0;
    position: relative;
    z-index: 30;
  }
  .status-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .plan-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 500;
    font-size: 11px;
    animation: pulse 2s infinite;
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }
  .status-center {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .separator { opacity: 0.3; }
  .config-btn {
    background: none;
    border: none;
    color: var(--luna-text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
  }
  .config-btn:hover {
    color: var(--luna-text);
    background: rgba(255,255,255,0.04);
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  @media (max-width: 768px) {
    .status-center { display: none; }
  }
</style>
