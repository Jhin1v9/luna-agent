<script>
  import { onMount, onDestroy } from 'svelte';
  import { currentMode, isStreaming, actionEvent, voiceState, voiceAudioData } from '../stores.js';
  import {
    BRIGHT_STARS,
    CONSTELLATION_LINES,
    getValidLines,
    buildStarIndex,
  } from '../lib/starData.js';
  import {
    createStarState,
    createBgStarState,
    projectStar,
    projectBgStar,
    assignOrbits,
    orbitPosition,
    clearOrbits,
    ShootingStar,
    drawAtmosphericBg,
    buildDynamicLines,
    lerpColor,
    lerp,
    rgbToString,
    voiceWavePosition,
    voicePulseRadius,
    MODE_COLORS,
    MODE_SHIFT_INTENSITY,
    MODE_BEHAVIOR,
    resetWallpaperRng,
  } from '../lib/starAnimations.js';
  import {
    shouldAnimateBackground,
    backgroundFrameIntervalMs,
    capDevicePixelRatio,
  } from '../lib/perfBudget.js';

  let canvas;
  let ctx;
  let animId;
  let w, h;

  // ─── Star collections ──────────────────────────────────────
  let stars = [];           // bright named stars (~130)
  let bgStarsFar = [];      // background layer: far  (300)
  let bgStarsMid = [];      // background layer: mid  (120)
  let bgStarsNear = [];     // background layer: near (30)
  let allBgStars = [];      // combined bg stars
  let allStars = [];        // combined for dynamic lines

  let lines = [];           // constellation line indices
  let dynLines = [];        // dynamic proximity lines
  let starIndex = {};

  // ─── Animation state ───────────────────────────────────────
  let time = 0;
  let lastTime = 0;
  let dt = 16;

  // ─── Wave 10 T3: perf budget (mobile + reduced motion) ─────
  let reducedMotion = false;
  let frameIntervalMs = 0;   // 0 = uncapped (desktop); ~66ms on mobile
  let lastRenderTime = 0;    // timestamp of last rendered frame (fps cap)
  let loopRunning = false;
  let motionQuery;           // matchMedia('(prefers-reduced-motion: reduce)')

  // ─── Mode state ────────────────────────────────────────────
  let lastMode = 'instant';
  let targetMode = 'instant';
  let modeTransition = 0;       // 0 = fully in lastMode, 1 = fully in targetMode
  let modeTransitionSpeed = 0.015;
  let streamingActive = false;
  let isLoading = false;        // true when thinking + streaming

  // ─── Shooting stars ────────────────────────────────────────
  let shootingStars = [];
  let shootingStarChance = 0.008; // per frame when idle

  // ─── Tool action effect ────────────────────────────────────
  let toolEffectActive = false;
  let toolEffectStart = 0;
  let toolEffectDuration = 2500;

  // ─── Voice state ───────────────────────────────────────────
  let voiceStatus = 'idle'; // 'idle' | 'listening' | 'processing'
  let audioBins = new Uint8Array(64);
  let prevVoiceStatus = 'idle';

  // ─── Config ────────────────────────────────────────────────
  const BG_FAR_COUNT = 300;
  const BG_MID_COUNT = 120;
  const BG_NEAR_COUNT = 30;
  const DYN_CONNECT_DIST = 90;
  const MAX_DYN_PER_STAR = 3;

  // ═══════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════

  function initStars() {
    // v2.6.2-fix: reset the deterministic RNG so every hard refresh produces
    // the exact same starfield layout, phases and dynamic lines.
    resetWallpaperRng();

    starIndex = buildStarIndex(BRIGHT_STARS);
    const validLines = getValidLines(BRIGHT_STARS, CONSTELLATION_LINES);
    lines = validLines.map(([a, b]) => [starIndex[a], starIndex[b]]);

    // Bright stars with full state
    stars = BRIGHT_STARS.map(s => createStarState(s, w, h));
    stars.forEach(s => projectStar(s, w, h));

    // Background stars — 3 parallax layers
    bgStarsFar = Array.from({ length: BG_FAR_COUNT }, () => createBgStarState('far', w, h));
    bgStarsMid = Array.from({ length: BG_MID_COUNT }, () => createBgStarState('mid', w, h));
    bgStarsNear = Array.from({ length: BG_NEAR_COUNT }, () => createBgStarState('near', w, h));

    allBgStars = [...bgStarsFar, ...bgStarsMid, ...bgStarsNear];
    allBgStars.forEach(s => projectBgStar(s, w, h));

    // Combined for dynamic lines (bright stars + bg mid + bg near)
    allStars = [...stars, ...bgStarsMid, ...bgStarsNear];

    buildDynamicLines(allStars);
  }

  function rebuildDynamicLines() {
    dynLines = buildDynamicLines(allStars, DYN_CONNECT_DIST, MAX_DYN_PER_STAR);
  }

  // ═══════════════════════════════════════════════════════════
  //  MODE TRANSITION
  // ═══════════════════════════════════════════════════════════

  function updateModeState() {
    // Voice has highest priority
    let effectiveTarget;
    if (voiceStatus === 'listening') {
      effectiveTarget = 'voice-listening';
    } else if (voiceStatus === 'processing') {
      effectiveTarget = 'voice-processing';
    } else {
      // Detect loading state
      const newIsLoading = lastMode === 'instant' && streamingActive;
      if (newIsLoading) {
        effectiveTarget = 'thinking-loading';
      } else {
        effectiveTarget = lastMode;
      }
    }

    // If target changed, start transition
    if (effectiveTarget !== targetMode) {
      targetMode = effectiveTarget;
      modeTransition = 0;

      // Setup mode-specific initial states
      if (targetMode === 'thinking-loading' || targetMode === 'voice-processing') {
        assignOrbits(stars, w / 2, h / 2, 0.32);
      }

      if (targetMode !== 'thinking-loading' && targetMode !== 'voice-processing') {
        clearOrbits(stars);
      }
    }

    // Progress transition
    if (modeTransition < 1) {
      modeTransition = Math.min(1, modeTransition + modeTransitionSpeed);
    }

    isLoading = (lastMode === 'instant' && streamingActive);
  }

  // ═══════════════════════════════════════════════════════════
  //  STAR UPDATE PER MODE
  // ═══════════════════════════════════════════════════════════

  function getTargetPosition(s, idx, mode, timeMs) {
    const centerX = w / 2;
    const centerY = h / 2;

    switch (mode) {
      case 'thinking-loading': {
        if (s.orbitActive) {
          const orb = orbitPosition(s, timeMs);
          return { x: orb.x, y: orb.y };
        }
        return { x: s.homeX, y: s.homeY };
      }

      case 'instant': {
        // Warp speed — stars drift horizontally with parallax
        const driftX = s.driftBaseVx * 3.5;
        const driftY = s.driftBaseVy * 1.5;
        let tx = s.homeX + driftX;
        let ty = s.homeY + driftY;
        // Wrap around
        if (tx > w + 50) tx -= w + 100;
        if (tx < -50) tx += w + 100;
        return { x: tx, y: ty };
      }

      case 'tool': {
        // Subtle pulse outward from center
        const dx = s.homeX - centerX;
        const dy = s.homeY - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const pulseStrength = Math.max(0, 1 - dist / 250) * 20;
        return {
          x: s.homeX + (dx / (dist + 1)) * pulseStrength,
          y: s.homeY + (dy / (dist + 1)) * pulseStrength,
        };
      }

      case 'voice-listening': {
        const wave = voiceWavePosition(s, idx, stars.length, audioBins, w, h, timeMs);
        return { x: wave.x, y: wave.y };
      }

      case 'voice-processing': {
        if (s.orbitActive) {
          const orb = orbitPosition(s, timeMs);
          return { x: orb.x, y: orb.y };
        }
        return { x: s.homeX, y: s.homeY };
      }

      default: // thinking / idle
        return { x: s.homeX, y: s.homeY };
    }
  }

  function updateStars(timeMs) {
    const behavior = MODE_BEHAVIOR[targetMode] || MODE_BEHAVIOR.thinking;

    // Update bright stars
    stars.forEach((s, idx) => {
      // Calculate target position for current mode
      const target = getTargetPosition(s, idx, targetMode, timeMs);

      // Also calculate target for last mode (for transition blending)
      const lastTarget = getTargetPosition(s, idx, lastMode, timeMs);

      // Blend between last mode and target mode
      const tx = lerp(lastTarget.x, target.x, modeTransition);
      const ty = lerp(lastTarget.y, target.y, modeTransition);

      // Lerp factor varies by distance from center (wave effect)
      const dx = s.currentX - w / 2;
      const dy = s.currentY - h / 2;
      const distFromCenter = Math.sqrt(dx * dx + dy * dy);
      const maxDist = Math.min(w, h) * 0.5;
      const lerpFactor = 0.02 + 0.04 * (1 - distFromCenter / maxDist);

      s.currentX += (tx - s.currentX) * lerpFactor;
      s.currentY += (ty - s.currentY) * lerpFactor;

      // Update orbit angle continuously even if not fully in orbit mode
      if (s.orbitActive) {
        s.orbitAngle += s.orbitSpeed * dt;
      }

      // Color interpolation
      const modeColor = MODE_COLORS[targetMode] || MODE_COLORS.thinking;
      const lastModeColor = MODE_COLORS[lastMode] || MODE_COLORS.thinking;
      const blendedModeColor = lerpColor(lastModeColor, modeColor, modeTransition);
      const shiftStrength = s.brightness * (MODE_SHIFT_INTENSITY[targetMode] || 0);
      s.currentColor = lerpColor(s.baseColor, blendedModeColor, shiftStrength);

      // Tool action pulse
      if (toolEffectActive) {
        const elapsed = timeMs - toolEffectStart;
        const progress = elapsed / toolEffectDuration;
        if (progress < 1) {
          const pulseT = Math.sin(progress * Math.PI * 4) * Math.exp(-progress * 3);
          const distFromCenter = Math.sqrt(
            (s.currentX - w / 2) ** 2 + (s.currentY - h / 2) ** 2
          );
          if (distFromCenter < 200) {
            s.pulseRadiusMult = 1 + pulseT * 0.5;
            s.pulseColorShift = [pulseT * 30, pulseT * 20, pulseT * 50];
          } else {
            s.pulseRadiusMult = 1;
            s.pulseColorShift = [0, 0, 0];
          }
        } else {
          s.pulseRadiusMult = 1;
          s.pulseColorShift = [0, 0, 0];
        }
      } else {
        s.pulseRadiusMult = 1;
        s.pulseColorShift = [0, 0, 0];
      }
    });

    // Update background stars (parallax drift)
    const layers = [
      { stars: bgStarsFar, speedMult: 0.3 },
      { stars: bgStarsMid, speedMult: 0.7 },
      { stars: bgStarsNear, speedMult: 1.5 },
    ];

    for (const layer of layers) {
      for (const s of layer.stars) {
        if (behavior.drift) {
          s.nx += s.driftVx * behavior.speed * layer.speedMult * 0.008;
          s.ny += s.driftVy * behavior.speed * layer.speedMult * 0.008;
        }
        // Always wrap
        if (s.nx < 0) s.nx += 1;
        if (s.nx > 1) s.nx -= 1;
        if (s.ny < 0) s.ny += 1;
        if (s.ny > 1) s.ny -= 1;

        s.x = s.nx * w;
        s.y = s.ny * h;
        s.currentX = s.x;
        s.currentY = s.y;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  SHOOTING STAR UPDATE
  // ═══════════════════════════════════════════════════════════

  function updateShootingStars() {
    // Spawn random shooting star
    if (shootingStars.length < 2 && Math.random() < shootingStarChance) {
      const side = Math.floor(Math.random() * 4);
      let sx, sy, angle;
      switch (side) {
        case 0: sx = Math.random() * w; sy = -20; angle = Math.PI * 0.3 + Math.random() * 0.4; break;
        case 1: sx = w + 20; sy = Math.random() * h; angle = Math.PI * 0.8 + Math.random() * 0.4; break;
        case 2: sx = Math.random() * w; sy = h + 20; angle = -Math.PI * 0.7 + Math.random() * 0.4; break;
        default: sx = -20; sy = Math.random() * h; angle = -Math.PI * 0.3 + Math.random() * 0.4; break;
      }
      shootingStars.push(new ShootingStar(sx, sy, angle));
    }

    // Update existing
    for (let i = shootingStars.length - 1; i >= 0; i--) {
      shootingStars[i].update();
      if (shootingStars[i].dead) {
        shootingStars.splice(i, 1);
      }
    }
  }

  function spawnToolShootingStar() {
    const angle = Math.random() * Math.PI * 2;
    shootingStars.push(new ShootingStar(w / 2, h / 2, angle, 5 + Math.random() * 3));
  }

  // ═══════════════════════════════════════════════════════════
  //  DRAW
  // ═══════════════════════════════════════════════════════════

  function drawSoftGlow(x, y, radius, opacity, rgb) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0) return;
    const glowR = radius * 6;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${opacity * 0.35})`);
    grad.addColorStop(0.35, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${opacity * 0.08})`);
    grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    ctx.fillStyle = grad;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw() {
    if (!ctx) return;

    const t = time * 0.001;
    const behavior = MODE_BEHAVIOR[targetMode] || MODE_BEHAVIOR.thinking;
    const twinkleMult = behavior.twinkleMult;
    const brightnessMult = behavior.brightnessMult * (streamingActive ? 1.15 : 1.0);

    // ── Background ──
    drawAtmosphericBg(ctx, w, h, targetMode, time);

    // ── Dynamic proximity lines ──
    ctx.lineCap = 'round';
    const modeColor = MODE_COLORS[targetMode] || MODE_COLORS.thinking;
    const accent = `rgb(${modeColor[0]},${modeColor[1]},${modeColor[2]})`;

    for (const dl of dynLines) {
      const a = allStars[dl.i];
      const b = allStars[dl.j];
      if (!a || !b) continue;

      const pulse = Math.sin(t * dl.speed * twinkleMult + dl.phase) * 0.5 + 0.5;
      const alpha = (1 - dl.dist / DYN_CONNECT_DIST) * 0.09 * pulse * brightnessMult;
      if (alpha < 0.003) continue;

      ctx.beginPath();
      ctx.moveTo(a.currentX || a.x, a.currentY || a.y);
      ctx.lineTo(b.currentX || b.x, b.currentY || b.y);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 0.35;
      ctx.stroke();
    }

    // ── Constellation lines (fixed, more visible in idle/thinking) ──
    const constLineOpacity = targetMode === 'thinking-loading' ? 0.14 : 0.22;
    ctx.lineWidth = 1.0;
    ctx.lineCap = 'round';
    ctx.shadowColor = accent;
    ctx.shadowBlur = 6;

    for (const [i, j] of lines) {
      const a = stars[i];
      const b = stars[j];
      if (!a || !b) continue;

      const dx = a.currentX - b.currentX;
      const dy = a.currentY - b.currentY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < Math.max(w, h) * 0.32) {
        const pulse = Math.sin(t * 0.7 + i * 0.5) * 0.15 + 0.85;
        ctx.beginPath();
        ctx.moveTo(a.currentX, a.currentY);
        ctx.lineTo(b.currentX, b.currentY);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = constLineOpacity * pulse * brightnessMult;
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;

    // ── Background stars ──
    for (const s of allBgStars) {
      const pulse = Math.sin(t * s.twinkleSpeed * twinkleMult + s.phase);
      const opacity = s.baseOpacity * (0.5 + 0.5 * pulse) * brightnessMult;
      const radius = s.baseRadius * (0.8 + 0.2 * pulse);

      ctx.globalAlpha = Math.max(0, opacity);
      ctx.fillStyle = `rgb(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(0.15, radius), 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Bright stars with soft glow ──
    stars.forEach((s, starIdx) => {
      const pulse = Math.sin(t * s.twinkleSpeed * twinkleMult + s.phase);
      const opacity = s.baseOpacity * (0.55 + 0.45 * pulse) * brightnessMult;

      let radius;
      if (targetMode === 'voice-listening') {
        const audioIndex = Math.floor((starIdx / stars.length) * audioBins.length) % audioBins.length;
        const amplitude = audioBins[audioIndex] / 255;
        radius = voicePulseRadius(s.baseRadius, amplitude, s.brightness) * (0.92 + 0.08 * pulse) * s.pulseRadiusMult;
      } else {
        radius = s.baseRadius * (0.92 + 0.08 * pulse) * s.pulseRadiusMult;
      }

      const r = Math.min(255, s.currentColor[0] + s.pulseColorShift[0]);
      const g = Math.min(255, s.currentColor[1] + s.pulseColorShift[1]);
      const b = Math.min(255, s.currentColor[2] + s.pulseColorShift[2]);

      // Soft glow
      drawSoftGlow(s.currentX, s.currentY, radius, opacity, [r, g, b]);

      // Star core
      ctx.globalAlpha = Math.max(0, opacity);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(s.currentX, s.currentY, Math.max(0.3, radius), 0, Math.PI * 2);
      ctx.fill();

      // Extra hot white core for very bright stars
      if (s.mag < 1.2) {
        ctx.globalAlpha = opacity * 0.85;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(s.currentX, s.currentY, Math.max(0.12, radius * 0.3), 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // ── Shooting stars ──
    for (const ss of shootingStars) {
      ss.draw(ctx);
    }

    // ── Luna brilhante (modo instant) ──
    if (targetMode === 'instant' || (lastMode === 'instant' && modeTransition < 1)) {
      const moonAlpha = targetMode === 'instant' ? 1 : (1 - modeTransition);
      drawLuna(ctx, w, h, t, moonAlpha);
    }

    // Reset
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.lineCap = 'butt';
  }

  function drawLuna(ctx, w, h, t, alpha) {
    const cx = w * 0.85;
    const cy = h * 0.15;
    const pulse = Math.sin(t * 1.5) * 0.15 + 0.85;

    // Glow sutil atrás do emoji
    const glowR = 60 * pulse;
    const glowGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, glowR);
    glowGrad.addColorStop(0, `rgba(6,182,212,${0.2 * alpha * pulse})`);
    glowGrad.addColorStop(1, 'rgba(6,182,212,0)');
    ctx.fillStyle = glowGrad;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Lua premium (SVG-like path) com sombra ciano — v12.5: emoji removido
    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 20 * pulse;
    ctx.fillStyle = '#f1f5f9';

    const moonR = 22 * pulse;
    // Círculo principal
    ctx.beginPath();
    ctx.arc(cx, cy, moonR, 0, Math.PI * 2);
    ctx.fill();

    // Sombra para efeito crescente (círculo sobreposto à direita)
    ctx.globalAlpha = alpha * 0.85;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#07070f';
    ctx.beginPath();
    ctx.arc(cx + moonR * 0.38, cy - moonR * 0.12, moonR * 0.92, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.shadowBlur = 0;
  }

  // ═══════════════════════════════════════════════════════════
  //  ANIMATION LOOP
  // ═══════════════════════════════════════════════════════════

  function loop(now) {
    animId = undefined;

    // Wave 10 T3: fps cap on mobile — skip the update/draw work but keep
    // the rAF cadence so we can resume at full speed without re-arming.
    if (frameIntervalMs > 0 && lastRenderTime && now - lastRenderTime < frameIntervalMs) {
      animId = requestAnimationFrame(loop);
      return;
    }
    lastRenderTime = now;

    dt = Math.min(now - lastTime, 50); // cap at 50ms
    lastTime = now;
    time = now;

    updateModeState();
    updateStars(now);

    updateShootingStars();

    draw();

    animId = requestAnimationFrame(loop);
  }

  // Wave 10 T3: reduced-motion users get one static frame instead of a loop.
  function renderStaticFrame() {
    const now = performance.now();
    time = now;
    updateModeState();
    updateStars(now);
    draw();
  }

  function startLoop() {
    if (loopRunning) return;
    if (!shouldAnimateBackground({ reducedMotion, hidden: document.hidden })) return;
    loopRunning = true;
    lastTime = performance.now();
    lastRenderTime = 0;
    animId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    loopRunning = false;
    if (animId) {
      cancelAnimationFrame(animId);
      animId = undefined;
    }
  }

  // Wave 10 T3: pause the canvas while the tab is hidden — iOS keeps rAF
  // callbacks queued and the compositor pays for them on return.
  function handleVisibilityChange() {
    if (document.hidden) {
      stopLoop();
    } else if (reducedMotion) {
      renderStaticFrame();
    } else {
      startLoop();
    }
  }

  function handleMotionChange(e) {
    reducedMotion = e.matches;
    if (reducedMotion) {
      stopLoop();
      renderStaticFrame();
    } else if (!document.hidden) {
      startLoop();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  RESIZE
  // ═══════════════════════════════════════════════════════════

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    if (canvas) {
      // Wave 10 T3: DPR 3 on iPhone 15 → 9x fragments on a full-screen
      // canvas. Cap at 1.5 on mobile; desktop keeps the raw ratio.
      const dpr = capDevicePixelRatio(window.devicePixelRatio || 1, {
        innerWidth: w,
        pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
      });
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Wave 10 T3: re-evaluate the fps cap when crossing the mobile breakpoint
    frameIntervalMs = backgroundFrameIntervalMs({
      innerWidth: w,
      pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
    });

    // Re-project all stars
    stars.forEach(s => projectStar(s, w, h));
    allBgStars.forEach(s => projectBgStar(s, w, h));

    // Re-assign orbits if in loading mode
    if (targetMode === 'thinking-loading') {
      assignOrbits(stars, w / 2, h / 2, 0.32);
    }

    rebuildDynamicLines();
  }

  // ═══════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ═══════════════════════════════════════════════════════════

  let modeUnsub;
  let streamUnsub;
  let actionUnsub;
  let voiceStateUnsub;
  let voiceAudioUnsub;

  onMount(() => {
    ctx = canvas.getContext('2d', { willReadFrequently: false });

    // Wave 10 T3: honor prefers-reduced-motion before the first paint
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = motionQuery.matches;

    resize();
    initStars();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    motionQuery.addEventListener('change', handleMotionChange);

    modeUnsub = currentMode.subscribe((m) => {
      if (m !== lastMode) {
        targetMode = m;
        modeTransition = 0;
        lastMode = m;

        // Setup for new mode
        if (m === 'thinking-loading' || (m === 'thinking' && streamingActive)) {
          assignOrbits(stars, w / 2, h / 2, 0.32);
        } else {
          clearOrbits(stars);
        }
      }
    });

    streamUnsub = isStreaming.subscribe((s) => {
      streamingActive = s;
      // Will be handled in updateModeState
    });

    actionUnsub = actionEvent.subscribe((event) => {
      if (event) {
        toolEffectActive = true;
        toolEffectStart = performance.now();
        spawnToolShootingStar();
        setTimeout(() => {
          toolEffectActive = false;
        }, toolEffectDuration);
        // Reset store so subsequent events can fire
        actionEvent.set(null);
      }
    });

    voiceStateUnsub = voiceState.subscribe((state) => {
      if (state.status !== prevVoiceStatus) {
        prevVoiceStatus = state.status;
        voiceStatus = state.status;
        modeTransition = 0;

        if (voiceStatus === 'voice-processing') {
          assignOrbits(stars, w / 2, h / 2, 0.32);
        } else if (voiceStatus === 'idle') {
          clearOrbits(stars);
        }
      }
    });

    voiceAudioUnsub = voiceAudioData.subscribe((bins) => {
      if (bins && bins.length === audioBins.length) {
        audioBins.set(bins);
      }
    });

    if (reducedMotion) {
      renderStaticFrame();
    } else {
      startLoop();
    }
  });

  onDestroy(() => {
    stopLoop();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (motionQuery) motionQuery.removeEventListener('change', handleMotionChange);
    if (modeUnsub) modeUnsub();
    if (streamUnsub) streamUnsub();
    if (actionUnsub) actionUnsub();
    if (voiceStateUnsub) voiceStateUnsub();
    if (voiceAudioUnsub) voiceAudioUnsub();
  });
</script>

<canvas bind:this={canvas} class="particle-bg" aria-hidden="true"></canvas>

<style>
  .particle-bg {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    z-index: 0;
    pointer-events: none;
    background: #0a0a1a;
  }
</style>
