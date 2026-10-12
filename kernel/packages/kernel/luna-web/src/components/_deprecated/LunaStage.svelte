<script>
  import { onMount, onDestroy } from 'svelte';
  import { mascotState, mascotMessage } from '../stores.js';

  let stageEl;
  let mascotGroup;
  let canvas;
  let ctx;
  let blinkTimer;
  let msgTimer;
  let bubbleTimer;

  // Posição da Luna no stage
  let currentX = 120;
  let isWalking = false;
  let facingRight = true;
  let walkRaf = null;
  let dustParticles = [];
  let dustRaf = null;

  // Speech bubble
  let showBubble = false;
  let bubbleText = '';

  // Eye tracking
  let pupilX = 0;
  let pupilY = 0;

  const MASCOT_W = 90;
  const MASCOT_H = 126;
  const WALK_SPEED = 220; // px/s
  const STAGE_H = 160;

  const MESSAGES = {
    sleep: ['Zzz... 💤', 'Sonhando com código...', '5 minutinhos...'],
    idle: ['Oi! 👋', 'Clique pra eu ir até lá!', 'Vamos criar algo? ✨'],
    thinking: ['Hmm... 🤔', 'Processando...', 'Quase lá!'],
    working: ['Digitando! ⌨️', 'Compilando...', 'Foco total! ⚡'],
    error: ['Ops! 😰', 'Deu ruim...', 'Vamos debugar! 🐛'],
    walk: ['Indo! 🏃‍♀️', 'Espera aí!', 'Chegando! ✨']
  };

  // ========== WALK ==========
  function handleStageClick(e) {
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const targetX = e.clientX - rect.left;
    const half = MASCOT_W / 2;
    const clamped = Math.max(half, Math.min(targetX, rect.width - half));
    
    // Se está dormindo, acorda primeiro com uma mensagem
    if ($mascotState === 'sleep') {
      showMsg('Hmm? *bocejo* Oi! 👋');
    } else {
      showMsg(MESSAGES.walk[Math.floor(Math.random() * MESSAGES.walk.length)]);
    }
    
    walkTo(clamped);
  }

  function walkTo(targetX) {
    if (walkRaf) cancelAnimationFrame(walkRaf);
    const startX = currentX;
    const dist = targetX - startX;
    if (Math.abs(dist) < 8) return;

    facingRight = dist > 0;
    const duration = Math.abs(dist) / WALK_SPEED;
    isWalking = true;
    let startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / (duration * 1000), 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      currentX = startX + (dist * eased);

      // Poeira a cada passo
      if (progress < 1 && Math.random() < 0.2) spawnDust();

      if (progress < 1) {
        walkRaf = requestAnimationFrame(step);
      } else {
        isWalking = false;
        walkRaf = null;
      }
    }
    walkRaf = requestAnimationFrame(step);
  }

  // ========== EYE TRACKING (relativo ao stage) ==========
  function handleMouseMove(e) {
    if (!mascotGroup) return;
    const rect = mascotGroup.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 3;
    const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
    const dist = Math.min(Math.hypot(e.clientX - cx, e.clientY - cy) / 30, 2.5);
    pupilX = Math.cos(angle) * dist;
    pupilY = Math.sin(angle) * dist;
  }

  // ========== BLINK ==========
  function scheduleBlink() {
    const delay = 2000 + Math.random() * 5000;
    blinkTimer = setTimeout(() => {
      if ($mascotState === 'sleep') { scheduleBlink(); return; }
      const lids = mascotGroup?.querySelectorAll('.eye-lid');
      lids?.forEach(lid => {
        lid.style.opacity = '1';
        setTimeout(() => { lid.style.opacity = '0'; }, 180);
      });
      scheduleBlink();
    }, delay);
  }

  // ========== SPEECH BUBBLE ==========
  function showMsg(text) {
    bubbleText = text;
    showBubble = true;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { showBubble = false; }, 3500);
  }

  function scheduleMsg() {
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => {
      if (isWalking) { scheduleMsg(); return; }
      const msgs = MESSAGES[$mascotState] || MESSAGES.idle;
      showMsg(msgs[Math.floor(Math.random() * msgs.length)]);
      scheduleMsg();
    }, 8000 + Math.random() * 7000);
  }

  $: if ($mascotMessage) {
    showMsg($mascotMessage);
    mascotMessage.set(null);
  }

  // ========== DUST PARTICLES ==========
  function spawnDust() {
    const x = currentX + (facingRight ? -15 : 15);
    const y = STAGE_H - 18;
    dustParticles.push({
      x, y,
      vx: (Math.random() - 0.5) * 2,
      vy: -1 - Math.random() * 1.5,
      life: 1,
      size: 2 + Math.random() * 3
    });
  }

  function animateDust() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    dustParticles = dustParticles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      p.life -= 0.03;
      if (p.life <= 0) return false;

      ctx.save();
      ctx.globalAlpha = p.life * 0.6;
      ctx.fillStyle = '#a0a0c0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return true;
    });

    dustRaf = requestAnimationFrame(animateDust);
  }

  // ========== RESIZE ==========
  function resizeCanvas() {
    if (!canvas || !stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    canvas.width = Math.max(rect.width, 100);
    canvas.height = STAGE_H;
  }

  // ========== LIFECYCLE ==========
  onMount(() => {
    resizeCanvas();
    if (canvas) {
      ctx = canvas.getContext('2d');
      animateDust();
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('resize', resizeCanvas);
    scheduleBlink();
    scheduleMsg();
  });

  onDestroy(() => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('resize', resizeCanvas);
    if (walkRaf) cancelAnimationFrame(walkRaf);
    if (dustRaf) cancelAnimationFrame(dustRaf);
    clearTimeout(blinkTimer);
    clearTimeout(msgTimer);
    clearTimeout(bubbleTimer);
  });
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="luna-stage"
  bind:this={stageEl}
  on:click={handleStageClick}
  role="region"
  aria-label="Área interativa da Luna"
>
  <!-- Grid do chão -->
  <div class="stage-floor"></div>

  <!-- Partículas canvas -->
  <canvas class="dust-canvas" bind:this={canvas}></canvas>

  <!-- Luna Mascot -->
  <div
    class="mascot-wrapper"
    class:walking={isWalking}
    style="left: {currentX}px;"
    data-state={$mascotState}
  >
    <!-- Speech Bubble -->
    {#if showBubble}
      <div class="stage-bubble" class:visible={showBubble}>
        {bubbleText}
      </div>
    {/if}

    <svg
      bind:this={mascotGroup}
      class="stage-svg"
      style="transform: scaleX({facingRight ? 1 : -1});"
      viewBox="0 0 200 280"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="skin" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stop-color="#FFE8D6"/>
          <stop offset="60%" stop-color="#FFD4B8"/>
          <stop offset="100%" stop-color="#F5C6A5"/>
        </radialGradient>
        <linearGradient id="hair" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#FFE66D"/>
          <stop offset="50%" stop-color="#FFD93D"/>
          <stop offset="100%" stop-color="#FFB347"/>
        </linearGradient>
        <radialGradient id="eye" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stop-color="#6EE7D8"/>
          <stop offset="50%" stop-color="#4ECDC4"/>
          <stop offset="100%" stop-color="#2A9D8F"/>
        </radialGradient>
        <radialGradient id="blush" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#FF8FAB" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="#FF8FAB" stop-opacity="0"/>
        </radialGradient>
      </defs>

      <!-- Shadow -->
      <ellipse cx="100" cy="265" rx="40" ry="6" fill="rgba(0,0,0,0.2)" class="shadow"/>

      <!-- Back Hair -->
      <g class="hair-back">
        <path d="M55 60 Q30 120 35 180 Q40 220 50 250 L150 250 Q160 220 165 180 Q170 120 145 60 Z" fill="url(#hair)"/>
        <path d="M45 70 Q10 100 15 160 Q18 200 30 230 L50 220 Q35 190 35 150 Q32 110 55 85 Z" fill="url(#hair)"/>
        <path d="M155 70 Q190 100 185 160 Q182 200 170 230 L150 220 Q165 190 165 150 Q168 110 145 85 Z" fill="url(#hair)"/>
      </g>

      <!-- Legs -->
      <g class="legs">
        <g class="leg-left">
          <rect x="74" y="200" width="14" height="45" rx="7" fill="url(#skin)"/>
          <rect x="74" y="220" width="14" height="25" rx="3" fill="#FFF"/>
          <rect x="74" y="220" width="14" height="4" rx="1" fill="#2D1B4E"/>
          <path d="M70 240 Q74 235 88 240 L90 255 Q81 260 72 255 Z" fill="#2D1B4E"/>
        </g>
        <g class="leg-right">
          <rect x="112" y="200" width="14" height="45" rx="7" fill="url(#skin)"/>
          <rect x="112" y="220" width="14" height="25" rx="3" fill="#FFF"/>
          <rect x="112" y="220" width="14" height="4" rx="1" fill="#2D1B4E"/>
          <path d="M110 240 Q119 235 130 240 L128 255 Q119 260 110 255 Z" fill="#2D1B4E"/>
        </g>
      </g>

      <!-- Skirt -->
      <path d="M65 180 Q100 175 135 180 L150 210 Q100 220 50 210 Z" fill="#2D1B4E"/>
      <path d="M75 180 L70 212" stroke="#1A0F2E" stroke-width="1.5" opacity="0.5"/>
      <path d="M90 178 L88 215" stroke="#1A0F2E" stroke-width="1.5" opacity="0.5"/>
      <path d="M110 178 L112 215" stroke="#1A0F2E" stroke-width="1.5" opacity="0.5"/>
      <path d="M125 180 L130 212" stroke="#1A0F2E" stroke-width="1.5" opacity="0.5"/>

      <!-- Body -->
      <g class="body-group">
        <rect x="76" y="140" width="48" height="50" rx="10" fill="#FFF"/>
        <path d="M70 145 Q100 165 130 145 L138 153 Q100 180 62 153 Z" fill="#2D1B4E"/>
        <rect x="92" y="130" width="16" height="15" fill="url(#skin)"/>
        <ellipse cx="100" cy="160" rx="12" ry="9" fill="#FF6B6B"/>
        <ellipse cx="90" cy="158" rx="9" ry="6" fill="#FF5252"/>
        <ellipse cx="110" cy="158" rx="9" ry="6" fill="#FF5252"/>
        <circle cx="100" cy="160" r="3" fill="#E53935"/>
      </g>

      <!-- Arms -->
      <g class="arms">
        <g class="arm-left">
          <rect x="57" y="148" width="11" height="36" rx="6" fill="url(#skin)" transform="rotate(15 62 166)"/>
          <rect x="54" y="142" width="15" height="17" rx="4" fill="#FFF"/>
          <rect x="54" y="155" width="15" height="4" rx="1" fill="#2D1B4E"/>
          <circle cx="53" cy="186" r="5.5" fill="url(#skin)"/>
        </g>
        <g class="arm-right">
          <rect x="132" y="148" width="11" height="36" rx="6" fill="url(#skin)" transform="rotate(-15 137 166)"/>
          <rect x="131" y="142" width="15" height="17" rx="4" fill="#FFF"/>
          <rect x="131" y="155" width="15" height="4" rx="1" fill="#2D1B4E"/>
          <circle cx="147" cy="186" r="5.5" fill="url(#skin)"/>
        </g>
      </g>

      <!-- Head -->
      <g class="head-group">
        <ellipse cx="100" cy="85" rx="40" ry="44" fill="url(#skin)"/>
        <ellipse cx="68" cy="94" rx="9" ry="5.5" fill="url(#blush)"/>
        <ellipse cx="132" cy="94" rx="9" ry="5.5" fill="url(#blush)"/>

        <!-- Eyes -->
        <g class="eyes">
          <g class="eye-left">
            <ellipse cx="78" cy="82" rx="13" ry="15" fill="white"/>
            <ellipse cx="78" cy="82" rx="9" ry="11" fill="url(#eye)"/>
            <circle cx="{78 + pupilX}" cy="{82 + pupilY}" r="4.5" fill="#1a1a2e"/>
            <circle cx="{82 + pupilX * 0.5}" cy="{78 + pupilY * 0.5}" r="3" fill="white" opacity="0.9"/>
            <rect class="eye-lid" x="62" y="64" width="32" height="38" rx="12" fill="#FFD4B8" opacity="0"/>
          </g>
          <g class="eye-right">
            <ellipse cx="122" cy="82" rx="13" ry="15" fill="white"/>
            <ellipse cx="122" cy="82" rx="9" ry="11" fill="url(#eye)"/>
            <circle cx="{122 + pupilX}" cy="{82 + pupilY}" r="4.5" fill="#1a1a2e"/>
            <circle cx="{126 + pupilX * 0.5}" cy="{78 + pupilY * 0.5}" r="3" fill="white" opacity="0.9"/>
            <rect class="eye-lid" x="106" y="64" width="32" height="38" rx="12" fill="#FFD4B8" opacity="0"/>
          </g>
        </g>

        <!-- Eyebrows -->
        <path d="M66 62 Q78 58 87 64" stroke="#D4A574" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <path d="M113 64 Q122 58 134 62" stroke="#D4A574" stroke-width="2.5" fill="none" stroke-linecap="round"/>

        <!-- Nose & Mouth -->
        <circle cx="100" cy="95" r="1.5" fill="#D4A574" opacity="0.6"/>
        <path class="mouth" d="M92 105 Q100 111 108 105" stroke="#D47676" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      </g>

      <!-- Front Hair -->
      <g class="hair-front">
        <path d="M60 55 Q70 72 84 58 Q94 75 105 56 Q115 72 128 57 Q140 68 140 50 Q130 26 100 24 Q70 26 60 50 Z" fill="url(#hair)"/>
        <path d="M62 50 Q57 78 60 108" stroke="url(#hair)" stroke-width="7" fill="none" stroke-linecap="round"/>
        <path d="M138 50 Q143 78 140 108" stroke="url(#hair)" stroke-width="7" fill="none" stroke-linecap="round"/>
      </g>

      <!-- Buns -->
      <circle cx="48" cy="42" r="13" fill="url(#hair)"/>
      <circle cx="48" cy="42" r="5" fill="#FF6B9D"/>
      <circle cx="152" cy="42" r="13" fill="url(#hair)"/>
      <circle cx="152" cy="42" r="5" fill="#FF6B9D"/>

      <!-- Tiara -->
      <path d="M74 48 Q100 38 126 48" stroke="#FFD93D" stroke-width="3" fill="none" stroke-linecap="round"/>
      <ellipse cx="100" cy="43" rx="4" ry="3" fill="#FF6B6B"/>

      <!-- State accessories -->
      <g class="zzz" opacity={$mascotState === 'sleep' ? 1 : 0}>
        <text x="155" y="25" font-family="monospace" font-size="13" fill="#8B9DC8" font-weight="bold">Z</text>
        <text x="165" y="14" font-family="monospace" font-size="10" fill="#8B9DC8">z</text>
      </g>
      <g class="bulb" opacity={$mascotState === 'thinking' ? 1 : 0}>
        <circle cx="165" cy="22" r="9" fill="#FFD93D"/>
        <rect x="161" y="29" width="8" height="5" rx="2" fill="#B8860B"/>
        <line x1="165" y1="8" x2="165" y2="2" stroke="#FFD93D" stroke-width="2"/>
      </g>
      <g class="phones" opacity={$mascotState === 'working' ? 1 : 0}>
        <path d="M46 68 Q46 35 100 30 Q154 35 154 68" fill="none" stroke="#2D1B4E" stroke-width="3.5"/>
        <rect x="40" y="58" width="12" height="18" rx="4" fill="#2D1B4E"/>
        <rect x="148" y="58" width="12" height="18" rx="4" fill="#2D1B4E"/>
      </g>
      <g class="tear" opacity={$mascotState === 'error' ? 1 : 0}>
        <circle cx="135" cy="92" r="3" fill="#4ECDC4" opacity="0.8"/>
      </g>
    </svg>
  </div>
</div>

<style>
  .luna-stage {
    position: relative;
    width: 100vw;
    height: 160px;
    background: linear-gradient(180deg, rgba(10,14,26,0) 0%, #0a0e1a 25%, #0d1220 100%);
    border-top: 1px solid rgba(255,255,255,0.05);
    overflow: hidden;
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
    z-index: 5;
  }

  /* Grid do chão */
  .stage-floor {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 50px;
    background:
      radial-gradient(circle, rgba(99,102,241,0.12) 1px, transparent 1px),
      linear-gradient(0deg, rgba(99,102,241,0.06) 1px, transparent 1px);
    background-size: 32px 32px, 100% 32px;
    opacity: 0.4;
    pointer-events: none;
  }

  /* Poeira canvas */
  .dust-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2;
  }

  /* Mascot wrapper */
  .mascot-wrapper {
    position: absolute;
    bottom: 8px;
    width: 90px;
    height: 126px;
    transform: translateX(-50%);
    z-index: 3;
    transition: filter 0.3s ease;
    filter: drop-shadow(0 4px 12px rgba(78,205,196,0.2));
  }

  /* Speech bubble */
  .stage-bubble {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%) translateY(6px) scale(0.95);
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid rgba(78,205,196,0.2);
    border-radius: 14px 14px 14px 4px;
    padding: 8px 12px;
    color: #fff;
    font-size: 11px;
    font-family: 'Inter', system-ui, sans-serif;
    white-space: nowrap;
    box-shadow: 0 6px 20px rgba(0,0,0,0.3);
    opacity: 0;
    pointer-events: none;
    transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    z-index: 10;
  }
  .stage-bubble.visible {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }

  /* SVG */
  .stage-svg {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
    transition: transform 0.2s ease;
  }

  /* ===== STATE GLOWS ===== */
  .mascot-wrapper[data-state="idle"] {
    filter: drop-shadow(0 4px 16px rgba(78,205,196,0.3));
  }
  .mascot-wrapper[data-state="thinking"] {
    filter: drop-shadow(0 4px 16px rgba(255,217,61,0.3));
  }
  .mascot-wrapper[data-state="working"] {
    filter: drop-shadow(0 4px 16px rgba(155,89,182,0.25));
  }
  .mascot-wrapper[data-state="sleep"] {
    filter: drop-shadow(0 4px 12px rgba(100,149,237,0.15));
    opacity: 0.75;
  }
  .mascot-wrapper[data-state="error"] {
    filter: drop-shadow(0 4px 16px rgba(231,76,60,0.3));
  }

  /* ===== IDLE ANIMATIONS ===== */
  .body-group {
    animation: breathe 3s ease-in-out infinite;
    transform-origin: center bottom;
  }
  @keyframes breathe {
    0%, 100% { transform: scaleY(1) translateY(0); }
    50% { transform: scaleY(1.015) translateY(-1.5px); }
  }

  .hair-back {
    animation: hair-sway 4s ease-in-out infinite;
    transform-origin: 100px 60px;
  }
  @keyframes hair-sway {
    0%, 100% { transform: rotate(0deg); }
    50% { transform: rotate(1.5deg); }
  }

  /* ===== WALK CYCLE ===== */
  .mascot-wrapper.walking .leg-left {
    animation: walk-leg 0.45s ease-in-out infinite alternate;
    transform-origin: 81px 200px;
  }
  .mascot-wrapper.walking .leg-right {
    animation: walk-leg 0.45s ease-in-out infinite alternate-reverse;
    transform-origin: 119px 200px;
  }
  .mascot-wrapper.walking .arm-left {
    animation: walk-arm 0.45s ease-in-out infinite alternate-reverse;
    transform-origin: 62px 148px;
  }
  .mascot-wrapper.walking .arm-right {
    animation: walk-arm 0.45s ease-in-out infinite alternate;
    transform-origin: 138px 148px;
  }
  .mascot-wrapper.walking .hair-back {
    animation: hair-walk 0.45s ease-in-out infinite alternate;
    transform-origin: 100px 60px;
  }
  .mascot-wrapper.walking .head-group {
    animation: head-bob 0.45s ease-in-out infinite alternate;
    transform-origin: 100px 130px;
  }
  .mascot-wrapper.walking .shadow {
    animation: shadow-walk 0.45s ease-in-out infinite alternate;
    transform-origin: 100px 265px;
  }

  @keyframes walk-leg {
    0% { transform: rotate(-18deg) translateY(0); }
    100% { transform: rotate(18deg) translateY(-3px); }
  }
  @keyframes walk-arm {
    0% { transform: rotate(22deg); }
    100% { transform: rotate(-22deg); }
  }
  @keyframes hair-walk {
    0% { transform: rotate(-3deg); }
    100% { transform: rotate(3deg); }
  }
  @keyframes head-bob {
    0% { transform: translateY(0); }
    100% { transform: translateY(-2px); }
  }
  @keyframes shadow-walk {
    0% { transform: scaleX(1); opacity: 1; }
    100% { transform: scaleX(0.8); opacity: 0.6; }
  }

  /* ===== THINKING ===== */
  .mascot-wrapper[data-state="thinking"] .head-group {
    animation: think-tilt 2s ease-in-out infinite;
    transform-origin: 100px 130px;
  }
  .mascot-wrapper[data-state="thinking"] .arm-left {
    animation: think-arm 2s ease-in-out infinite;
    transform-origin: 62px 148px;
  }
  @keyframes think-tilt {
    0%, 100% { transform: rotate(0deg); }
    50% { transform: rotate(4deg); }
  }
  @keyframes think-arm {
    0%, 100% { transform: rotate(12deg); }
    50% { transform: rotate(32deg); }
  }

  /* ===== WORKING ===== */
  .mascot-wrapper[data-state="working"] .arm-left {
    animation: type-left 0.25s ease-in-out infinite alternate;
    transform-origin: 62px 148px;
  }
  .mascot-wrapper[data-state="working"] .arm-right {
    animation: type-right 0.25s ease-in-out infinite alternate-reverse;
    transform-origin: 138px 148px;
  }
  .mascot-wrapper[data-state="working"] .head-group {
    animation: focus-bob 0.5s ease-in-out infinite alternate;
  }
  @keyframes type-left {
    0% { transform: rotate(8deg) translateY(0); }
    100% { transform: rotate(22deg) translateY(-2px); }
  }
  @keyframes type-right {
    0% { transform: rotate(-8deg) translateY(0); }
    100% { transform: rotate(-22deg) translateY(-2px); }
  }
  @keyframes focus-bob {
    0% { transform: translateY(0); }
    100% { transform: translateY(1px); }
  }

  /* ===== SLEEP ===== */
  .mascot-wrapper[data-state="sleep"] {
    animation: float-sleep 5s ease-in-out infinite;
  }
  .mascot-wrapper[data-state="sleep"] .head-group {
    animation: sleep-tilt 3s ease-in-out infinite;
    transform-origin: 100px 130px;
  }
  @keyframes float-sleep {
    0%, 100% { transform: translateX(-50%) translateY(0); }
    50% { transform: translateX(-50%) translateY(-3px); }
  }
  @keyframes sleep-tilt {
    0%, 100% { transform: rotate(0deg); }
    50% { transform: rotate(2deg); }
  }

  /* ===== ERROR ===== */
  .mascot-wrapper[data-state="error"] .head-group {
    animation: shake-head 0.35s ease-in-out infinite;
    transform-origin: 100px 130px;
  }
  @keyframes shake-head {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-2px); }
    75% { transform: translateX(2px); }
  }

  /* ===== TRANSITIONS ===== */
  .zzz, .bulb, .phones, .tear {
    transition: opacity 0.4s ease;
  }

  /* Mobile */
  @media (max-width: 768px) {
    .luna-stage {
      height: 120px;
    }
    .mascot-wrapper {
      width: 68px;
      height: 95px;
    }
    .stage-bubble {
      font-size: 10px;
      padding: 6px 10px;
    }
  }
</style>
