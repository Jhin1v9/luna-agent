<script>
  import { compactState } from '../stores.js';
  import MoonPhase from './MoonPhase.svelte';
</script>

{#if $compactState.active}
  <div class="compacting-backdrop">
    <div class="compacting-card">
      <MoonPhase
        size={80}
        color="#c9a227"
        glowIntensity={0.3}
        animated={true}
      />

      <!-- Text -->
      <div class="compacting-text">
        <span class="compacting-title">Compactando contexto</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .compacting-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(10, 10, 26, 0.85);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .compacting-card {
    background: #12121f;
    border: 1px solid rgba(168, 85, 247, 0.2);
    border-radius: 16px;
    padding: 32px 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    box-shadow: 0 0 40px rgba(168, 85, 247, 0.15), 0 8px 32px rgba(0,0,0,0.4);
    animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    max-width: 420px;
    width: 90%;
  }

  @keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }

  .compacting-text {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    text-align: center;
  }

  .compacting-title {
    font-size: 1.15rem;
    font-weight: 600;
    color: #e2e8f0;
    letter-spacing: 0.02em;
  }
</style>
