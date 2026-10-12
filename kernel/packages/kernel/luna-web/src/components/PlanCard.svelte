<script>
  import { createEventDispatcher } from 'svelte';
  import {
    Search,
    Shield,
    ClipboardList,
    CheckCircle,
    XCircle,
    Pencil,
    Eye,
    Lock,
    Sparkles,
    ScrollText,
    Save,
    X
  } from 'lucide-svelte';

  export let plan = '';
  export let status = 'awaiting_approval';

  const dispatch = createEventDispatcher();
  let isEditing = false;
  let editedPlan = plan;

  $: if (!isEditing) editedPlan = plan;

  function approve() { dispatch('approve'); }
  function reject() { dispatch('reject'); }
  function startEdit() { isEditing = true; editedPlan = plan; }
  function submitRevision() { dispatch('revise', editedPlan); isEditing = false; }
  function cancelEdit() { isEditing = false; editedPlan = plan; }
</script>

<div class="plan-card" class:awaiting={status === 'awaiting_approval'}>
  <div class="plan-header">
    <div class="plan-header-left">
      <div class="plan-icon-wrap">
        <Search size={18} />
      </div>
      <div class="plan-title-wrap">
        <span class="plan-title">Plano de Ação</span>
        <span class="plan-subtitle">Modo Detetive</span>
      </div>
    </div>
    <div class="plan-badge">
      {#if status === 'awaiting_approval'}
        <Shield size={12} />
        <span>Aguardando aprovação</span>
      {:else if status === 'approved'}
        <CheckCircle size={12} />
        <span>Aprovado</span>
      {:else if status === 'rejected'}
        <XCircle size={12} />
        <span>Rejeitado</span>
      {:else if status === 'revised'}
        <Pencil size={12} />
        <span>Substituído</span>
      {/if}
    </div>
  </div>

  <div class="plan-body">
    {#if isEditing}
      <textarea class="plan-editor" bind:value={editedPlan} rows="20" />
    {:else}
      <div class="plan-content markdown-content">
        {#each plan.split('\n') as line}
          {#if line.startsWith('# ')}
            <h1>{line.slice(2)}</h1>
          {:else if line.startsWith('## ')}
            <h2>{line.slice(3)}</h2>
          {:else if line.startsWith('### ')}
            <h3>{line.slice(4)}</h3>
          {:else if line.startsWith('- ')}
            <ul><li>{line.slice(2)}</li></ul>
          {:else if line.match(/^\d+\. /)}
            <ol><li>{line.replace(/^\d+\. /, '')}</li></ol>
          {:else if line.startsWith('```')}
            <!-- code block marker, skip -->
          {:else if line.trim() === ''}
            <br />
          {:else}
            <p>{line}</p>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <!-- Wave 7 review: actions only make sense while the plan awaits a decision —
       after approve/reject the buttons used to stay clickable and every extra
       click sent another real execution message to the model. -->
  {#if status === 'awaiting_approval'}
  <div class="plan-actions">
    {#if isEditing}
      <button class="btn btn-primary" on:click={submitRevision}>
        <Save size={14} />
        <span>Salvar Revisão</span>
      </button>
      <button class="btn btn-secondary" on:click={cancelEdit}>
        <X size={14} />
        <span>Cancelar</span>
      </button>
    {:else}
      <button class="btn btn-approve" on:click={approve}>
        <CheckCircle size={14} />
        <span>Aprovar</span>
      </button>
      <button class="btn btn-reject" on:click={reject}>
        <XCircle size={14} />
        <span>Rejeitar</span>
      </button>
      <button class="btn btn-edit" on:click={startEdit}>
        <Pencil size={14} />
        <span>Revisar</span>
      </button>
    {/if}
  </div>
  {/if}
</div>

<style>
  .plan-card {
    background: linear-gradient(135deg, rgba(26, 26, 46, 0.75) 0%, rgba(15, 15, 26, 0.75) 100%);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(201,162,39,0.25);
    border-radius: 16px;
    padding: 20px;
    margin: 16px 0;
    box-shadow: 0 0 40px rgba(201,162,39,0.08), inset 0 1px 0 rgba(255,215,0,0.05);
    animation: slideIn 400ms cubic-bezier(0.4, 0, 0.2, 1);
    max-width: 100%;
  }
  .plan-card.awaiting {
    border-color: rgba(255,215,0,0.4);
    box-shadow: 0 0 60px rgba(255,215,0,0.12), inset 0 1px 0 rgba(255,215,0,0.08);
    animation: pulseGold 3s infinite;
  }
  .plan-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(201,162,39,0.15);
  }
  .plan-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .plan-icon-wrap {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(201,162,39,0.15);
    color: #ffd700;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(201,162,39,0.2);
  }
  .plan-title-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .plan-title {
    font-weight: 600;
    color: #ffd700;
    font-size: 15px;
  }
  .plan-subtitle {
    font-size: 11px;
    color: rgba(201,162,39,0.7);
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }
  .plan-badge {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: #c9a227;
    background: rgba(201,162,39,0.1);
    padding: 5px 12px;
    border-radius: 20px;
    border: 1px solid rgba(201,162,39,0.15);
  }
  .plan-body {
    margin-bottom: 16px;
    max-height: 500px;
    overflow-y: auto;
  }
  .plan-content {
    color: var(--luna-text);
    font-size: 13px;
    line-height: 1.7;
  }
  .plan-content :global(h1) {
    font-size: 16px;
    font-weight: 600;
    color: #ffd700;
    margin: 12px 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(201,162,39,0.15);
  }
  .plan-content :global(h2) {
    font-size: 14px;
    font-weight: 600;
    color: #c9a227;
    margin: 10px 0 6px;
  }
  .plan-content :global(h3) {
    font-size: 13px;
    font-weight: 500;
    color: #e2e8f0;
    margin: 8px 0 4px;
  }
  .plan-content :global(p) {
    margin: 4px 0;
    color: var(--luna-text-secondary);
  }
  .plan-content :global(ul), .plan-content :global(ol) {
    margin: 4px 0 4px 16px;
    padding: 0;
  }
  .plan-content :global(li) {
    margin: 2px 0;
    color: var(--luna-text-secondary);
  }
  .plan-content :global(code) {
    background: rgba(201,162,39,0.08);
    color: #ffd700;
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 12px;
  }
  .plan-editor {
    width: 100%;
    background: #0a0a1a;
    border: 1px solid rgba(201,162,39,0.3);
    border-radius: 10px;
    padding: 12px;
    color: var(--luna-text);
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    line-height: 1.6;
    resize: vertical;
    min-height: 300px;
    outline: none;
  }
  .plan-editor:focus {
    border-color: rgba(255,215,0,0.5);
    box-shadow: 0 0 0 3px rgba(201,162,39,0.1);
  }
  .plan-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    padding-top: 12px;
    border-top: 1px solid rgba(201,162,39,0.1);
  }
  .btn {
    padding: 8px 16px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: 1px solid transparent;
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
  }
  .btn:hover {
    transform: translateY(-1px);
  }
  .btn-approve {
    background: rgba(34,197,94,0.12);
    color: #4ade80;
    border-color: rgba(34,197,94,0.25);
  }
  .btn-approve:hover {
    background: rgba(34,197,94,0.2);
    box-shadow: 0 0 12px rgba(34,197,94,0.15);
  }
  .btn-reject {
    background: rgba(239,68,68,0.12);
    color: #fca5a5;
    border-color: rgba(239,68,68,0.25);
  }
  .btn-reject:hover {
    background: rgba(239,68,68,0.2);
    box-shadow: 0 0 12px rgba(239,68,68,0.15);
  }
  .btn-edit {
    background: rgba(201,162,39,0.12);
    color: #ffd700;
    border-color: rgba(201,162,39,0.25);
  }
  .btn-edit:hover {
    background: rgba(201,162,39,0.2);
    box-shadow: 0 0 12px rgba(201,162,39,0.15);
  }
  .btn-primary {
    background: rgba(201,162,39,0.15);
    color: #ffd700;
    border-color: rgba(201,162,39,0.3);
  }
  .btn-primary:hover {
    background: rgba(201,162,39,0.25);
  }
  .btn-secondary {
    background: rgba(255,255,255,0.04);
    color: var(--luna-text-secondary);
    border-color: rgba(255,255,255,0.08);
  }
  .btn-secondary:hover {
    background: rgba(255,255,255,0.08);
    color: var(--luna-text);
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulseGold {
    0%, 100% { box-shadow: 0 0 40px rgba(255,215,0,0.08); }
    50% { box-shadow: 0 0 60px rgba(255,215,0,0.15); }
  }

  /* Wave 10 T3: backdrop-filter over the animated canvas melts the iOS
     compositor as the conversation grows — solid fallback on mobile */
  @media (max-width: 768px) {
    .plan-card {
      background: linear-gradient(135deg, rgba(26, 26, 46, 0.96) 0%, rgba(15, 15, 26, 0.96) 100%);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }
</style>
