<script>
  export let onAction = () => {};
  export let disabled = false;

  const actions = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
      prompt: 'Abrir dashboard resumo',
      color: '#60a5fa'
    },
    {
      id: 'tasks',
      label: 'Tarefas',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
      prompt: 'Listar tarefas pendentes',
      color: '#a78bfa'
    },
    {
      id: 'ideas',
      label: 'Ideias',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-7 7c0 2.5 1.5 4.5 3 6v2h8v-2c1.5-1.5 3-3.5 3-6a7 7 0 00-7-7z"/></svg>`,
      prompt: 'Listar ideias do dashboard',
      color: '#fbbf24'
    },
    {
      id: 'finance',
      label: 'Finanças',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>`,
      prompt: 'Resumo financeiro do caixa',
      color: '#34d399'
    },
    {
      id: 'leads',
      label: 'Leads',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,
      prompt: 'Listar leads do dashboard',
      color: '#f472b6'
    },
    {
      id: 'quotes',
      label: 'Orçamentos',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
      prompt: 'Listar orçamentos pendentes',
      color: '#fb923c'
    }
  ];

  function handleClick(action) {
    if (disabled) return;
    onAction(action.prompt);
  }
</script>

<div class="quick-actions-bar" class:disabled>
  <div class="actions-scroll">
    {#each actions as action}
      <button
        class="action-chip"
        on:click={() => handleClick(action)}
        title={action.label}
        disabled={disabled}
        style="--chip-color: {action.color}"
      >
        <span class="action-icon" style="color: {action.color}">
          {@html action.icon}
        </span>
        <span class="action-label">{action.label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .quick-actions-bar {
    background: var(--luna-surface);
    border-top: 1px solid var(--luna-border);
    padding: 8px 16px;
    flex-shrink: 0;
    position: relative;
  }
  .quick-actions-bar.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .actions-scroll {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding-bottom: 2px;
  }
  .actions-scroll::-webkit-scrollbar {
    display: none;
  }
  .action-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--luna-elevated);
    border: 1px solid var(--luna-border);
    border-radius: 20px;
    color: var(--luna-text);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    flex-shrink: 0;
    user-select: none;
  }
  .action-chip:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
    border-color: var(--chip-color);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
  .action-chip:active:not(:disabled) {
    transform: translateY(0);
  }
  .action-chip:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .action-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .action-label {
    color: var(--luna-text-secondary);
    transition: color 0.15s;
  }
  .action-chip:hover:not(:disabled) .action-label {
    color: var(--luna-text);
  }
  @media (max-width: 768px) {
    .quick-actions-bar {
      padding: 6px 12px;
    }
    .action-chip {
      padding: 5px 10px;
      font-size: 12px;
    }
  }
</style>
