<script>
  export let state = 'idle'; // 'idle' | 'thinking' | 'responding'
  export let size = 36;
  // Wave 10 T3: infinite pulse/spin runs only when the parent opts in
  // (AssistantMessage passes animate=isLast). Off → static visual.
  export let animate = true;

  $: isThinking = animate && state === 'thinking';
  $: isResponding = animate && state === 'responding';
</script>

<div
  class="luna-avatar"
  class:thinking={isThinking}
  class:responding={isResponding}
  class:static={!animate}
  style="width: {size}px; height: {size}px;"
  aria-label="Luna avatar"
  role="img"
>
  <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- Crescent moon shape -->
    <path
      class="moon-body"
      d="M52 36C52 47.046 42.598 56 31 56C19.402 56 10 47.046 10 36C10 24.954 19.402 16 31 16C31 16 28 20 28 26C28 32 32 36 38 36C44 36 52 32 52 36Z"
    />
    <!-- Face details -->
    <circle class="eye eye-left" cx="24" cy="30" r="2.5" />
    <circle class="eye eye-right" cx="34" cy="30" r="2.5" />
    <path
      class="mouth"
      d="M26 38C26 38 28 41 31 41C34 41 36 38 36 38"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <!-- Subtle glow orb behind -->
    <circle class="glow-orb" cx="32" cy="32" r="28" />
  </svg>
</div>

<style>
  .luna-avatar {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 50%;
  }

  .luna-avatar svg {
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .moon-body {
    fill: var(--luna-accent);
    opacity: 0.9;
    transition: fill 0.4s ease, transform 0.6s ease;
    transform-origin: center;
  }

  .glow-orb {
    fill: var(--luna-accent);
    opacity: 0;
    transform-origin: center;
    transition: opacity 0.4s ease;
    pointer-events: none;
  }

  .eye {
    fill: var(--luna-bg);
    transition: transform 0.3s ease;
    transform-origin: center;
  }

  .mouth {
    stroke: var(--luna-bg);
    stroke-width: 2;
    fill: none;
    transition: d 0.3s ease;
  }

  /* Idle state: gentle pulse glow */
  .luna-avatar:not(.thinking):not(.responding) .glow-orb {
    animation: pulseGlowOrb 3s ease-in-out infinite;
  }

  @keyframes pulseGlowOrb {
    0%, 100% { opacity: 0.08; transform: scale(1); }
    50% { opacity: 0.18; transform: scale(1.08); }
  }

  /* Thinking state: slow rotation + stronger glow */
  .luna-avatar.thinking {
    animation: rotateSlow 8s linear infinite;
  }

  .luna-avatar.thinking .glow-orb {
    opacity: 0.25;
    animation: pulseGlowStrong 2s ease-in-out infinite;
  }

  .luna-avatar.thinking .eye {
    animation: blink 4s ease-in-out infinite;
  }

  @keyframes rotateSlow {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes pulseGlowStrong {
    0%, 100% { opacity: 0.2; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(1.15); }
  }

  @keyframes blink {
    0%, 90%, 100% { transform: scaleY(1); }
    95% { transform: scaleY(0.1); }
  }

  /* Responding state: bounce scale + bright glow */
  .luna-avatar.responding {
    animation: bounceIn 0.5s ease-out;
  }

  .luna-avatar.responding .glow-orb {
    opacity: 0.5;
    animation: pulseGlowRespond 1.5s ease-in-out infinite;
  }

  .luna-avatar.responding .mouth {
    d: path("M26 38C26 38 28 40 31 40C34 40 36 38 36 38");
  }

  @keyframes bounceIn {
    0% { transform: scale(0.85); }
    50% { transform: scale(1.1); }
    100% { transform: scale(1); }
  }

  @keyframes pulseGlowRespond {
    0%, 100% { opacity: 0.3; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(1.2); }
  }

  /* Wave 10 T3: non-last messages render a static avatar — no animations,
     glow frozen at the mid-pulse opacity so it still reads as Luna */
  .luna-avatar.static .glow-orb {
    animation: none;
    opacity: 0.12;
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .luna-avatar,
    .luna-avatar.thinking,
    .luna-avatar.responding,
    .glow-orb,
    .eye {
      animation: none !important;
    }
  }
</style>
