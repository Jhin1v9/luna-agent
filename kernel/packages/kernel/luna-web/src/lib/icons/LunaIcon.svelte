<script>
  import { getIconComponent } from './lunaIconMap.js';

  export let name = 'fallback';
  export let size = 18;
  export let strokeWidth = 1.5;
  export let color = 'currentColor';
  export let className = '';
  export let ariaLabel = '';

  $: IconComponent = getIconComponent(name);
</script>

<span
  class="luna-icon {className}"
  style:--luna-icon-size="{size}px"
  style:color={color}
  role="img"
  aria-label={ariaLabel || name}
>
  <svelte:component this={IconComponent} {size} {strokeWidth} {color} />
</span>

<style>
  .luna-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--luna-icon-size);
    height: var(--luna-icon-size);
    flex-shrink: 0;
    transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
                filter 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .luna-icon :global(svg) {
    width: 100%;
    height: 100%;
  }

  .luna-icon:hover {
    transform: scale(1.06);
    filter: drop-shadow(0 0 6px rgba(139, 92, 246, 0.35));
  }
</style>
