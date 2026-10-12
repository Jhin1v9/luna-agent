<script>
  export let size = 80;
  export let color = '#c9a227';
  export let glowIntensity = 0.3;
  export let animated = true;
  export let extraStars = false;

  const BASE_STARS = [
    { x: 12, y: 18, r: 1.0, d: 0 },
    { x: 88, y: 22, r: 0.7, d: 0.4 },
    { x: 78, y: 78, r: 0.9, d: 0.8 },
    { x: 18, y: 82, r: 0.5, d: 1.2 },
    { x: 52, y: 10, r: 0.6, d: 1.6 },
    { x: 94, y: 58, r: 0.4, d: 2.0 },
    { x: 6,  y: 52, r: 0.8, d: 0.2 },
  ];

  const EXTRA_STARS = [
    { x: 36, y: 14, r: 0.4, d: 0.6 },
    { x: 68, y: 88, r: 0.7, d: 1.0 },
    { x: 14, y: 68, r: 0.3, d: 1.4 },
    { x: 90, y: 36, r: 0.5, d: 1.8 },
    { x: 48, y: 92, r: 0.4, d: 0.3 },
    { x: 62, y: 6,  r: 0.3, d: 0.9 },
    { x: 28, y: 94, r: 0.35, d: 1.5 },
    { x: 84, y: 74, r: 0.45, d: 0.1 },
  ];

  $: stars = extraStars ? [...BASE_STARS, ...EXTRA_STARS] : BASE_STARS;
</script>

<div class="moon-wrapper" class:animated style="--size: {size}px; --color: {color}; --glow: {glowIntensity};">
  <!-- Estrelas SVG ao redor -->
  <svg class="stars-svg" viewBox="0 0 100 100" width={size * 1.4} height={size * 1.4}>
    {#each stars as s}
      <circle cx={s.x} cy={s.y} r={s.r} fill="var(--color)" class="star" style="animation-delay: {s.d}s" />
    {/each}
  </svg>

  <!-- Lua com animação fluida de fase via box-shadow inset -->
  <div class="moon" class:animated>
    <div class="moon-glow"></div>
    <div class="moon-body" class:animated></div>
    <div class="moon-craters">
      <div class="crater c1"></div>
      <div class="crater c2"></div>
      <div class="crater c3"></div>
      <div class="crater c4"></div>
      <div class="crater c5"></div>
    </div>
  </div>
</div>

<style>
  .moon-wrapper {
    position: relative;
    width: var(--size);
    height: var(--size);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .stars-svg {
    position: absolute;
    inset: -20%;
    pointer-events: none;
    overflow: visible;
  }

  .star {
    animation: twinkle 2.5s ease-in-out infinite;
    opacity: 0.3;
  }

  @keyframes twinkle {
    0%, 100% { opacity: 0.15; transform: scale(0.7); }
    50% { opacity: 1; transform: scale(1.5); }
  }

  .moon {
    position: relative;
    width: calc(var(--size) * 0.75);
    height: calc(var(--size) * 0.75);
    border-radius: 50%;
    background: #1a1a2e;
    border: 1.5px solid var(--color);
    overflow: hidden;
    z-index: 2;
  }

  .moon.animated {
    animation: moonFloat 4s ease-in-out infinite;
    box-shadow:
      0 0 20px rgba(201, 162, 39, calc(var(--glow) * 0.5)),
      0 0 40px rgba(201, 162, 39, calc(var(--glow) * 0.2)),
      inset 0 0 20px rgba(0, 0, 0, 0.5);
  }

  @keyframes moonFloat {
    0%, 100% { transform: translateY(0) scale(1); }
    50% { transform: translateY(-3px) scale(1.02); }
  }

  /*
   * ================================================================
   * ANIMAÇÃO FLUIDA DA FASE LUNAR
   * Usa box-shadow inset para criar a sombra que se move sobre a lua.
   * A sombra começa cobrindo tudo (nova), vai diminuindo (crescente),
   * some (cheia), aumenta do outro lado (minguante), e reinicia.
   * ================================================================
   */
  .moon-body {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--color);
    opacity: 0.85;
  }

  .moon-body.animated {
    animation: moonPhase 5s ease-in-out infinite;
  }

  @keyframes moonPhase {
    /* 0% — Lua NOVA: sombra cobre tudo */
    0% {
      box-shadow: inset calc(var(--size) * 0.75) 0 0 0 #1a1a2e;
    }

    /* 12.5% — Crescente fina */
    12.5% {
      box-shadow: inset calc(var(--size) * 0.5) 0 0 0 #1a1a2e;
    }

    /* 25% — Quarto crescente */
    25% {
      box-shadow: inset calc(var(--size) * 0.25) 0 0 0 #1a1a2e;
    }

    /* 37.5% — Gibosa crescente */
    37.5% {
      box-shadow: inset calc(var(--size) * 0.05) 0 0 0 #1a1a2e;
    }

    /* 50% — Lua CHEIA: sombra some */
    50% {
      box-shadow: inset 0 0 0 0 transparent;
    }

    /* 62.5% — Gibosa minguante */
    62.5% {
      box-shadow: inset calc(var(--size) * -0.05) 0 0 0 #1a1a2e;
    }

    /* 75% — Quarto minguante */
    75% {
      box-shadow: inset calc(var(--size) * -0.25) 0 0 0 #1a1a2e;
    }

    /* 87.5% — Minguante fina */
    87.5% {
      box-shadow: inset calc(var(--size) * -0.5) 0 0 0 #1a1a2e;
    }

    /* 100% — Lua NOVA de novo */
    100% {
      box-shadow: inset calc(var(--size) * -0.75) 0 0 0 #1a1a2e;
    }
  }

  /* Craters */
  .moon-craters {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    overflow: hidden;
    pointer-events: none;
  }

  .crater {
    position: absolute;
    border-radius: 50%;
    background: #1a1a2e;
    opacity: 0.12;
  }

  .c1 { width: 12%; height: 12%; top: 28%; left: 30%; }
  .c2 { width: 16%; height: 16%; top: 45%; left: 52%; }
  .c3 { width: 10%; height: 10%; top: 58%; left: 42%; }
  .c4 { width: 8%;  height: 8%;  top: 50%; left: 28%; }
  .c5 { width: 10%; height: 10%; top: 32%; left: 55%; }

  /* Craters fade durante a lua nova */
  .animated .crater {
    animation: craterFade 5s ease-in-out infinite;
  }

  @keyframes craterFade {
    0%, 15%, 85%, 100% { opacity: 0.04; }
    50% { opacity: 0.15; }
  }
</style>
