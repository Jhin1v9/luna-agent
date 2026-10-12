<script>
  import { changelogModalOpen, changelogData } from '../stores.js';
  import { Sparkles } from 'lucide-svelte';
  import MoonPhase from './MoonPhase.svelte';

  let selectedIndex = 0;

  $: releases = $changelogData?.releases || [];
  $: legacyVersion = $changelogData?.version || '';
  $: legacyDate = $changelogData?.date || '';
  $: legacyUpdates = $changelogData?.updates || [];
  $: selectedRelease = releases.length > 0
    ? releases[selectedIndex]
    : { version: legacyVersion, date: legacyDate, updates: legacyUpdates };

  function closeModal() {
    changelogModalOpen.set(false);
    const data = $changelogData;
    if (data?.releases && data.releases[0]) {
      localStorage.setItem('luna_changelog_seen', data.releases[0].version);
    } else if (data?.version) {
      localStorage.setItem('luna_changelog_seen', data.version);
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') closeModal();
  }

  // v10.18: Sanitize HTML to prevent XSS from CHANGELOG.json
  function sanitizeHtml(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const allowed = { strong: true, em: true, code: true, br: true };
    return raw
      .replace(/<([a-zA-Z0-9]+)[^>]*>/g, (match, tag) => allowed[tag.toLowerCase()] ? match : '')
      .replace(/<\/([a-zA-Z0-9]+)>/g, (match, tag) => allowed[tag.toLowerCase()] ? match : '');
  }
</script>

{#if $changelogModalOpen}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="changelog-backdrop" on:click={closeModal} on:keydown={handleKeydown}>
    <div class="changelog-card" on:click|stopPropagation>
      <!-- Close button -->
      <button class="close-btn" on:click={closeModal} aria-label="Fechar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      <!-- Header with animated moon -->
      <div class="changelog-header">
        <div class="moon-container">
          <MoonPhase
            size={55}
            color="#f0c040"
            glowIntensity={0.55}
            animated={true}
            extraStars={true}
          />
        </div>

        <div class="header-text">
          <div class="version-badge">v{selectedRelease.version || ''}</div>
          <h2 class="changelog-title">Novidades da Luna</h2>
          <p class="changelog-date">{selectedRelease.date || ''}</p>
        </div>
      </div>

      <!-- Version selector (only when multiple releases) -->
      {#if releases.length > 1}
        <div class="version-tabs" role="tablist" aria-label="Versões do changelog">
          {#each releases as release, index}
            <button
              class="version-tab"
              class:active={index === selectedIndex}
              role="tab"
              aria-selected={index === selectedIndex}
              on:click={() => selectedIndex = index}
            >
              v{release.version}
              {#if index === 0}<span class="new-dot" title="Mais recente"></span>{/if}
            </button>
          {/each}
        </div>
      {/if}

      <!-- Updates list -->
      <div class="updates-container" key={selectedRelease.version}>
        {#each selectedRelease.updates || [] as category}
          <div class="update-category">
            <div class="category-header">
              <span class="category-icon">{category.icon}</span>
              <span class="category-name">{category.title}</span>
            </div>
            <ul class="category-items">
              {#each category.items as item}
                <li class="update-item">
                  <span class="item-bullet">✦</span>
                  <span class="item-text">{@html sanitizeHtml(item)}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>

      <!-- Footer -->
      <div class="changelog-footer">
        <button class="continue-btn" on:click={closeModal}>
          Continuar <Sparkles size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .changelog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 5, 15, 0.92);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.4s ease;
    padding: 16px;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .changelog-card {
    background: linear-gradient(180deg, #12121f 0%, #0d0d1a 100%);
    border: 1px solid rgba(168, 85, 247, 0.25);
    border-radius: 20px;
    padding: 0;
    display: flex;
    flex-direction: column;
    box-shadow:
      0 0 60px rgba(168, 85, 247, 0.12),
      0 0 120px rgba(99, 102, 241, 0.06),
      0 20px 60px rgba(0, 0, 0, 0.5);
    animation: slideUpScale 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    max-width: 560px;
    width: 100%;
    max-height: 96vh;
    position: relative;
    overflow: hidden;
  }

  @keyframes slideUpScale {
    from { transform: translateY(30px) scale(0.95); opacity: 0; }
    to   { transform: translateY(0) scale(1); opacity: 1; }
  }

  /* Close button */
  .close-btn {
    position: absolute;
    top: 16px;
    right: 16px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #94a3b8;
    cursor: pointer;
    transition: all 0.2s ease;
    z-index: 10;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #e2e8f0;
    transform: rotate(90deg);
  }

  /* Header */
  .changelog-header {
    padding: 14px 32px 8px;
    text-align: center;
    border-bottom: 1px solid rgba(168, 85, 247, 0.1);
    position: relative;
    flex-shrink: 0;
  }

  .moon-container {
    display: flex;
    justify-content: center;
    margin-bottom: 6px;
    padding: 2px;
  }

  .moon-container :global(.moon-phase-svg) {
    filter: drop-shadow(0 0 24px rgba(240, 192, 64, 0.5)) drop-shadow(0 0 60px rgba(168, 85, 247, 0.15));
  }

  .version-badge {
    display: inline-block;
    background: rgba(168, 85, 247, 0.15);
    border: 1px solid rgba(168, 85, 247, 0.3);
    color: #c084fc;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 3px 12px;
    border-radius: 20px;
    margin-bottom: 6px;
    text-transform: uppercase;
  }

  .changelog-title {
    font-size: 1.3rem;
    font-weight: 700;
    color: #f1f5f9;
    margin: 0 0 3px;
    letter-spacing: -0.01em;
    background: linear-gradient(135deg, #f1f5f9 0%, #c084fc 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .changelog-date {
    font-size: 0.8rem;
    color: #64748b;
    margin: 0;
  }

  /* Version tabs */
  .version-tabs {
    display: flex;
    gap: 6px;
    padding: 8px 24px 0;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    flex-shrink: 0;
  }

  .version-tabs::-webkit-scrollbar {
    display: none;
  }

  .version-tab {
    flex: 0 0 auto;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    color: #94a3b8;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 6px 12px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .version-tab:hover {
    background: rgba(168, 85, 247, 0.08);
    color: #cbd5e1;
  }

  .version-tab.active {
    background: rgba(168, 85, 247, 0.15);
    border-color: rgba(168, 85, 247, 0.35);
    color: #c084fc;
  }

  .new-dot {
    width: 7px;
    height: 7px;
    background: #f0c040;
    border-radius: 50%;
    box-shadow: 0 0 8px #f0c040;
    animation: pulseDot 2s infinite;
  }

  @keyframes pulseDot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.85); }
  }

  /* Updates scrollable area */
  .updates-container {
    padding: 12px 32px 14px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    scrollbar-width: thin;
    scrollbar-color: rgba(168, 85, 247, 0.2) transparent;
  }

  .updates-container::-webkit-scrollbar {
    width: 4px;
  }

  .updates-container::-webkit-scrollbar-thumb {
    background: rgba(168, 85, 247, 0.25);
    border-radius: 4px;
  }

  .update-category {
    margin-bottom: 12px;
  }

  .category-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .category-icon {
    font-size: 1.1rem;
  }

  .category-name {
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #94a3b8;
  }

  .category-items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .update-item {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 9px;
    border-left: 2px solid rgba(168, 85, 247, 0.2);
    transition: background 0.2s ease;
  }

  .update-item:hover {
    background: rgba(255, 255, 255, 0.05);
    border-left-color: rgba(168, 85, 247, 0.5);
  }

  .item-bullet {
    color: #c084fc;
    font-size: 0.7rem;
    margin-top: 3px;
    flex-shrink: 0;
  }

  .item-text {
    font-size: 0.88rem;
    color: #cbd5e1;
    line-height: 1.4;
  }

  .item-text :global(strong) {
    color: #e2e8f0;
    font-weight: 600;
  }

  .item-text :global(code) {
    background: rgba(168, 85, 247, 0.1);
    color: #c084fc;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 0.8rem;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
  }

  /* Footer */
  .changelog-footer {
    padding: 8px 32px 12px;
    border-top: 1px solid rgba(168, 85, 247, 0.1);
    display: flex;
    justify-content: center;
    flex-shrink: 0;
  }

  .continue-btn {
    background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%);
    border: none;
    color: #fff;
    font-size: 0.9rem;
    font-weight: 600;
    padding: 10px 28px;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 20px rgba(124, 58, 237, 0.3);
    letter-spacing: 0.02em;
  }

  .continue-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(124, 58, 237, 0.45);
  }

  .continue-btn:active {
    transform: translateY(0);
  }

  /* Responsive */
  @media (max-width: 480px) {
    .changelog-card {
      max-height: 94vh;
      border-radius: 16px;
    }

    .changelog-header {
      padding: 18px 20px 12px;
    }

    .moon-container {
      margin-bottom: 10px;
    }

    .changelog-title {
      font-size: 1.25rem;
    }

    .version-tabs {
      padding: 8px 16px 0;
    }

    .updates-container {
      padding: 12px 20px 16px;
    }

    .changelog-footer {
      padding: 10px 20px 16px;
    }

    .continue-btn {
      width: 100%;
      padding: 11px 24px;
    }
  }

  @media (max-height: 700px) {
    .changelog-card {
      max-height: 96vh;
    }

    .changelog-header {
      padding: 16px 24px 10px;
    }

    .moon-container {
      margin-bottom: 8px;
    }

    .changelog-title {
      font-size: 1.3rem;
    }

    .updates-container {
      padding: 12px 28px 14px;
    }

    .changelog-footer {
      padding: 10px 24px 14px;
    }
  }
</style>
