<script>
  import { onMount, onDestroy } from 'svelte';
  import { mascotState, mascotMessage } from '../stores.js';

  export let size = 180;
  export let floating = true;

  let containerEl;
  let canvas;
  let ctx;
  let particles = [];
  let blinkTimer;
  let messageTimer;
  let bubbleTimer;
  let walkTimer;
  let currentMessage = '';
  let showBubble = false;
  let isHovering = false;
  let clicked = false;
  let isWalking = false;
  let facingRight = true;
  let targetX = null;
  let targetY = null;
  let currentX = 0;
  let currentY = 0;

  const MESSAGES = {
    sleep: [
      'Zzz... tô sonhando com código...',
      '5 minutinhos só... *ronrona*',
      'Me acorda com café, tá? ☕',
      'Hora da soneca... 🌙'
    ],
    idle: [
      'Oi! Sou a Luna ✨',
      'Vamos criar algo incrível?',
      'Tô de olho em você! 👀',
      'Manda ver, chefia! 💪'
    ],
    thinking: [
      'Hmm, deixa eu pensar... 🤔',
      'Processando... 🧠',
      'Quase lá! 💭',
      'Analisando todas as possibilidades...'
    ],
    working: [
      'Digitando na velocidade da luz! ⚡',
      'Código bonito é código que funciona 💅',
      'Compilando... se der erro eu finjo que não vi 🙈',
      'Prontinho! 🎉'
    ],
    error: [
      'Ops! Algo deu errado... 😰',
      'Vamos tentar de novo? 🤞',
      'Erro é só oportunidade de debugar! 🐛'
    ]
  };

  const CLICK_REACTIONS = [
    'Hehe! Faz cócegas! 😄',
    'Opa! Cuidado! 🌙',
    'Você é curioso! 🤔',
    'Pronta pra ajudar! 💪',
    'Ei! Tô trabalhando aqui! 😤'
  ];

  // ========== EYE TRACKING ==========
  function handleMouseMove(e) {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 3; // olhos ficam mais acima
    const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
    const distance = Math.min(Math.hypot(e.clientX - centerX, e.clientY - centerY) / 25, 3);
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    const pupils = containerEl.querySelectorAll('.pupil-left, .pupil-right');
    const highlights = containerEl.querySelectorAll('.highlight-left, .highlight-right');
    pupils.forEach(p => { p.style.transform = `translate(${x}px, ${y}px)`; });
    highlights.forEach(h => { h.style.transform = `translate(${x * 0.5}px, ${y * 0.5}px)`; });
  }

  // ========== BLINK ==========
  function scheduleBlink() {
    const delay = 2500 + Math.random() * 4000;
    blinkTimer = setTimeout(() => {
      if ($mascotState === 'sleep') { scheduleBlink(); return; }
      const eyes = containerEl?.querySelectorAll('.eye-lid');
      eyes?.forEach(eye => {
        eye.style.animation = 'none';
        eye.offsetHeight;
        eye.style.animation = 'blink-anim 0.2s ease-in-out';
        setTimeout(() => { eye.style.animation = ''; }, 200);
      });
      scheduleBlink();
    }, delay);
  }

  // ========== WALK TO POINT ==========
  function handleDocumentClick(e) {
    // Não move se clicou no próprio mascote ou no chat input
    if (e.target.closest('.luna-mascot-container')) return;
    if (e.target.closest('input, textarea, button, [contenteditable]')) return;
    if (e.target.closest('.chat-input-container, .sidebar, .config-drawer')) return;

    const container = containerEl;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.bottom;
    const endX = e.clientX;
    const endY = e.clientY;

    // Define direção
    facingRight = endX > startX;

    // Calcula distância e tempo de caminhada
    const dist = Math.hypot(endX - startX, endY - startY);
    const duration = Math.min(Math.max(dist / 150, 0.4), 2.0); // 0.4s a 2s

    isWalking = true;
    container.style.transition = `left ${duration}s ease-in-out, top ${duration}s ease-in-out, transform ${duration * 0.3}s ease`;
    container.style.left = `${endX - rect.width / 2}px`;
    container.style.top = `${endY - rect.height}px`;

    // Mostra mensagem de caminhada
    showMessage('Indo até aí! 🚶‍♀️');

    clearTimeout(walkTimer);
    walkTimer = setTimeout(() => {
      isWalking = false;
      container.style.transition = 'filter 0.4s ease, transform 0.3s ease';
    }, duration * 1000);
  }

  // ========== HOVER / CLICK ==========
  function handleMouseEnter() {
    isHovering = true;
    if (!isWalking) showMessage('Oi! Precisa de ajuda? 👋');
    spawnHeartParticles();
  }
  function handleMouseLeave() {
    isHovering = false;
    showBubble = false;
  }
  function handleClick(e) {
    e.stopPropagation();
    clicked = true;
    setTimeout(() => { clicked = false; }, 600);
    showMessage(CLICK_REACTIONS[Math.floor(Math.random() * CLICK_REACTIONS.length)]);
    spawnStarParticles(e.clientX, e.clientY);
    jump();
  }

  function jump() {
    if (!containerEl) return;
    const body = containerEl.querySelector('.character-body');
    if (body) {
      body.style.animation = 'none';
      body.offsetHeight;
      body.style.animation = 'jump-anim 0.5s ease-in-out';
      setTimeout(() => { body.style.animation = ''; }, 500);
    }
  }

  // ========== MESSAGES ==========
  function showMessage(text) {
    currentMessage = text;
    showBubble = true;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { showBubble = false; }, 4000);
  }
  function scheduleMessage(state) {
    clearTimeout(messageTimer);
    const delay = 7000 + Math.random() * 6000;
    messageTimer = setTimeout(() => {
      const msgs = MESSAGES[state] || MESSAGES.idle;
      showMessage(msgs[Math.floor(Math.random() * msgs.length)]);
      scheduleMessage(state);
    }, delay);
  }

  // ========== PARTICLES ==========
  function initParticles() {
    if (!canvas || !containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    canvas.width = rect.width + 80;
    canvas.height = rect.height + 80;
    ctx = canvas.getContext('2d');
    animateParticles();
  }
  function animateParticles() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const state = $mascotState;
    if (state === 'sleep' && Math.random() < 0.03) particles.push(createZzz());
    else if (state === 'thinking' && Math.random() < 0.05) particles.push(createSpark());
    else if (state === 'working' && Math.random() < 0.08) particles.push(createCode());
    particles = particles.filter(p => { p.update(); p.draw(ctx); return p.life > 0; });
    requestAnimationFrame(animateParticles);
  }
  function createZzz() {
    const cx = canvas.width / 2, cy = canvas.height / 3;
    return { x: cx + (Math.random()-0.5)*30, y: cy, vx: (Math.random()-0.5)*0.3, vy: -0.4-Math.random()*0.4, life: 1, size: 10, text: 'z', update() { this.x+=this.vx; this.y+=this.vy; this.life-=0.007; this.size+=0.08; }, draw(c) { c.save(); c.globalAlpha=this.life; c.font=`${this.size}px sans-serif`; c.fillStyle='#8B9DC3'; c.fillText(this.text,this.x,this.y); c.restore(); } };
  }
  function createSpark() {
    const cx = canvas.width / 2;
    return { x: cx, y: 20, vx: (Math.random()-0.5)*2, vy: -1-Math.random(), life: 1, size: 2+Math.random()*2, update() { this.x+=this.vx; this.y+=this.vy; this.life-=0.02; }, draw(c) { c.save(); c.globalAlpha=this.life; c.fillStyle='#FFD93D'; c.shadowColor='#FFD93D'; c.shadowBlur=8; c.beginPath(); c.arc(this.x,this.y,this.size,0,Math.PI*2); c.fill(); c.restore(); } };
  }
  function createCode() {
    const symbols = ['{ }', '</>', '01', '++', '=>']; const cx = canvas.width / 2;
    return { x: cx + (Math.random()-0.5)*50, y: canvas.height*0.6, vy: -0.3-Math.random()*0.4, life: 1, size: 9, text: symbols[Math.floor(Math.random()*symbols.length)], update() { this.y+=this.vy; this.life-=0.01; }, draw(c) { c.save(); c.globalAlpha=this.life*0.5; c.font='9px monospace'; c.fillStyle='#C9A227'; c.fillText(this.text,this.x,this.y); c.restore(); } };
  }
  function spawnHeartParticles() {
    const cx = canvas.width / 2, cy = canvas.height / 2;
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        particles.push({ x: cx, y: cy, vx: (Math.random()-0.5)*3, vy: -2-Math.random()*2, life: 1, size: 8+Math.random()*8, update() { this.x+=this.vx; this.y+=this.vy; this.vy+=0.05; this.life-=0.015; }, draw(c) { c.save(); c.globalAlpha=this.life; c.fillStyle='#FF6B9D'; c.font=`${this.size}px sans-serif`; c.fillText('❤',this.x,this.y); c.restore(); } });
      }, i * 100);
    }
  }
  function spawnStarParticles(cx, cy) {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const lx = cx - rect.left + 40, ly = cy - rect.top + 40;
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 / 8) * i;
      particles.push({ x: lx, y: ly, vx: Math.cos(angle)*3, vy: Math.sin(angle)*3, life: 1, size: 3+Math.random()*3, update() { this.x+=this.vx; this.y+=this.vy; this.vx*=0.95; this.vy*=0.95; this.life-=0.02; }, draw(c) { c.save(); c.globalAlpha=this.life; c.fillStyle='#FFD93D'; c.beginPath(); c.arc(this.x,this.y,this.size,0,Math.PI*2); c.fill(); c.restore(); } });
    }
  }

  // ========== STORE REACTIVITY ==========
  $: if ($mascotMessage) { showMessage($mascotMessage); mascotMessage.set(null); }
  let lastState = 'sleep';
  $: if ($mascotState && $mascotState !== lastState && containerEl) {
    lastState = $mascotState;
    const msgs = MESSAGES[$mascotState] || MESSAGES.idle;
    showMessage(msgs[Math.floor(Math.random() * msgs.length)]);
    scheduleMessage($mascotState);
    // Flash transition
    containerEl.style.filter = 'brightness(1.3)';
    setTimeout(() => { containerEl.style.filter = ''; }, 200);
  }

  onMount(() => {
    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('click', handleDocumentClick);
    scheduleBlink();
    initParticles();
    scheduleMessage($mascotState);
  });

  onDestroy(() => {
    window.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('click', handleDocumentClick);
    clearTimeout(blinkTimer);
    clearTimeout(messageTimer);
    clearTimeout(bubbleTimer);
    clearTimeout(walkTimer);
  });
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="luna-mascot-container"
  class:clicked
  class:walking={isWalking}
  data-state={$mascotState}
  style="width: {size}px; height: {size * 1.4}px;"
  bind:this={containerEl}
  on:mouseenter={handleMouseEnter}
  on:mouseleave={handleMouseLeave}
  on:click={handleClick}
>
  <!-- Speech Bubble -->
  {#if showBubble && currentMessage}
    <div class="speech-bubble" class:visible={showBubble}>
      <span>{currentMessage}</span>
    </div>
  {/if}

  <!-- Particles -->
  <canvas class="particle-canvas" bind:this={canvas}></canvas>

  <!-- SVG Character -->
  <svg viewBox="0 0 200 280" class="character-svg" xmlns="http://www.w3.org/2000/svg" class:facing-left={!facingRight}>
    <defs>
      <!-- Skin gradient -->
      <radialGradient id="skin-grad" cx="40%" cy="40%" r="60%">
        <stop offset="0%" stop-color="#FFE8D6"/>
        <stop offset="60%" stop-color="#FFD4B8"/>
        <stop offset="100%" stop-color="#F5C6A5"/>
      </radialGradient>
      <!-- Hair gradient -->
      <linearGradient id="hair-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#FFE66D"/>
        <stop offset="50%" stop-color="#FFD93D"/>
        <stop offset="100%" stop-color="#FFB347"/>
      </linearGradient>
      <!-- Hair pink accent -->
      <linearGradient id="hair-pink" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#FF8FAB"/>
        <stop offset="100%" stop-color="#FF6B9D"/>
      </linearGradient>
      <!-- Eye gradient -->
      <radialGradient id="eye-grad" cx="40%" cy="40%" r="60%">
        <stop offset="0%" stop-color="#6EE7D8"/>
        <stop offset="50%" stop-color="#4ECDC4"/>
        <stop offset="100%" stop-color="#2A9D8F"/>
      </radialGradient>
      <!-- Blush -->
      <radialGradient id="blush-grad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#FF8FAB" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="#FF8FAB" stop-opacity="0"/>
      </radialGradient>
      <!-- Glow filter -->
      <filter id="char-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>

    <!-- Shadow -->
    <ellipse cx="100" cy="265" rx="45" ry="8" fill="rgba(0,0,0,0.15)" class="shadow"/>

    <!-- ===== BACK HAIR ===== -->
    <g class="hair-back">
      <!-- Long hair flowing down -->
      <path d="M 55 60 Q 30 120 35 180 Q 40 220 50 250 L 150 250 Q 160 220 165 180 Q 170 120 145 60 Z" fill="url(#hair-grad)"/>
      <!-- Left pigtail -->
      <path d="M 45 70 Q 10 100 15 160 Q 18 200 30 230 L 50 220 Q 35 190 35 150 Q 32 110 55 85 Z" fill="url(#hair-grad)"/>
      <!-- Right pigtail -->
      <path d="M 155 70 Q 190 100 185 160 Q 182 200 170 230 L 150 220 Q 165 190 165 150 Q 168 110 145 85 Z" fill="url(#hair-grad)"/>
      <!-- Hair shines -->
      <ellipse cx="60" cy="100" rx="8" ry="4" fill="rgba(255,255,255,0.3)" transform="rotate(-20 60 100)"/>
      <ellipse cx="140" cy="110" rx="6" ry="3" fill="rgba(255,255,255,0.25)" transform="rotate(15 140 110)"/>
    </g>

    <!-- ===== LEGS ===== -->
    <g class="legs">
      <!-- Left leg -->
      <g class="leg-left">
        <rect x="72" y="200" width="14" height="45" rx="7" fill="url(#skin-grad)"/>
        <!-- Sock -->
        <rect x="72" y="220" width="14" height="25" rx="3" fill="#FFFFFF"/>
        <rect x="72" y="220" width="14" height="4" rx="1" fill="#2D1B4E"/>
        <!-- Shoe -->
        <path d="M 68 240 Q 72 235 86 240 L 88 255 Q 79 260 70 255 Z" fill="#2D1B4E"/>
        <ellipse cx="79" cy="242" rx="4" ry="2" fill="#FFD93D"/>
      </g>
      <!-- Right leg -->
      <g class="leg-right">
        <rect x="114" y="200" width="14" height="45" rx="7" fill="url(#skin-grad)"/>
        <!-- Sock -->
        <rect x="114" y="220" width="14" height="25" rx="3" fill="#FFFFFF"/>
        <rect x="114" y="220" width="14" height="4" rx="1" fill="#2D1B4E"/>
        <!-- Shoe -->
        <path d="M 112 240 Q 121 235 132 240 L 130 255 Q 121 260 112 255 Z" fill="#2D1B4E"/>
        <ellipse cx="121" cy="242" rx="4" ry="2" fill="#FFD93D"/>
      </g>
    </g>

    <!-- ===== SKIRT ===== -->
    <g class="skirt">
      <path d="M 65 180 Q 100 175 135 180 L 150 210 Q 100 220 50 210 Z" fill="#2D1B4E"/>
      <!-- Pleats -->
      <path d="M 75 180 L 70 212" stroke="#1A0F2E" stroke-width="1.5" opacity="0.5"/>
      <path d="M 90 178 L 88 215" stroke="#1A0F2E" stroke-width="1.5" opacity="0.5"/>
      <path d="M 110 178 L 112 215" stroke="#1A0F2E" stroke-width="1.5" opacity="0.5"/>
      <path d="M 125 180 L 130 212" stroke="#1A0F2E" stroke-width="1.5" opacity="0.5"/>
    </g>

    <!-- ===== BODY / UNIFORM ===== -->
    <g class="body-group">
      <!-- Torso -->
      <rect x="75" y="140" width="50" height="50" rx="10" fill="#FFFFFF"/>
      <!-- Collar (sailor style) -->
      <path d="M 70 145 Q 100 165 130 145 L 140 155 Q 100 185 60 155 Z" fill="#2D1B4E"/>
      <!-- Collar stripes -->
      <path d="M 72 150 Q 100 168 128 150" stroke="white" stroke-width="1" fill="none" opacity="0.6"/>
      <path d="M 74 155 Q 100 172 126 155" stroke="white" stroke-width="1" fill="none" opacity="0.4"/>
      <!-- Neck -->
      <rect x="92" y="130" width="16" height="15" fill="url(#skin-grad)"/>
      <!-- Red bow tie -->
      <g class="bow">
        <ellipse cx="100" cy="160" rx="14" ry="10" fill="#FF6B6B"/>
        <ellipse cx="88" cy="158" rx="10" ry="7" fill="#FF5252"/>
        <ellipse cx="112" cy="158" rx="10" ry="7" fill="#FF5252"/>
        <circle cx="100" cy="160" r="4" fill="#E53935"/>
      </g>
    </g>

    <!-- ===== ARMS ===== -->
    <g class="arms">
      <!-- Left arm -->
      <g class="arm-left">
        <rect x="55" y="148" width="12" height="38" rx="6" fill="url(#skin-grad)" transform="rotate(15 61 167)"/>
        <!-- Sleeve -->
        <rect x="52" y="142" width="16" height="18" rx="4" fill="#FFFFFF"/>
        <rect x="52" y="156" width="16" height="4" rx="1" fill="#2D1B4E"/>
        <!-- Hand -->
        <circle cx="52" cy="188" r="6" fill="url(#skin-grad)"/>
      </g>
      <!-- Right arm -->
      <g class="arm-right">
        <rect x="133" y="148" width="12" height="38" rx="6" fill="url(#skin-grad)" transform="rotate(-15 139 167)"/>
        <!-- Sleeve -->
        <rect x="132" y="142" width="16" height="18" rx="4" fill="#FFFFFF"/>
        <rect x="132" y="156" width="16" height="4" rx="1" fill="#2D1B4E"/>
        <!-- Hand -->
        <circle cx="148" cy="188" r="6" fill="url(#skin-grad)"/>
      </g>
    </g>

    <!-- ===== HEAD ===== -->
    <g class="head-group">
      <!-- Face shape -->
      <ellipse cx="100" cy="85" rx="42" ry="46" fill="url(#skin-grad)"/>

      <!-- Blush -->
      <ellipse cx="68" cy="95" rx="10" ry="6" fill="url(#blush-grad)"/>
      <ellipse cx="132" cy="95" rx="10" ry="6" fill="url(#blush-grad)"/>

      <!-- Eyes -->
      <g class="eyes">
        <!-- Left eye -->
        <g class="eye-left">
          <ellipse cx="78" cy="82" rx="14" ry="16" fill="white"/>
          <ellipse cx="78" cy="82" rx="10" ry="12" fill="url(#eye-grad)" class="iris"/>
          <circle class="pupil-left" cx="78" cy="82" r="5" fill="#1a1a2e"/>
          <circle class="highlight-left" cx="82" cy="78" r="3.5" fill="white" opacity="0.9"/>
          <circle cx="75" cy="86" r="1.5" fill="white" opacity="0.5"/>
          <!-- Eyelid for blink -->
          <rect class="eye-lid" x="60" y="60" width="36" height="44" rx="14" fill="#FFD4B8" opacity="0" transform-origin="78 82"/>
        </g>
        <!-- Right eye -->
        <g class="eye-right">
          <ellipse cx="122" cy="82" rx="14" ry="16" fill="white"/>
          <ellipse cx="122" cy="82" rx="10" ry="12" fill="url(#eye-grad)" class="iris"/>
          <circle class="pupil-right" cx="122" cy="82" r="5" fill="#1a1a2e"/>
          <circle class="highlight-right" cx="126" cy="78" r="3.5" fill="white" opacity="0.9"/>
          <circle cx="119" cy="86" r="1.5" fill="white" opacity="0.5"/>
          <!-- Eyelid for blink -->
          <rect class="eye-lid" x="104" y="60" width="36" height="44" rx="14" fill="#FFD4B8" opacity="0" transform-origin="122 82"/>
        </g>
      </g>

      <!-- Eyebrows -->
      <path class="eyebrow-left" d="M 65 62 Q 78 58 88 64" stroke="#D4A574" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path class="eyebrow-right" d="M 112 64 Q 122 58 135 62" stroke="#D4A574" stroke-width="2.5" fill="none" stroke-linecap="round"/>

      <!-- Nose -->
      <circle cx="100" cy="96" r="1.5" fill="#D4A574" opacity="0.6"/>

      <!-- Mouth -->
      <path class="mouth" d="M 92 105 Q 100 112 108 105" stroke="#D47676" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    </g>

    <!-- ===== FRONT HAIR ===== -->
    <g class="hair-front">
      <!-- Bangs -->
      <path d="M 58 55 Q 70 75 85 60 Q 95 78 105 58 Q 115 75 130 58 Q 142 70 142 50 Q 130 25 100 22 Q 70 25 58 50 Z" fill="url(#hair-grad)"/>
      <!-- Hair strands -->
      <path d="M 60 50 Q 55 80 58 110" stroke="url(#hair-grad)" stroke-width="8" fill="none" stroke-linecap="round"/>
      <path d="M 140 50 Q 145 80 142 110" stroke="url(#hair-grad)" stroke-width="8" fill="none" stroke-linecap="round"/>
      <!-- Heart shaped bang center -->
      <path d="M 95 30 Q 100 25 105 30 Q 110 25 112 35 Q 105 45 100 40 Q 95 45 88 35 Q 90 25 95 30" fill="#FFE66D"/>
    </g>

    <!-- ===== ACCESSORIES ===== -->
    <!-- Tiara -->
    <g class="tiara">
      <path d="M 72 48 Q 100 38 128 48" stroke="#FFD93D" stroke-width="3" fill="none" stroke-linecap="round"/>
      <ellipse cx="100" cy="43" rx="5" ry="4" fill="#FF6B6B"/>
      <ellipse cx="100" cy="43" rx="2.5" ry="2" fill="#FF8FAB"/>
    </g>

    <!-- Hair buns / Odango -->
    <g class="buns">
      <circle cx="48" cy="42" r="14" fill="url(#hair-grad)"/>
      <circle cx="48" cy="42" r="10" fill="url(#hair-pink)" opacity="0.6"/>
      <circle cx="48" cy="42" r="5" fill="#FF6B9D"/>
      <circle cx="152" cy="42" r="14" fill="url(#hair-grad)"/>
      <circle cx="152" cy="42" r="10" fill="url(#hair-pink)" opacity="0.6"/>
      <circle cx="152" cy="42" r="5" fill="#FF6B9D"/>
      <!-- Red discs in buns -->
      <circle cx="48" cy="42" r="3" fill="#E53935"/>
      <circle cx="152" cy="42" r="3" fill="#E53935"/>
    </g>

    <!-- Sleeping Zzz (visible in sleep state) -->
    <g class="zzz-group">
      <text x="150" y="30" font-family="monospace" font-size="14" fill="#8B9DC8" font-weight="bold">Z</text>
      <text x="160" y="18" font-family="monospace" font-size="10" fill="#8B9DC8">z</text>
      <text x="167" y="8" font-family="monospace" font-size="8" fill="#8B9DC8">z</text>
    </g>

    <!-- Thinking lightbulb -->
    <g class="lightbulb">
      <circle cx="165" cy="25" r="10" fill="#FFD93D" opacity="0.9"/>
      <rect x="160" y="33" width="10" height="6" rx="2" fill="#B8860B"/>
      <line x1="155" y1="20" x2="148" y2="15" stroke="#FFD93D" stroke-width="2" stroke-linecap="round"/>
      <line x1="175" y1="20" x2="182" y2="15" stroke="#FFD93D" stroke-width="2" stroke-linecap="round"/>
      <line x1="165" y1="10" x2="165" y2="2" stroke="#FFD93D" stroke-width="2" stroke-linecap="round"/>
    </g>

    <!-- Working headphones -->
    <g class="headphones">
      <path d="M 45 70 Q 45 35 100 30 Q 155 35 155 70" fill="none" stroke="#2D1B4E" stroke-width="4"/>
      <rect x="38" y="60" width="14" height="20" rx="5" fill="#2D1B4E"/>
      <rect x="148" y="60" width="14" height="20" rx="5" fill="#2D1B4E"/>
      <circle cx="45" cy="68" r="3" fill="#4ECDC4">
        <animate attributeName="opacity" values="1;0.3;1" dur="0.8s" repeatCount="indefinite"/>
      </circle>
      <circle cx="155" cy="68" r="3" fill="#4ECDC4">
        <animate attributeName="opacity" values="1;0.3;1" dur="0.8s" repeatCount="indefinite"/>
      </circle>
    </g>

    <!-- Error tear -->
    <g class="tear">
      <path d="M 135 88 Q 138 95 135 102 Q 132 95 135 88" fill="#4ECDC4" opacity="0.8">
        <animateTransform attributeName="transform" type="translate" values="0,0; 0,10; 0,0" dur="1.5s" repeatCount="indefinite"/>
      </path>
    </g>
  </svg>
</div>

<style>
  .luna-mascot-container {
    position: relative;
    cursor: pointer;
    filter: drop-shadow(0 8px 24px rgba(78, 205, 196, 0.25));
    transition: filter 0.4s ease, left 0.5s ease-in-out, top 0.5s ease-in-out, transform 0.3s ease;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  .luna-mascot-container.floating {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 100;
  }
  .luna-mascot-container.embedded {
    position: relative;
    z-index: 1;
    filter: drop-shadow(0 4px 12px rgba(78, 205, 196, 0.2));
  }
  .luna-mascot-container.embedded:hover {
    filter: drop-shadow(0 6px 20px rgba(78, 205, 196, 0.35));
  }
  .luna-mascot-container.embedded .character-svg {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }

  .luna-mascot-container:hover {
    filter: drop-shadow(0 12px 36px rgba(78, 205, 196, 0.45));
  }

  /* Direction flip */
  .character-svg.facing-left {
    transform: scaleX(-1);
  }

  /* ===== GLOW BY STATE ===== */
  .luna-mascot-container::before {
    content: '';
    position: absolute;
    inset: -15px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--glow-color, rgba(78, 205, 196, 0.15)) 0%, transparent 70%);
    opacity: 0;
    transition: opacity 0.6s ease;
    pointer-events: none;
    z-index: -1;
  }
  .luna-mascot-container[data-state="idle"]::before { --glow-color: rgba(78, 205, 196, 0.2); opacity: 1; animation: glow-pulse 3s ease-in-out infinite; }
  .luna-mascot-container[data-state="thinking"]::before { --glow-color: rgba(255, 217, 61, 0.25); opacity: 1; animation: glow-pulse 1.5s ease-in-out infinite; }
  .luna-mascot-container[data-state="working"]::before { --glow-color: rgba(155, 89, 182, 0.2); opacity: 1; animation: glow-pulse 0.8s ease-in-out infinite; }
  .luna-mascot-container[data-state="sleep"]::before { --glow-color: rgba(100, 149, 237, 0.12); opacity: 0.5; }
  .luna-mascot-container[data-state="error"]::before { --glow-color: rgba(231, 76, 60, 0.2); opacity: 1; animation: glow-pulse 0.5s ease-in-out infinite; }

  @keyframes glow-pulse {
    0%, 100% { transform: scale(1); opacity: 0.5; }
    50% { transform: scale(1.15); opacity: 1; }
  }

  /* ===== IDLE ANIMATIONS ===== */
  .character-body {
    animation: breathe 3s ease-in-out infinite;
    transform-origin: center bottom;
  }

  @keyframes breathe {
    0%, 100% { transform: scaleY(1) translateY(0); }
    50% { transform: scaleY(1.015) translateY(-2px); }
  }

  /* Hair sway */
  .hair-back { animation: hair-sway 4s ease-in-out infinite; transform-origin: 100px 60px; }
  @keyframes hair-sway {
    0%, 100% { transform: rotate(0deg); }
    50% { transform: rotate(1.5deg); }
  }

  /* Floating */
  .luna-mascot-container[data-state="idle"] {
    animation: float-idle 5s ease-in-out infinite;
  }
  @keyframes float-idle {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-5px); }
  }

  /* ===== WALK ANIMATIONS ===== */
  .luna-mascot-container.walking {
    animation: none !important;
  }
  .luna-mascot-container.walking .leg-left {
    animation: walk-leg 0.5s ease-in-out infinite alternate;
    transform-origin: 79px 200px;
  }
  .luna-mascot-container.walking .leg-right {
    animation: walk-leg 0.5s ease-in-out infinite alternate-reverse;
    transform-origin: 121px 200px;
  }
  .luna-mascot-container.walking .arm-left {
    animation: walk-arm 0.5s ease-in-out infinite alternate-reverse;
    transform-origin: 61px 148px;
  }
  .luna-mascot-container.walking .arm-right {
    animation: walk-arm 0.5s ease-in-out infinite alternate;
    transform-origin: 139px 148px;
  }
  .luna-mascot-container.walking .hair-back {
    animation: hair-walk 0.5s ease-in-out infinite alternate;
    transform-origin: 100px 60px;
  }
  .luna-mascot-container.walking .head-group {
    animation: head-bob 0.5s ease-in-out infinite alternate;
    transform-origin: 100px 130px;
  }
  .luna-mascot-container.walking .shadow {
    animation: shadow-walk 0.5s ease-in-out infinite alternate;
    transform-origin: 100px 265px;
  }

  @keyframes walk-leg {
    0% { transform: rotate(-15deg) translateY(0); }
    100% { transform: rotate(15deg) translateY(-3px); }
  }
  @keyframes walk-arm {
    0% { transform: rotate(20deg); }
    100% { transform: rotate(-20deg); }
  }
  @keyframes hair-walk {
    0% { transform: rotate(-2deg); }
    100% { transform: rotate(2deg); }
  }
  @keyframes head-bob {
    0% { transform: translateY(0); }
    100% { transform: translateY(-2px); }
  }
  @keyframes shadow-walk {
    0% { transform: scaleX(1); opacity: 1; }
    100% { transform: scaleX(0.85); opacity: 0.7; }
  }

  /* ===== THINKING STATE ===== */
  .luna-mascot-container[data-state="thinking"] .head-group {
    animation: think-tilt 2s ease-in-out infinite;
    transform-origin: 100px 130px;
  }
  .luna-mascot-container[data-state="thinking"] .arm-left {
    animation: think-arm 2s ease-in-out infinite;
    transform-origin: 61px 148px;
  }
  @keyframes think-tilt {
    0%, 100% { transform: rotate(0deg); }
    50% { transform: rotate(5deg); }
  }
  @keyframes think-arm {
    0%, 100% { transform: rotate(15deg); }
    50% { transform: rotate(35deg); }
  }

  /* ===== WORKING STATE ===== */
  .luna-mascot-container[data-state="working"] .arm-left {
    animation: type-left 0.3s ease-in-out infinite alternate;
    transform-origin: 61px 148px;
  }
  .luna-mascot-container[data-state="working"] .arm-right {
    animation: type-right 0.3s ease-in-out infinite alternate-reverse;
    transform-origin: 139px 148px;
  }
  .luna-mascot-container[data-state="working"] .head-group {
    animation: focus-bob 0.6s ease-in-out infinite alternate;
  }
  @keyframes type-left {
    0% { transform: rotate(10deg) translateY(0); }
    100% { transform: rotate(25deg) translateY(-3px); }
  }
  @keyframes type-right {
    0% { transform: rotate(-10deg) translateY(0); }
    100% { transform: rotate(-25deg) translateY(-3px); }
  }
  @keyframes focus-bob {
    0% { transform: translateY(0); }
    100% { transform: translateY(1px); }
  }

  /* ===== SLEEP STATE ===== */
  .luna-mascot-container[data-state="sleep"] {
    animation: float-sleep 6s ease-in-out infinite;
  }
  .luna-mascot-container[data-state="sleep"] .head-group {
    animation: sleep-drool 4s ease-in-out infinite;
    transform-origin: 100px 130px;
  }
  .luna-mascot-container[data-state="sleep"] .eye-lid { opacity: 1; }
  .luna-mascot-container[data-state="sleep"] .mouth { d: path("M 95 108 Q 100 104 105 108 Q 100 112 95 108"); }
  @keyframes float-sleep {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50% { transform: translateY(-4px) rotate(1deg); }
  }
  @keyframes sleep-drool {
    0%, 100% { transform: rotate(0deg); }
    50% { transform: rotate(3deg); }
  }

  /* ===== ERROR STATE ===== */
  .luna-mascot-container[data-state="error"] .head-group {
    animation: shake-head 0.4s ease-in-out infinite;
    transform-origin: 100px 130px;
  }
  .luna-mascot-container[data-state="error"] .mouth { d: path("M 92 108 Q 100 100 108 108"); }
  @keyframes shake-head {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-2px); }
    75% { transform: translateX(2px); }
  }

  /* ===== BLINK ===== */
  @keyframes blink-anim {
    0%, 100% { opacity: 0; }
    50% { opacity: 1; }
  }

  /* ===== JUMP ===== */
  @keyframes jump-anim {
    0%, 100% { transform: translateY(0) scaleY(1); }
    40% { transform: translateY(-15px) scaleY(1.05); }
    60% { transform: translateY(-15px) scaleY(1.05); }
  }

  /* ===== CLICKED RIPPLE ===== */
  .luna-mascot-container.clicked {
    animation: click-pulse 0.4s ease-out;
  }
  @keyframes click-pulse {
    0% { transform: scale(1); }
    50% { transform: scale(0.92); }
    100% { transform: scale(1); }
  }

  /* ===== ACCESSORY VISIBILITY ===== */
  .zzz-group { opacity: 0; transition: opacity 0.4s ease; }
  .lightbulb { opacity: 0; transition: opacity 0.4s ease; }
  .headphones { opacity: 0; transition: opacity 0.4s ease; }
  .tear { opacity: 0; transition: opacity 0.4s ease; }

  .luna-mascot-container[data-state="sleep"] .zzz-group { opacity: 1; }
  .luna-mascot-container[data-state="thinking"] .lightbulb { opacity: 1; }
  .luna-mascot-container[data-state="working"] .headphones { opacity: 1; }
  .luna-mascot-container[data-state="error"] .tear { opacity: 1; }

  /* ===== SPEECH BUBBLE ===== */
  .speech-bubble {
    position: absolute;
    bottom: calc(100% + 10px);
    right: 0;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid rgba(78, 205, 196, 0.25);
    border-radius: 16px 16px 4px 16px;
    padding: 10px 14px;
    max-width: 200px;
    color: #fff;
    font-size: 12px;
    font-family: 'Inter', system-ui, sans-serif;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 16px rgba(78,205,196,0.08);
    opacity: 0;
    transform: translateY(8px) scale(0.95);
    transition: all 0.35s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    pointer-events: none;
    z-index: 10;
    line-height: 1.4;
  }
  .speech-bubble.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  .speech-bubble::after {
    content: '';
    position: absolute;
    bottom: -7px;
    right: 18px;
    width: 0;
    height: 0;
    border-left: 7px solid transparent;
    border-right: 7px solid transparent;
    border-top: 7px solid #16213e;
  }

  /* ===== PARTICLES ===== */
  .particle-canvas {
    position: absolute;
    inset: -40px;
    pointer-events: none;
    z-index: -1;
  }

  /* ===== SVG ===== */
  .character-svg {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
    transition: transform 0.3s ease;
  }

  /* Eyebrow expressions */
  .luna-mascot-container[data-state="thinking"] .eyebrow-left { d: path("M 65 60 Q 78 56 88 62"); }
  .luna-mascot-container[data-state="thinking"] .eyebrow-right { d: path("M 112 58 Q 122 54 135 60"); }
  .luna-mascot-container[data-state="error"] .eyebrow-left { d: path("M 65 68 Q 78 72 88 70"); }
  .luna-mascot-container[data-state="error"] .eyebrow-right { d: path("M 112 70 Q 122 72 135 68"); }

  /* Mobile */
  @media (max-width: 768px) {
    .luna-mascot-container {
      transform: scale(0.8);
      transform-origin: bottom right;
    }
  }
</style>
