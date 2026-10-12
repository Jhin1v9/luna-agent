<script>
  import { onMount } from 'svelte';
  import { DollarSign, BarChart3, Users } from 'lucide-svelte';
  
  export let open = false;
  export let onClose = () => {};
  
  let finance = null;
  let loading = true;
  let error = false;
  
  async function loadData() {
    loading = true;
    error = false;
    try {
      const res = await fetch('/api/tools/finance');
      const data = await res.json();
      if (data.ok && data.finance) {
        finance = data.finance;
      } else {
        error = true;
      }
    } catch (e) {
      console.error(e);
      error = true;
    } finally {
      loading = false;
    }
  }
  
  $: if (open) loadData();
  
  function fmtMoney(val) {
    if (val === undefined || val === null) return '—';
    return '€ ' + Number(val).toFixed(2);
  }
  
  function handleKeydown(e) {
    if (e.key === 'Escape') onClose();
  }
</script>

{#if open}
<div class="modal-backdrop" on:click={onClose} on:keydown={handleKeydown} tabindex="0" role="dialog" aria-modal="true">
  <div class="modal-content finance-modal" on:click|stopPropagation>
    <div class="modal-header">
      <div class="modal-title-row">
        <div class="modal-icon" style="background: rgba(245,158,11,0.15); color: #f59e0b;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="1" x2="12" y2="23"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
        </div>
        <div>
          <h2 class="modal-title">Financeiro</h2>
          <p class="modal-subtitle">Caixa, receitas e despesas</p>
        </div>
      </div>
      <button class="modal-close" on:click={onClose} aria-label="Fechar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    
    <div class="modal-body">
      {#if loading}
        <div class="modal-loading">
          <div class="spinner" style="border-color: rgba(245,158,11,0.2); border-top-color: #f59e0b;"></div>
          <span>Carregando dados financeiros...</span>
        </div>
      {:else if error || !finance}
        <div class="modal-empty">
          <span style="display: inline-flex; color: #f59e0b;"><DollarSign size={32} strokeWidth={1.5} /></span>
          <p>Não foi possível carregar os dados financeiros.</p>
          <button class="btn-primary" style="background: #f59e0b;" on:click={loadData}>Tentar novamente</button>
        </div>
      {:else}
        <!-- Summary Cards -->
        <div class="finance-summary">
          <div class="summary-card" class:negative={finance.balance < 0}>
            <span class="summary-label">Saldo em Caixa</span>
            <span class="summary-value">{fmtMoney(finance.balance)}</span>
          </div>
          <div class="summary-card income">
            <span class="summary-label">Receitas/Mês</span>
            <span class="summary-value">{fmtMoney(finance.monthlyIncome)}</span>
          </div>
          <div class="summary-card expense">
            <span class="summary-label">Despesas/Mês</span>
            <span class="summary-value">{fmtMoney(finance.monthlyExpenses)}</span>
          </div>
        </div>
        
        <!-- Details Grid -->
        <div class="finance-details">
          <div class="detail-section">
            <h3><BarChart3 size={18} strokeWidth={1.5} /> Expectativa de Receitas</h3>
            <div class="detail-row">
              <span>Total Esperado</span>
              <span class="detail-value">{fmtMoney(finance.totalExpected)}</span>
            </div>
            <div class="detail-row">
              <span>Total Recebido</span>
              <span class="detail-value" style="color: #22c55e;">{fmtMoney(finance.totalReceived)}</span>
            </div>
            <div class="detail-row">
              <span>Pendente</span>
              <span class="detail-value" style="color: #f59e0b;">{fmtMoney(finance.totalPending)}</span>
            </div>
          </div>
          
          <div class="detail-section">
            <h3><Users size={18} strokeWidth={1.5} /> Clientes</h3>
            <div class="detail-row">
              <span>Clientes Ativos</span>
              <span class="detail-value">{finance.activeClients}</span>
            </div>
            <div class="detail-row">
              <span>Pagamentos em Atraso</span>
              <span class="detail-value" style="color: {finance.overduePayments > 0 ? '#ef4444' : '#22c55e'};">{finance.overduePayments}</span>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(0.5rem);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: clamp(0.5rem, 2vw, 1.25rem);
  }
  .modal-content {
    background: linear-gradient(145deg, #1a1a2e 0%, #0f0f1a 100%);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: clamp(0.75rem, 2vw, 1.25rem);
    width: 100%;
    max-width: min(40rem, 90vw);
    max-height: 85vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 1.5rem 5rem rgba(0,0,0,0.6);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: clamp(0.75rem, 2vw, 1.25rem) clamp(1rem, 3vw, 1.5rem);
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .modal-title-row {
    display: flex;
    align-items: center;
    gap: clamp(0.5rem, 1.5vw, 0.875rem);
  }
  .modal-icon {
    width: clamp(2rem, 5vw, 2.625rem);
    height: clamp(2rem, 5vw, 2.625rem);
    border-radius: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .modal-icon svg {
    width: clamp(1rem, 3vw, 1.375rem);
    height: clamp(1rem, 3vw, 1.375rem);
  }
  .modal-title {
    font-size: clamp(1rem, 2.5vw, 1.125rem);
    font-weight: 700;
    color: var(--luna-text);
    margin: 0;
  }
  .modal-subtitle {
    font-size: clamp(0.75rem, 2vw, 0.8125rem);
    color: var(--luna-text-secondary);
    margin: 0.125rem 0 0;
  }
  .modal-close {
    width: clamp(1.75rem, 4vw, 2.125rem);
    height: clamp(1.75rem, 4vw, 2.125rem);
    border-radius: 0.625rem;
    border: none;
    background: rgba(255,255,255,0.05);
    color: var(--luna-text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    flex-shrink: 0;
  }
  .modal-close:hover {
    background: rgba(239,68,68,0.15);
    color: #ef4444;
  }
  .modal-body {
    padding: clamp(1rem, 3vw, 1.5rem);
    overflow-y: auto;
    flex: 1;
  }
  .modal-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: clamp(1.5rem, 5vw, 2.5rem);
    color: var(--luna-text-secondary);
  }
  .modal-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: clamp(1.5rem, 5vw, 2.5rem);
    color: var(--luna-text-secondary);
    text-align: center;
  }
  .spinner {
    width: clamp(1.5rem, 4vw, 1.75rem);
    height: clamp(1.5rem, 4vw, 1.75rem);
    border: 0.2rem solid;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  
  .finance-summary {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: clamp(0.5rem, 1.5vw, 0.75rem);
    margin-bottom: clamp(1rem, 3vw, 1.5rem);
  }
  .summary-card {
    background: linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 0.875rem;
    padding: clamp(0.75rem, 2vw, 1rem);
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .summary-card.negative .summary-value {
    color: #ef4444;
  }
  .summary-card.income .summary-value {
    color: #22c55e;
  }
  .summary-card.expense .summary-value {
    color: #ef4444;
  }
  .summary-label {
    font-size: clamp(0.625rem, 1.5vw, 0.75rem);
    color: var(--luna-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .summary-value {
    font-size: clamp(1rem, 2.5vw, 1.25rem);
    font-weight: 700;
    color: var(--luna-text);
  }
  
  .finance-details {
    display: flex;
    flex-direction: column;
    gap: clamp(0.75rem, 2vw, 1rem);
  }
  .detail-section {
    background: linear-gradient(145deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 0.875rem;
    padding: clamp(0.875rem, 2.5vw, 1.125rem);
  }
  .detail-section h3 {
    font-size: clamp(0.8125rem, 2vw, 0.875rem);
    font-weight: 600;
    color: var(--luna-text);
    margin: 0 0 0.75rem;
  }
  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-size: clamp(0.8125rem, 2vw, 0.875rem);
  }
  .detail-row:last-child {
    border-bottom: none;
  }
  .detail-row span:first-child {
    color: var(--luna-text-secondary);
  }
  .detail-value {
    font-weight: 600;
    color: var(--luna-text);
  }
  
  .btn-primary {
    padding: 0.625rem 1.25rem;
    border-radius: 0.625rem;
    border: none;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
    font-size: clamp(0.8125rem, 2vw, 0.875rem);
  }
  .btn-primary:hover {
    opacity: 0.9;
  }
  
  @media (max-width: 40rem) {
    .finance-summary {
      grid-template-columns: 1fr;
    }
  }

</style>
