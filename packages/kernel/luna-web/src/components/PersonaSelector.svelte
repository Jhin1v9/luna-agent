<script>
  import { onMount } from 'svelte';
  import { Drama } from 'lucide-svelte';
  import { fetchPersonas, setSessionPersona } from '../api.js';

  export let sessionId = null;
  export let currentPersona = 'default';

  let personas = [];
  let loading = false;
  let showDropdown = false;

  onMount(async () => {
    try {
      const data = await fetchPersonas();
      if (data.ok && data.personas) {
        personas = data.personas;
      }
    } catch (e) {
      console.error('Failed to load personas:', e);
    }
  });

  async function selectPersona(personaId) {
    if (!sessionId || personaId === currentPersona) {
      showDropdown = false;
      return;
    }
    loading = true;
    try {
      const res = await setSessionPersona(sessionId, personaId);
      if (res.ok) {
        currentPersona = personaId;
      }
    } catch (e) {
      console.error('Failed to set persona:', e);
    } finally {
      loading = false;
      showDropdown = false;
    }
  }

  function handleClickOutside(e) {
    if (showDropdown && !e.target.closest('.persona-selector')) {
      showDropdown = false;
    }
  }

  $: currentPersonaName = personas.find(p => p.id === currentPersona)?.name || currentPersona;
</script>

<svelte:window on:click={handleClickOutside} />

<div class="persona-selector">
  <button
    class="persona-btn"
    on:click|stopPropagation={() => showDropdown = !showDropdown}
    disabled={loading || !sessionId}
    title="Selecionar personalidade"
  >
    <span class="persona-icon"><Drama size={14} strokeWidth={1.5} /></span>
    <span class="persona-label">{currentPersonaName}</span>
    <svg width="0.75rem" height="0.75rem" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  </button>

  {#if showDropdown}
    <div class="persona-dropdown">
      {#each personas as persona}
        <button
          class="persona-option"
          class:active={currentPersona === persona.id}
          on:click={() => selectPersona(persona.id)}
        >
          <span class="persona-option-name">{persona.name}</span>
          {#if persona.description}
            <span class="persona-option-desc">{persona.description}</span>
          {/if}
        </button>
      {:else}
        <div class="persona-empty">Nenhuma persona encontrada</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .persona-selector {
    position: relative;
  }
  .persona-btn {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.625rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
    color: var(--luna-text-secondary);
    font-size: clamp(0.6875rem, 1.5vw, 0.75rem);
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }
  .persona-btn:hover:not(:disabled) {
    background: rgba(255,255,255,0.06);
    border-color: rgba(255,255,255,0.12);
  }
  .persona-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .persona-icon {
    font-size: 0.875rem;
  }
  .persona-label {
    max-width: 6rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .persona-dropdown {
    position: absolute;
    top: calc(100% + 0.25rem);
    left: 0;
    min-width: 12rem;
    background: linear-gradient(145deg, #1a1a2e 0%, #0f0f1a 100%);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 0.625rem;
    padding: 0.375rem;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    z-index: 100;
    box-shadow: 0 0.5rem 1.5rem rgba(0,0,0,0.4);
  }
  .persona-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0.5rem 0.625rem;
    border-radius: 0.375rem;
    border: none;
    background: transparent;
    color: var(--luna-text);
    font-size: clamp(0.75rem, 1.8vw, 0.8125rem);
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background 0.15s;
  }
  .persona-option:hover {
    background: rgba(255,255,255,0.05);
  }
  .persona-option.active {
    background: rgba(139,92,246,0.15);
    color: #a855f7;
  }
  .persona-option-name {
    font-weight: 500;
  }
  .persona-option-desc {
    font-size: clamp(0.625rem, 1.5vw, 0.6875rem);
    color: var(--luna-text-secondary);
    margin-top: 0.125rem;
  }
  .persona-empty {
    padding: 0.75rem;
    color: var(--luna-text-secondary);
    font-size: 0.8125rem;
    text-align: center;
  }
</style>
