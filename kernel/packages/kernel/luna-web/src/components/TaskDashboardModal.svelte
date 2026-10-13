<script>
  import { onMount } from 'svelte';
  import { CheckCircle2, ClipboardList, Check, Calendar } from 'lucide-svelte';
  
  export let open = false;
  export let onClose = () => {};
  
  let tasks = [];
  let stats = null;
  let loading = true;
  let filterStatus = 'all';
  let searchQuery = '';
  let showCreateForm = false;
  let panelMode = 'search'; // v8.4-fix: 'search' | 'create' toggle
  
  // Form
  let formTitle = '';
  let formDescription = '';
  let formPriority = 'Média';
  let formTaskType = 'one_time';
  let formDueDate = '';
  let formAssignedTo = 'Abner';
  let formLoading = false;
  
  const statusConfig = {
    pending: { label: 'Pendente', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
    in_progress: { label: 'Em andamento', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
    completed: { label: 'Concluída', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
    cancelled: { label: 'Cancelada', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  };
  
  const priorityConfig = {
    'Alta': { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
    'Média': { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
    'Baixa': { color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  };
  
  $: filteredTasks = tasks.filter(t => {
    const matchStatus = filterStatus === 'all' || t.status === filterStatus;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || t.title.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q));
    return matchStatus && matchSearch;
  });
  
  async function loadData() {
    loading = true;
    try {
      const res = await fetch('api/tools/tasks');
      const data = await res.json();
      if (data.ok) {
        tasks = data.tasks;
        stats = data.stats;
      }
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  }
  
  async function createTask() {
    if (!formTitle.trim()) return;
    formLoading = true;
    try {
      const res = await fetch('api/tools/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle, description: formDescription,
          priority: formPriority, taskType: formTaskType,
          dueDate: formDueDate || null, assignedTo: formAssignedTo
        })
      });
      const data = await res.json();
      if (data.ok) {
        tasks = [data.task, ...tasks];
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
    formTitle = ''; formDescription = ''; formPriority = 'Média';
    formTaskType = 'one_time'; formDueDate = ''; formAssignedTo = 'Abner';
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
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
        </div>
        <div>
          <h2 class="modal-title">Gestão de Tarefas</h2>
          <p class="modal-subtitle">Operações e acompanhamento</p>
        </div>
      </div>
      <button class="modal-close" on:click={onClose}>×</button>
    </div>

    <!-- Stats Bar -->
    {#if stats && !loading}
    <div class="stats-bar">
      <div class="stat-card">
        <div class="stat-value" style="color: #06b6d4">{stats.total}</div>
        <div class="stat-label">Total</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #f59e0b">{stats.byStatus?.pending || 0}</div>
        <div class="stat-label">Pendentes</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #22c55e">{stats.byStatus?.completed || 0}</div>
        <div class="stat-label">Concluídas</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #ef4444">{stats.highPriority}</div>
        <div class="stat-label">Alta Prioridade</div>
      </div>
    </div>
    {/if}

    <!-- v8.4-fix: Mode Toggle (Search / Create) -->
    <div class="mode-toggle-bar">
      <div class="mode-toggle">
        <button class="mode-btn" class:active={panelMode === 'search'} on:click={() => { panelMode = 'search'; showCreateForm = false; }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Buscar
        </button>
        <button class="mode-btn" class:active={panelMode === 'create'} on:click={() => { panelMode = 'create'; showCreateForm = true; }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Criar
        </button>
      </div>
    </div>

    <!-- Toolbar -->
    {#if panelMode === 'search'}
    <div class="toolbar">
      <div class="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="text" placeholder="Buscar tarefas..." bind:value={searchQuery} />
      </div>
      <div class="filter-tabs">
        <button class="filter-tab" class:active={filterStatus === 'all'} on:click={() => filterStatus = 'all'}>Todas</button>
        <button class="filter-tab" class:active={filterStatus === 'pending'} on:click={() => filterStatus = 'pending'}>Pendentes</button>
        <button class="filter-tab" class:active={filterStatus === 'in_progress'} on:click={() => filterStatus = 'in_progress'}>Andamento</button>
        <button class="filter-tab" class:active={filterStatus === 'completed'} on:click={() => filterStatus = 'completed'}>Concluídas</button>
      </div>
    </div>
    {/if}

    <!-- Content -->
    <div class="modal-body">
      {#if loading}
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <span>Carregando tarefas...</span>
        </div>
      {:else if panelMode === 'create' || showCreateForm}
        <div class="create-form">
          <h3 class="form-title"><CheckCircle2 size={18} strokeWidth={1.5} /> Nova Tarefa</h3>
          <div class="form-grid">
            <div class="form-field full">
              <label>Título *</label>
              <input type="text" bind:value={formTitle} placeholder="Título da tarefa" />
            </div>
            <div class="form-field full">
              <label>Descrição</label>
              <textarea bind:value={formDescription} placeholder="Descrição detalhada..." rows="3"></textarea>
            </div>
            <div class="form-field">
              <label>Prioridade</label>
              <select bind:value={formPriority}>
                <option value="Alta">Alta</option>
                <option value="Média">Média</option>
                <option value="Baixa">Baixa</option>
              </select>
            </div>
            <div class="form-field">
              <label>Tipo</label>
              <select bind:value={formTaskType}>
                <option value="one_time">Uma vez</option>
                <option value="daily">Diária</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensal</option>
              </select>
            </div>
            <div class="form-field">
              <label>Prazo</label>
              <input type="date" bind:value={formDueDate} />
            </div>
            <div class="form-field">
              <label>Responsável</label>
              <input type="text" bind:value={formAssignedTo} placeholder="Nome" />
            </div>
          </div>
          <div class="form-actions">
            <button class="btn-secondary" on:click={() => showCreateForm = false}>Cancelar</button>
            <button class="btn-primary" on:click={createTask} disabled={formLoading || !formTitle.trim()}>
              {formLoading ? 'Salvando...' : 'Criar Tarefa'}
            </button>
          </div>
        </div>
      {:else if filteredTasks.length === 0}
        <div class="empty-state">
          <div class="empty-icon"><ClipboardList size={32} strokeWidth={1.5} /></div>
          <div class="empty-text">Nenhuma tarefa encontrada</div>
        </div>
      {:else}
        <div class="tasks-list">
          {#each filteredTasks as task (task.id)}
            <div class="task-card">
              <div class="task-left">
                <div class="task-checkbox" class:completed={task.status === 'completed'}>
                  {#if task.status === 'completed'}<Check size={12} strokeWidth={2.5} />{/if}
                </div>
                <div class="task-info">
                  <div class="task-title" class:completed={task.status === 'completed'}>{task.title}</div>
                  {#if task.description}
                    <div class="task-desc">{task.description}</div>
                  {/if}
                  <div class="task-meta">
                    <span class="task-badge priority" style="color: {priorityConfig[task.priority]?.color}; background: {priorityConfig[task.priority]?.bg}">
                      {task.priority}
                    </span>
                    <span class="task-badge status" style="color: {statusConfig[task.status]?.color}; background: {statusConfig[task.status]?.bg}">
                      {statusConfig[task.status]?.label || task.status}
                    </span>
                    {#if task.dueDate}
                      <span class="task-due"><Calendar size={12} strokeWidth={1.5} /> {formatDate(task.dueDate)}</span>
                    {/if}
                  </div>
                </div>
              </div>
              <div class="task-right">
                <div class="task-assignee">
                  <span class="assignee-avatar">{task.assignedTo?.charAt(0).toUpperCase() || '?'}</span>
                  <span class="assignee-name">{task.assignedTo}</span>
                </div>
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
    box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6), 0 0 60px rgba(6, 182, 212, 0.06);
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
    background: linear-gradient(135deg, rgba(6,182,212,0.2) 0%, rgba(6,182,212,0.05) 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #06b6d4;
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
    background: rgba(6, 182, 212, 0.15);
    color: #06b6d4;
  }
  .btn-create {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%);
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
    box-shadow: 0 8px 24px rgba(6, 182, 212, 0.3);
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
    border-top-color: #06b6d4;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Tasks List */
  .tasks-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 16px;
  }
  .task-card {
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
  .task-card:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.08);
    transform: translateX(4px);
  }
  .task-left {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    flex: 1;
  }
  .task-checkbox {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 2px solid rgba(255,255,255,0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: #22c55e;
    flex-shrink: 0;
    margin-top: 2px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .task-checkbox.completed {
    border-color: #22c55e;
    background: rgba(34,197,94,0.1);
  }
  .task-info {
    flex: 1;
    min-width: 0;
  }
  .task-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--luna-text);
    margin-bottom: 4px;
  }
  .task-title.completed {
    text-decoration: line-through;
    opacity: 0.5;
  }
  .task-desc {
    font-size: 12px;
    color: var(--luna-text-secondary);
    margin-bottom: 8px;
    line-height: 1.4;
  }
  .task-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .task-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 20px;
  }
  .task-due {
    font-size: 11px;
    color: var(--luna-text-secondary);
  }
  .task-right {
    flex-shrink: 0;
  }
  .task-assignee {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .assignee-avatar {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: linear-gradient(135deg, rgba(6,182,212,0.2) 0%, rgba(6,182,212,0.1) 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #06b6d4;
    font-size: 12px;
    font-weight: 600;
  }
  .assignee-name {
    font-size: 12px;
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
    border-color: #06b6d4;
    box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.1);
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
    background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%);
    color: white;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 8px 24px rgba(6, 182, 212, 0.3);
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

  /* v8.4-fix: Mode toggle bar */
  .mode-toggle-bar {
    display: flex;
    justify-content: center;
    padding: 16px 28px 0;
  }
  .mode-toggle {
    display: inline-flex;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 4px;
    gap: 4px;
  }
  .mode-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--luna-text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  .mode-btn:hover {
    color: var(--luna-text);
  }
  .mode-btn.active {
    background: rgba(6, 182, 212, 0.15);
    color: #06b6d4;
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
