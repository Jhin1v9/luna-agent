<script>
  import { ChevronDown, ChevronUp, Layers } from 'lucide-svelte';
  import ToolCard from './ToolCard.svelte';

  export let tools = [];
  export let onConfirmTool = () => {};
  export let onCancelTool = () => {};

  let expanded = false;
  const PREVIEW_COUNT = 2;

  $: hasPending = tools.some(t => t.status === 'awaiting_confirmation');
  $: completedCount = tools.filter(t => t.status === 'completed').length;
  $: failedCount = tools.filter(t => t.status === 'failed').length;
  $: runningCount = tools.filter(t => t.status === 'running').length;
  $: hiddenCount = tools.length - PREVIEW_COUNT;

  function statusHint() {
    if (hasPending) return 'aguardando confirmação';
    if (runningCount > 0) return `${runningCount} em execução`;
    if (failedCount > 0 && completedCount > 0) return `${completedCount} ok, ${failedCount} falha${failedCount > 1 ? 's' : ''}`;
    if (failedCount > 0) return `${failedCount} falha${failedCount > 1 ? 's' : ''}`;
    return `${completedCount} concluída${completedCount > 1 ? 's' : ''}`;
  }
</script>

<div class="tool-group">
  <div class="tool-group-preview">
    {#each tools.slice(0, PREVIEW_COUNT) as tool (tool.id)}
      <ToolCard
        tool={tool.tool}
        params={tool.params}
        result={tool.result}
        duration={tool.duration}
        status={tool.status || 'running'}
        liveOutput={tool.liveOutput || ''}
        confirmationId={tool.confirmationId}
        confirmationMessage={tool.confirmationMessage}
        onConfirm={onConfirmTool}
        onCancel={onCancelTool}
      />
    {/each}
  </div>

  {#if tools.length > PREVIEW_COUNT}
    <button class="tool-group-toggle" on:click={() => expanded = !expanded}>
      <Layers size={14} strokeWidth={1.5} />
      {#if expanded}
        <span>Ocultar {hiddenCount} ação{hiddenCount > 1 ? 'ões' : ''}</span>
        <ChevronUp size={14} strokeWidth={1.5} />
      {:else}
        <span>Mostrar mais {hiddenCount} ação{hiddenCount > 1 ? 'ões' : ''} ({statusHint()})</span>
        <ChevronDown size={14} strokeWidth={1.5} />
      {/if}
    </button>

    {#if expanded}
      <div class="tool-group-rest">
        {#each tools.slice(PREVIEW_COUNT) as tool (tool.id)}
          <ToolCard
            tool={tool.tool}
            params={tool.params}
            result={tool.result}
            duration={tool.duration}
            status={tool.status || 'running'}
            liveOutput={tool.liveOutput || ''}
            confirmationId={tool.confirmationId}
            confirmationMessage={tool.confirmationMessage}
            onConfirm={onConfirmTool}
            onCancel={onCancelTool}
          />
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .tool-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tool-group-preview,
  .tool-group-rest {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tool-group-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    align-self: center;
    padding: 6px 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 20px;
    color: var(--luna-text-secondary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .tool-group-toggle:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--luna-text);
  }
</style>
