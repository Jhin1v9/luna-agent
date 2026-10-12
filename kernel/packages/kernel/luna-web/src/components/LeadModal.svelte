<script>
  import { onMount } from 'svelte';
  import { Target, CheckCircle2 } from 'lucide-svelte';
  
  export let open = false;
  export let onClose = () => {};
  
  let name = '';
  let email = '';
  let phone = '';
  let source = 'site';
  let status = 'novo';
  let value = '';
  let notes = '';
  let loading = false;
  let success = false;
  let error = '';
  
  const sources = [
    { value: 'site', label: 'Site' },
    { value: 'indicacao', label: 'Indicação' },
    { value: 'social', label: 'Redes Sociais' },
    { value: 'anuncio', label: 'Anúncio' },
    { value: 'outro', label: 'Outro' },
  ];
  
  const statuses = [
    { value: 'novo', label: 'Novo' },
    { value: 'contatado', label: 'Contatado' },
    { value: 'proposta_enviada', label: 'Proposta Enviada' },
    { value: 'negociacao', label: 'Negociação' },
    { value: 'ganho', label: 'Ganho' },
    { value: 'perdido', label: 'Perdido' },
  ];
  
  async function handleSubmit() {
    if (!name.trim()) {
      error = 'Nome é obrigatório';
      return;
    }
    loading = true;
    error = '';
    
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          source,
          status,
          value: value ? parseFloat(value) : undefined,
          notes: notes.trim() || undefined,
        })
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erro ao criar lead');
      }
      
      success = true;
      setTimeout(() => {
        reset();
        onClose();
      }, 1500);
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }
  
  function reset() {
    name = '';
    email = '';
    phone = '';
    source = 'site';
    status = 'novo';
    value = '';
    notes = '';
    success = false;
    error = '';
  }
  
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }
  
  $: if (!open) reset();
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-backdrop" on:click={handleBackdropClick}>
    <div class="modal-container">
      <div class="modal-header">
        <h2 class="modal-title"><Target size={20} strokeWidth={1.5} /> Novo Lead</h2>
        <button class="modal-close" on:click={onClose} aria-label="Fechar">×</button>
      </div>
      
      <div class="modal-body">
        {#if success}
          <div class="success-state">
            <div class="success-icon"><CheckCircle2 size={40} strokeWidth={1.5} /></div>
            <div class="success-text">Lead criado com sucesso!</div>
          </div>
        {:else}
          <div class="form-grid">
            <div class="form-group">
              <label>Nome *</label>
              <input type="text" bind:value={name} placeholder="Nome do lead" class="form-input" />
            </div>
            
            <div class="form-group">
              <label>Email</label>
              <input type="email" bind:value={email} placeholder="email@exemplo.com" class="form-input" />
            </div>
            
            <div class="form-group">
              <label>Telefone</label>
              <input type="tel" bind:value={phone} placeholder="+55 11 99999-9999" class="form-input" />
            </div>
            
            <div class="form-group">
              <label>Valor</label>
              <input type="number" bind:value={value} placeholder="0,00" min="0" step="0.01" class="form-input" />
            </div>
            
            <div class="form-group">
              <label>Fonte</label>
              <select bind:value={source} class="form-select">
                {#each sources as s}
                  <option value={s.value}>{s.label}</option>
                {/each}
              </select>
            </div>
            
            <div class="form-group">
              <label>Status</label>
              <select bind:value={status} class="form-select">
                {#each statuses as s}
                  <option value={s.value}>{s.label}</option>
                {/each}
              </select>
            </div>
          </div>
          
          <div class="form-group full-width">
            <label>Observações</label>
            <textarea bind:value={notes} placeholder="Notas sobre o lead..." rows="3" class="form-textarea"></textarea>
          </div>
          
          {#if error}
            <div class="form-error">{error}</div>
          {/if}
        {/if}
      </div>
      
      {#if !success}
        <div class="modal-footer">
          <button class="btn-secondary" on:click={onClose}>Cancelar</button>
          <button class="btn-primary" on:click={handleSubmit} disabled={loading || !name.trim()}>
            {loading ? 'Salvando...' : 'Criar Lead'}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 24px;
  }
  .modal-container {
    background: linear-gradient(180deg, #1a1a2e 0%, #12121f 100%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 20px;
    width: 100%;
    max-width: 520px;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5), 0 0 40px rgba(168, 85, 247, 0.08);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .modal-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--luna-text);
    margin: 0;
  }
  .modal-close {
    background: none;
    border: none;
    color: var(--luna-text-secondary);
    font-size: 24px;
    cursor: pointer;
    padding: 4px;
    border-radius: 8px;
    transition: all 0.15s;
    line-height: 1;
  }
  .modal-close:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--luna-text);
  }
  .modal-body {
    padding: 24px;
    overflow-y: auto;
    flex: 1;
  }
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .form-group.full-width {
    grid-column: 1 / -1;
    margin-top: 16px;
  }
  .form-group label {
    font-size: 13px;
    font-weight: 500;
    color: var(--luna-text-secondary);
  }
  .form-input,
  .form-select,
  .form-textarea {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 10px 14px;
    color: var(--luna-text);
    font-size: 14px;
    outline: none;
    transition: all 0.2s;
    width: 100%;
    box-sizing: border-box;
  }
  .form-input:focus,
  .form-select:focus,
  .form-textarea:focus {
    border-color: var(--luna-accent);
    box-shadow: 0 0 0 3px var(--luna-accent-glow);
  }
  .form-select {
    cursor: pointer;
  }
  .form-select option {
    background: #1a1a2e;
    color: var(--luna-text);
  }
  .form-textarea {
    resize: vertical;
    min-height: 80px;
    font-family: inherit;
  }
  .form-error {
    margin-top: 12px;
    padding: 10px 14px;
    background: rgba(231, 76, 60, 0.1);
    border: 1px solid rgba(231, 76, 60, 0.2);
    border-radius: 10px;
    color: #e74c3c;
    font-size: 13px;
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  .btn-primary,
  .btn-secondary {
    padding: 10px 20px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }
  .btn-primary {
    background: var(--luna-accent);
    color: white;
  }
  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: rgba(255, 255, 255, 0.06);
    color: var(--luna-text-secondary);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--luna-text);
  }
  .success-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 32px 0;
  }
  .success-icon {
    font-size: 48px;
  }
  .success-text {
    font-size: 16px;
    font-weight: 500;
    color: var(--luna-text);
  }
  @media (max-width: 640px) {
    .form-grid {
      grid-template-columns: 1fr;
    }
    .modal-container {
      max-width: 100%;
      border-radius: 16px 16px 0 0;
      max-height: 85vh;
    }
    .modal-backdrop {
      align-items: flex-end;
      padding: 0;
    }
  }
</style>
