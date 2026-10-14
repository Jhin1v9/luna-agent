<script>
  import { onMount } from 'svelte';
  import { Vote, CheckCircle2, XCircle, Hourglass } from 'lucide-svelte';
  
  export let open = false;
  export let onClose = () => {};
  
  let voting = null;
  let loading = true;
  let error = false;
  let filterStatus = 'all';
  
  async function loadData() {
    loading = true;
    error = false;
    try {
      const res = await fetch('api/tools/voting');
      const data = await res.json();
      if (data.ok && data.voting) {
        voting = data.voting;
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
  
  $: filteredSessions = voting?.sessions?.filter(s => {
    if (filterStatus === 'all') return true;
    return s.status === filterStatus;
  }) || [];
  
  function quorumStatus(session) {
    const votes = session.votes || {};
    const totalVoters = Object.keys(votes).length;
    const yesVotes = Object.values(votes).filter(v => v === true).length;
    const noVotes = Object.values(votes).filter(v => v === false).length;
    const pending = totalVoters - yesVotes - noVotes;
    return { totalVoters, yesVotes, noVotes, pending };
  }
  
  function handleKeydown(e) {
    if (e.key === 'Escape') onClose();
  }
</script>

{#if open}
<div class="modal-backdrop" on:click={onClose} on:keydown={handleKeydown} tabindex="0" role="dialog" aria-modal="true">
  <div class="modal-content voting-modal" on:click|stopPropagation>
    <div class="modal-header">
      <div class="modal-title-row">
        <div class="modal-icon" style="background: rgba(74,222,128,0.15); color: #4ade80;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20V10"/>
            <path d="M18 20V4"/>
            <path d="M6 20v-4"/>
          </svg>
        </div>
        <div>
          <h2 class="modal-title">Votações</h2>
          <p class="modal-subtitle">Decisões da diretoria</p>
        </div>
      </div>
      <button class="modal-close" on:click={onClose} aria-label="Fechar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    
    <div class="modal-body">
      {#if loading}
        <div class="modal-loading">
          <div class="spinner" style="border-color: rgba(74,222,128,0.2); border-top-color: #4ade80;"></div>
          <span>Carregando sessões de votação...</span>
        </div>
      {:else if error || !voting}
        <div class="modal-empty">
          <span style="display: inline-flex; color: #4ade80;"><Vote size={32} strokeWidth={1.5} /></span>
          <p>Não foi possível carregar as votações.</p>
          <button class="btn-primary" style="background: #4ade80;" on:click={loadData}>Tentar novamente</button>
        </div>
      {:else}
        <!-- Stats Bar -->
        <div class="voting-stats">
          <div class="vstat">
            <span class="vstat-value">{voting.total}</span>
            <span class="vstat-label">Total</span>
          </div>
          <div class="vstat">
            <span class="vstat-value" style="color: #22c55e;">{voting.open}</span>
            <span class="vstat-label">Abertas</span>
          </div>
          <div class="vstat">
            <span class="vstat-value" style="color: #ef4444;">{voting.closed}</span>
            <span class="vstat-label">Fechadas</span>
          </div>
          <div class="vstat">
            <span class="vstat-value" style="color: #f59e0b;">{voting.voted}</span>
            <span class="vstat-label">Votadas</span>
          </div>
        </div>
        
        <!-- Filters -->
        <div class="filter-bar">
          {#each [['all', 'Todas'], ['open', 'Abertas'], ['closed', 'Fechadas']] as [val, label]}
            <button class="filter-pill" class:active={filterStatus === val} on:click={() => filterStatus = val}>
              {label}
            </button>
          {/each}
        </div>
        
        <!-- Sessions List -->
        <div class="sessions-list">
          {#each filteredSessions as session}
            {@const qs = quorumStatus(session)}
            <div class="session-card" class:open={session.status === 'open'}>
              <div class="session-header">
                <div class="session-title-row">
                  <span class="session-status" class:open={session.status === 'open'}>
                    {session.status === 'open' ? '● Aberta' : '● Fechada'}
                  </span>
                  <span class="session-date">{new Date(session.createdAt).toLocaleDateString('pt-BR')}</span>
                </div>
                <h4 class="session-title">{session.title}</h4>
                {#if session.description}
                  <p class="session-desc">{session.description}</p>
                {/if}
              </div>
              
              <div class="session-quorum">
                <span class="quorum-label">Quorum: {session.quorumRequired} votos necessários</span>
                <div class="quorum-bar">
                  <div class="quorum-fill" style="width: {Math.min((qs.yesVotes / session.quorumRequired) * 100, 100)}%; background: #22c55e;"></div>
                </div>
              </div>
              
              <div class="session-votes">
                {#each Object.entries(session.votes || {}) as [voter, vote]}
                  <div class="vote-pill" class:voted={vote !== null} class:yes={vote === true} class:no={vote === false}>
                    <span class="vote-name">{voter}</span>
                    {#if vote === true}
                      <span class="vote-icon"><CheckCircle2 size={14} strokeWidth={1.5} /></span>
                    {:else if vote === false}
                      <span class="vote-icon"><XCircle size={14} strokeWidth={1.5} /></span>
                    {:else}
                      <span class="vote-icon"><Hourglass size={14} strokeWidth={1.5} /></span>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {:else}
            <div class="modal-empty" style="padding: 30px;">
              <p>Nenhuma sessão encontrada.</p>
            </div>
          {/each}
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
