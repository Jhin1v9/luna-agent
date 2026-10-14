<script>
  import { onMount } from 'svelte';
  import { Wrench, AlertTriangle } from 'lucide-svelte';
  import LeadDashboardModal from './LeadDashboardModal.svelte';
  import TaskDashboardModal from './TaskDashboardModal.svelte';
  import FinanceDashboardModal from './FinanceDashboardModal.svelte';
  import VotingDashboardModal from './VotingDashboardModal.svelte';

  let leadModalOpen = false;
  let taskModalOpen = false;
  let financeModalOpen = false;
  let votingModalOpen = false;
  let stats = {
    leads: { total: 0, value: 0, recent: 0 },
    tasks: { total: 0, pending: 0, highPriority: 0 },
    finance: { balance: 0, monthlyIncome: 0, monthlyExpenses: 0, activeClients: 0, overduePayments: 0 },
    voting: { total: 0, open: 0 }
  };
  let loading = true;
  let error = false;
  let retryCount = 0;

  function fmt(val, prefix = '', suffix = '') {
    if (error || loading) return '—';
    return prefix + val + suffix;
  }

  async function loadStats() {
    try {
      const res = await fetch('api/tools/stats');
      const data = await res.json();
      if (data.ok && data.stats) {
        stats = data.stats;
        error = false;
        retryCount = 0;
      } else {
        error = true;
        console.warn('[ToolsPanel] stats not ok:', data.error || 'unknown');
        // Retry up to 3 times
        if (retryCount < 3) {
          retryCount++;
          setTimeout(loadStats, 3000);
        }
      }
    } catch (e) {
      error = true;
      console.error('[ToolsPanel] Stats fetch error:', e);
      if (retryCount < 3) {
        retryCount++;
        setTimeout(loadStats, 3000);
      }
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadStats();
  });
</script>

<div class="tools-panel">
  <div class="tools-header">
    <span class="tools-icon"><Wrench size={16} strokeWidth={1.5} /></span>
    <span class="tools-title">Ferramentas do Dashboard</span>
    {#if error}
      <span class="tools-error" title="Dashboard PRO temporariamente indisponível. Tentando reconectar..."><AlertTriangle size={16} strokeWidth={1.5} /></span>
    {:else if loading}
      <span class="tools-loading"></span>
    {/if}
  </div>
  
  <div class="tools-grid">
    <!-- Lead Card -->
    <button class="tool-card leads" on:click={() => leadModalOpen = true}>
      <div class="tool-card-glow"></div>
      <div class="tool-card-content">
        <div class="tool-card-header">
          <div class="tool-icon-bg">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="8.5" cy="7" r="4"/>
              <line x1="20" y1="8" x2="20" y2="14"/>
              <line x1="23" y1="11" x2="17" y2="11"/>
            </svg>
          </div>
          <div class="tool-badge">{fmt(stats.leads.total)}</div>
        </div>
        <div class="tool-name">Leads</div>
        <div class="tool-desc">CRM com pipeline completo</div>
        <div class="tool-stats-row">
          <span class="tool-stat">
            <span class="tool-stat-value">{fmt(stats.leads.recent)}</span>
            <span class="tool-stat-label">novos</span>
          </span>
          <span class="tool-stat">
            <span class="tool-stat-value">{fmt((stats.leads.value / 1000).toFixed(0), 'R$ ', 'k')}</span>
            <span class="tool-stat-label">pipeline</span>
          </span>
        </div>
      </div>
    </button>

    <!-- Task Card -->
    <button class="tool-card tasks" on:click={() => taskModalOpen = true}>
      <div class="tool-card-glow"></div>
      <div class="tool-card-content">
        <div class="tool-card-header">
          <div class="tool-icon-bg">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
            </svg>
          </div>
          <div class="tool-badge">{fmt(stats.tasks.total)}</div>
        </div>
        <div class="tool-name">Tarefas</div>
        <div class="tool-desc">Gestão de operações</div>
        <div class="tool-stats-row">
          <span class="tool-stat">
            <span class="tool-stat-value">{fmt(stats.tasks.pending)}</span>
            <span class="tool-stat-label">pendentes</span>
          </span>
          <span class="tool-stat">
            <span class="tool-stat-value" style="color: #ef4444">{fmt(stats.tasks.highPriority)}</span>
            <span class="tool-stat-label">alta prioridade</span>
          </span>
        </div>
      </div>
    </button>

    <!-- Finance Card -->
    <button class="tool-card finance" on:click={() => financeModalOpen = true}>
      <div class="tool-card-glow"></div>
      <div class="tool-card-content">
        <div class="tool-card-header">
          <div class="tool-icon-bg">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <div class="tool-badge">{fmt(stats.finance.activeClients)}</div>
        </div>
        <div class="tool-name">Financeiro</div>
        <div class="tool-desc">Caixa, gastos e receitas</div>
        <div class="tool-stats-row">
          <span class="tool-stat">
            <span class="tool-stat-value" style="color: {(!error && stats.finance.balance >= 0) ? '#22c55e' : '#ef4444'}">
              {fmt(stats.finance.balance.toFixed(0), '€ ')}
            </span>
            <span class="tool-stat-label">caixa</span>
          </span>
          <span class="tool-stat">
            <span class="tool-stat-value" style="color: #ef4444">{fmt(stats.finance.monthlyExpenses.toFixed(0), '€ ')}</span>
            <span class="tool-stat-label">gastos/mês</span>
          </span>
        </div>
      </div>
    </button>

    <!-- Voting Card -->
    <button class="tool-card voting" on:click={() => votingModalOpen = true}>
      <div class="tool-card-glow"></div>
      <div class="tool-card-content">
        <div class="tool-card-header">
          <div class="tool-icon-bg">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20V10"/>
              <path d="M18 20V4"/>
              <path d="M6 20v-4"/>
            </svg>
          </div>
          <div class="tool-badge">{fmt(stats.voting.open)}</div>
        </div>
        <div class="tool-name">Votações</div>
        <div class="tool-desc">Decisões da diretoria</div>
        <div class="tool-stats-row">
          <span class="tool-stat">
            <span class="tool-stat-value">{fmt(stats.voting.total)}</span>
            <span class="tool-stat-label">total</span>
          </span>
          <span class="tool-stat">
            <span class="tool-stat-value" style="color: #22c55e">{fmt(stats.voting.open)}</span>
            <span class="tool-stat-label">ativas</span>
          </span>
        </div>
      </div>
    </button>
  </div>
</div>

<LeadDashboardModal open={leadModalOpen} onClose={() => leadModalOpen = false} />
<TaskDashboardModal open={taskModalOpen} onClose={() => taskModalOpen = false} />
<FinanceDashboardModal open={financeModalOpen} onClose={() => financeModalOpen = false} />
<VotingDashboardModal open={votingModalOpen} onClose={() => votingModalOpen = false} />

<style>
  .tools-panel {
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
  }
  .tools-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 20px;
    padding: 0 4px;
  }
  .tools-icon {
    font-size: 18px;
  }
  .tools-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--luna-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .tools-error {
    margin-left: auto;
    font-size: 14px;
    cursor: help;
    opacity: 0.8;
    animation: pulse-error 2s infinite;
  }
  @keyframes pulse-error {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }
  .tools-loading {
    margin-left: auto;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.1);
    border-top-color: var(--luna-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .tools-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }
  .tool-card {
    position: relative;
    background: linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 16px;
    padding: 0;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
  }
  .tool-card:hover {
    transform: translateY(-4px);
    border-color: rgba(255,255,255,0.12);
    box-shadow: 0 16px 48px rgba(0,0,0,0.3);
  }
  .tool-card-glow {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 0.4s ease;
    pointer-events: none;
    border-radius: 16px;
  }
  .tool-card.leads .tool-card-glow {
    background: radial-gradient(circle at 80% 20%, rgba(168,85,247,0.12) 0%, transparent 60%);
  }
  .tool-card.tasks .tool-card-glow {
    background: radial-gradient(circle at 80% 20%, rgba(6,182,212,0.12) 0%, transparent 60%);
  }
  .tool-card.finance .tool-card-glow {
    background: radial-gradient(circle at 80% 20%, rgba(245,158,11,0.12) 0%, transparent 60%);
  }
  .tool-card.voting .tool-card-glow {
    background: radial-gradient(circle at 80% 20%, rgba(74,222,128,0.12) 0%, transparent 60%);
  }
  .tool-card:hover .tool-card-glow {
    opacity: 1;
  }
  .tool-card-content {
    position: relative;
    z-index: 1;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tool-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tool-icon-bg {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.04);
    color: var(--luna-text);
    transition: all 0.3s ease;
  }
  .tool-card.leads:hover .tool-icon-bg {
    background: rgba(168,85,247,0.15);
    color: #a855f7;
    box-shadow: 0 0 20px rgba(168,85,247,0.2);
  }
  .tool-card.tasks:hover .tool-icon-bg {
    background: rgba(6,182,212,0.15);
    color: #06b6d4;
    box-shadow: 0 0 20px rgba(6,182,212,0.2);
  }
  .tool-card.finance:hover .tool-icon-bg {
    background: rgba(245,158,11,0.15);
    color: #f59e0b;
    box-shadow: 0 0 20px rgba(245,158,11,0.2);
  }
  .tool-card.voting:hover .tool-icon-bg {
    background: rgba(74,222,128,0.15);
    color: #4ade80;
    box-shadow: 0 0 20px rgba(74,222,128,0.2);
  }
  .tool-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 20px;
    background: rgba(255,255,255,0.06);
    color: var(--luna-text-secondary);
  }
  .tool-badge.soon {
    font-size: 10px;
    opacity: 0.6;
  }
  .tool-name {
    font-size: 16px;
    font-weight: 600;
    color: var(--luna-text);
  }
  .tool-desc {
    font-size: 13px;
    color: var(--luna-text-secondary);
    line-height: 1.4;
  }
  .tool-stats-row {
    display: flex;
    gap: 16px;
    margin-top: 4px;
    padding-top: 12px;
    border-top: 1px solid rgba(255,255,255,0.04);
  }
  .tool-stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tool-stat-value {
    font-size: 18px;
    font-weight: 700;
    color: var(--luna-text);
    font-family: 'JetBrains Mono', monospace;
  }
  .tool-stat-label {
    font-size: 11px;
    color: var(--luna-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  @media (max-width: 640px) {
    .tools-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
