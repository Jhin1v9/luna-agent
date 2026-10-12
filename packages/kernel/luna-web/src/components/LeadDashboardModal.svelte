<script>
  import { onMount } from 'svelte';
  import { Target, Search } from 'lucide-svelte';
  
  export let open = false;
  export let onClose = () => {};
  
  let leads = [];
  let stats = null;
  let loading = true;
  let filterStatus = 'all';
  let searchQuery = '';
  let showCreateForm = false;
  
  // Form
  let formName = '';
  let formEmail = '';
  let formPhone = '';
  let formSource = 'site';
  let formStatus = 'novo';
  let formValue = '';
  let formNotes = '';
  let formLoading = false;
  
  const statusConfig = {
    novo: { label: 'Novo', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
    contatado: { label: 'Contatado', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
    proposta_enviada: { label: 'Proposta', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
    negociacao: { label: 'Negociação', color: '#ec4899', bg: 'rgba(236,72,153,0.1)' },
    ganho: { label: 'Ganho', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
    perdido: { label: 'Perdido', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  };
  
  const sourceLabels = {
    site: 'Site', indicacao: 'Indicação', social: 'Social',
    anuncio: 'Anúncio', outro: 'Outro'
  };
  
  $: filteredLeads = leads.filter(l => {
    const matchStatus = filterStatus === 'all' || l.status === filterStatus;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || l.name.toLowerCase().includes(q) || (l.email && l.email.toLowerCase().includes(q));
    return matchStatus && matchSearch;
  });
  
  async function loadData() {
    loading = true;
    try {
      const res = await fetch('/api/tools/leads');
      const data = await res.json();
      if (data.ok) {
        leads = data.leads;
        stats = data.stats;
      }
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  }
  
  async function createLead() {
    if (!formName.trim()) return;
    formLoading = true;
    try {
      const res = await fetch('/api/tools/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName, email: formEmail, phone: formPhone,
          source: formSource, status: formStatus, value: formValue, notes: formNotes
        })
      });
      const data = await res.json();
      if (data.ok) {
        leads = [data.lead, ...leads];
        showCreateForm = false;
        resetForm();
      }
    } catch (e) {
      console.error(e);
    } finally {
      formLoading = false;
    }
  }
  
  function resetForm() {
    formName = ''; formEmail = ''; formPhone = '';
    formSource = 'site'; formStatus = 'novo'; formValue = ''; formNotes = '';
  }
  
  function formatCurrency(v) {
    return v ? `R$ ${v.toLocaleString('pt-BR')}` : '—';
  }
  
  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }
  
  $: if (open) loadData();
  
  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

{#if open}
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-backdrop" on:click={handleBackdrop}>
  <div class="modal-container">
    <!-- Header -->
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-icon-bg">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="8.5" cy="7" r="4"/>
            <line x1="20" y1="8" x2="20" y2="14"/>
            <line x1="23" y1="11" x2="17" y2="11"/>
          </svg>
        </div>
        <div>
          <h2 class="modal-title">CRM de Leads</h2>
          <p class="modal-subtitle">Pipeline completo de prospecção</p>
        </div>
      </div>
      <button class="modal-close" on:click={onClose}>×</button>
    </div>

    <!-- Stats Bar -->
    {#if stats && !loading}
    <div class="stats-bar">
      <div class="stat-card">
        <div class="stat-value" style="color: #a855f7">{stats.total}</div>
        <div class="stat-label">Total de Leads</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #22c55e">R$ {(stats.totalValue / 1000).toFixed(1)}k</div>
        <div class="stat-label">Pipeline</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #3b82f6">{stats.recent}</div>
        <div class="stat-label">Esta semana</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #f59e0b">{stats.byStatus?.negociacao || 0}</div>
        <div class="stat-label">Em negociação</div>
      </div>
    </div>
    {/if}

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="text" placeholder="Buscar leads..." bind:value={searchQuery} />
      </div>
      <div class="filter-tabs">
        <button class="filter-tab" class:active={filterStatus === 'all'} on:click={() => filterStatus = 'all'}>Todos</button>
        <button class="filter-tab" class:active={filterStatus === 'novo'} on:click={() => filterStatus = 'novo'}>Novo</button>
        <button class="filter-tab" class:active={filterStatus === 'negociacao'} on:click={() => filterStatus = 'negociacao'}>Negociação</button>
        <button class="filter-tab" class:active={filterStatus === 'ganho'} on:click={() => filterStatus = 'ganho'}>Ganho</button>
      </div>
      <button class="btn-create" on:click={() => showCreateForm = true}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo Lead
      </button>
    </div>

    <!-- Content -->
    <div class="modal-body">
      {#if loading}
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <span>Carregando leads...</span>
        </div>
      {:else if showCreateForm}
        <div class="create-form">
          <h3 class="form-title"><Target size={18} strokeWidth={1.5} /> Novo Lead</h3>
          <div class="form-grid">
            <div class="form-field">
              <label>Nome *</label>
              <input type="text" bind:value={formName} placeholder="Nome completo" />
            </div>
            <div class="form-field">
              <label>Email</label>
              <input type="email" bind:value={formEmail} placeholder="email@exemplo.com" />
            </div>
            <div class="form-field">
              <label>Telefone</label>
              <input type="tel" bind:value={formPhone} placeholder="+55 11 99999-9999" />
            </div>
            <div class="form-field">
              <label>Valor Estimado</label>
              <input type="number" bind:value={formValue} placeholder="0,00" />
            </div>
            <div class="form-field">
              <label>Fonte</label>
              <select bind:value={formSource}>
                {#each Object.entries(sourceLabels) as [val, label]}
                  <option value={val}>{label}</option>
                {/each}
              </select>
            </div>
            <div class="form-field">
              <label>Status</label>
              <select bind:value={formStatus}>
                {#each Object.entries(statusConfig) as [val, cfg]}
                  <option value={val}>{cfg.label}</option>
                {/each}
              </select>
            </div>
          </div>
          <div class="form-field full">
            <label>Observações</label>
            <textarea bind:value={formNotes} placeholder="Notas sobre o lead..." rows="3"></textarea>
          </div>
          <div class="form-actions">
            <button class="btn-secondary" on:click={() => showCreateForm = false}>Cancelar</button>
            <button class="btn-primary" on:click={createLead} disabled={formLoading || !formName.trim()}>
              {formLoading ? 'Salvando...' : 'Criar Lead'}
            </button>
          </div>
        </div>
      {:else if filteredLeads.length === 0}
        <div class="empty-state">
          <div class="empty-icon"><Search size={32} strokeWidth={1.5} /></div>
          <div class="empty-text">Nenhum lead encontrado</div>
        </div>
      {:else}
        <div class="leads-list">
          {#each filteredLeads as lead (lead.id)}
            <div class="lead-card">
              <div class="lead-main">
                <div class="lead-avatar">{lead.name.charAt(0).toUpperCase()}</div>
                <div class="lead-info">
                  <div class="lead-name">{lead.name}</div>
                  <div class="lead-meta">
                    {#if lead.email}<span>{lead.email}</span>{/if}
                    {#if lead.phone}<span>{lead.phone}</span>{/if}
                  </div>
                  {#if lead.notes}
                    <div class="lead-notes">{lead.notes}</div>
                  {/if}
                </div>
              </div>
              <div class="lead-side">
                <span class="status-badge" style="color: {statusConfig[lead.status]?.color}; background: {statusConfig[lead.status]?.bg}">
                  {statusConfig[lead.status]?.label || lead.status}
                </span>
                <div class="lead-value">{formatCurrency(lead.value)}</div>
                <div class="lead-date">{formatDate(lead.createdAt)}</div>
              </div>
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
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 24px;
  }
  .modal-container {
    background: linear-gradient(180deg, #1a1a2e 0%, #12121f 100%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 24px;
    width: 100%;
    max-width: 800px;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6), 0 0 60px rgba(168, 85, 247, 0.06);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24px 28px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .modal-header-left {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .modal-icon-bg {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(168,85,247,0.2) 0%, rgba(168,85,247,0.05) 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #a855f7;
  }
  .modal-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--luna-text);
    margin: 0;
  }
  .modal-subtitle {
    font-size: 13px;
    color: var(--luna-text-secondary);
    margin: 2px 0 0;
  }
  .modal-close {
    background: none;
    border: none;
    color: var(--luna-text-secondary);
    font-size: 28px;
    cursor: pointer;
    padding: 4px;
    border-radius: 10px;
    transition: all 0.15s;
    line-height: 1;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal-close:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--luna-text);
  }

  /* Stats Bar */
  .stats-bar {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    padding: 20px 28px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .stat-card {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 14px;
    padding: 16px;
    text-align: center;
    transition: all 0.3s ease;
  }
  .stat-card:hover {
    background: rgba(255, 255, 255, 0.04);
    transform: translateY(-2px);
  }
  .stat-value {
    font-size: 22px;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
  }
  .stat-label {
    font-size: 11px;
    color: var(--luna-text-secondary);
    margin-top: 4px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 28px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    flex-wrap: wrap;
  }
  .search-box {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 10px 14px;
    flex: 1;
    min-width: 200px;
    color: var(--luna-text-secondary);
  }
  .search-box input {
    background: none;
    border: none;
    color: var(--luna-text);
    font-size: 14px;
    outline: none;
    width: 100%;
  }
  .filter-tabs {
    display: flex;
    gap: 4px;
  }
  .filter-tab {
    padding: 8px 14px;
    border-radius: 10px;
    border: none;
    background: none;
    color: var(--luna-text-secondary);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
    font-weight: 500;
  }
  .filter-tab:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--luna-text);
  }
  .filter-tab.active {
    background: rgba(168, 85, 247, 0.15);
    color: #a855f7;
  }
  .btn-create {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-create:hover {
    transform: translateY(-1px);
    box-shadow: 0 8px 24px rgba(168, 85, 247, 0.3);
  }

  /* Body */
  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 28px 28px;
  }
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 48px 0;
    color: var(--luna-text-secondary);
  }
  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 2px solid rgba(255,255,255,0.1);
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Leads List */
  .leads-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 16px;
  }
  .lead-card {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 14px;
    transition: all 0.2s ease;
  }
  .lead-card:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.08);
    transform: translateX(4px);
  }
  .lead-main {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    flex: 1;
  }
  .lead-avatar {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(168,85,247,0.2) 0%, rgba(124,58,237,0.1) 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #a855f7;
    font-size: 16px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .lead-info {
    flex: 1;
    min-width: 0;
  }
  .lead-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--luna-text);
    margin-bottom: 4px;
  }
  .lead-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    font-size: 12px;
    color: var(--luna-text-secondary);
  }
  .lead-meta span {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .lead-notes {
    font-size: 12px;
    color: var(--luna-text-secondary);
    margin-top: 6px;
    opacity: 0.7;
    line-height: 1.4;
  }
  .lead-side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    flex-shrink: 0;
  }
  .status-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 20px;
  }
  .lead-value {
    font-size: 14px;
    font-weight: 600;
    color: var(--luna-text);
    font-family: 'JetBrains Mono', monospace;
  }
  .lead-date {
    font-size: 11px;
    color: var(--luna-text-secondary);
  }

  /* Create Form */
  .create-form {
    padding-top: 20px;
  }
  .form-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--luna-text);
    margin: 0 0 20px;
  }
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .form-field.full {
    grid-column: 1 / -1;
    margin-top: 8px;
  }
  .form-field label {
    font-size: 13px;
    font-weight: 500;
    color: var(--luna-text-secondary);
  }
  .form-field input,
  .form-field select,
  .form-field textarea {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 10px 14px;
    color: var(--luna-text);
    font-size: 14px;
    outline: none;
    transition: all 0.2s;
  }
  .form-field input:focus,
  .form-field select:focus,
  .form-field textarea:focus {
    border-color: #a855f7;
    box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.1);
  }
  .form-field textarea {
    resize: vertical;
    font-family: inherit;
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  .btn-secondary {
    padding: 10px 20px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    color: var(--luna-text-secondary);
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--luna-text);
  }
  .btn-primary {
    padding: 10px 20px;
    border-radius: 10px;
    border: none;
    background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
    color: white;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 8px 24px rgba(168, 85, 247, 0.3);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 48px 0;
    color: var(--luna-text-secondary);
  }
  .empty-icon {
    font-size: 40px;
    opacity: 0.5;
  }
  .empty-text {
    font-size: 15px;
  }

  @media (max-width: 640px) {
    .stats-bar {
      grid-template-columns: repeat(2, 1fr);
    }
    .form-grid {
      grid-template-columns: 1fr;
    }
    .toolbar {
      flex-direction: column;
      align-items: stretch;
    }
    .modal-container {
      max-width: 100%;
      border-radius: 20px 20px 0 0;
      max-height: 92vh;
    }
    .modal-backdrop {
      align-items: flex-end;
      padding: 0;
    }
  }
</style>
