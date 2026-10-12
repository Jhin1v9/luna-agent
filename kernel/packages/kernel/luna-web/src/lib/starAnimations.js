/**
 * Utilitários de animação para o sistema de estrelas.
 * Easing, interpolação de cor, estado de estrelas, órbitas e shooting stars.
 */

// ═══════════════════════════════════════════════════════════
//  Seeded Random (deterministic wallpaper)
// ═══════════════════════════════════════════════════════════

// v2.6.2-fix: the starfield must look identical after every hard refresh.
// Math.random() would reshuffle stars/lines on each mount. We use a fixed-seed
// PRNG so initStars() always produces the same layout, phases and dynamic lines.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WALLPAPER_SEED = 0x4C554E41; // "LUNA" as hex seed
let _wallpaperRngInstance = mulberry32(WALLPAPER_SEED);

export function wallpaperRng() {
  return _wallpaperRngInstance();
}

export function resetWallpaperRng() {
  _wallpaperRngInstance = mulberry32(WALLPAPER_SEED);
}

// ═══════════════════════════════════════════════════════════
//  Color Utilities
// ═══════════════════════════════════════════════════════════

export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [255, 255, 255];
}

export function rgbToString(rgb, alpha = 1) {
  if (alpha >= 1) return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

export function lerpColor(c1, c2, t) {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * clamped),
    Math.round(c1[1] + (c2[1] - c1[1]) * clamped),
    Math.round(c1[2] + (c2[2] - c1[2]) * clamped),
  ];
}

export function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// ═══════════════════════════════════════════════════════════
//  Easing Functions
// ═══════════════════════════════════════════════════════════

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function easeOutElastic(t) {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

// ═══════════════════════════════════════════════════════════
//  Mode Configuration
// ═══════════════════════════════════════════════════════════

export const MODE_COLORS = {
  instant:          [6, 182, 212],   // #06b6d4 cyan
  thinking:         [168, 85, 247],  // #a855f7 purple
  tool:             [59, 130, 246],  // #3b82f6 blue
  'voice-listening': [239, 68, 68],   // #ef4444 red
  'voice-processing': [245, 158, 11], // #f59e0b amber
};

export const MODE_BG_TINTS = {
  instant:           [10, 26, 46],    // dark cyan
  thinking:          [26, 10, 46],    // dark purple
  tool:              [10, 18, 46],    // dark blue
  'voice-listening':  [46, 10, 10],    // dark red
  'voice-processing': [46, 26, 10],    // dark amber
};

export const MODE_SHIFT_INTENSITY = {
  instant:           0.70,
  thinking:          0.30,
  tool:              0.85,
  'voice-listening':  0.60,
  'voice-processing': 0.45,
};

export const MODE_BEHAVIOR = {
  instant:            { twinkleMult: 2.8, brightnessMult: 1.55, drift: true,  speed: 3.0, starBurst: true },
  thinking:           { twinkleMult: 1.0, brightnessMult: 1.00, drift: false, speed: 0 },
  tool:               { twinkleMult: 1.3, brightnessMult: 1.15, drift: false, speed: 0 },
  'voice-listening':  { twinkleMult: 2.2, brightnessMult: 1.35, drift: false, speed: 0 },
  'voice-processing': { twinkleMult: 1.4, brightnessMult: 1.10, drift: false, speed: 0 },
};

// ═══════════════════════════════════════════════════════════
//  Star State Factory
// ═══════════════════════════════════════════════════════════

/**
 * Cria o estado completo de uma estrela a partir dos dados brutos do catálogo.
 */
export function createStarState(starData, canvasW, canvasH) {
  const rgb = hexToRgb(starData.color);
  const mag = starData.mag;
  const brightness = Math.max(0, Math.min(1, (6.5 - mag) / 7));

  return {
    // Dados originais
    id: starData.id,
    name: starData.name,
    ra: starData.ra,
    dec: starData.dec,
    mag,
    brightness,

    // Posição celeste (projeção RA/Dec)
    homeX: 0,
    homeY: 0,

    // Posição interpolada no canvas
    currentX: 0,
    currentY: 0,

    // Órbita (modo thinking-loading)
    orbitAngle: 0,
    orbitRadius: 0,
    orbitSpeed: 0,
    orbitCenterX: 0,
    orbitCenterY: 0,
    orbitActive: false,

    // Deriva (modo instant)
    driftVx: 0,
    driftVy: 0,
    driftBaseVx: 0,
    driftBaseVy: 0,

    // Aparência
    baseColor: [...rgb],
    currentColor: [...rgb],
    targetColor: [...rgb],
    phase: wallpaperRng() * Math.PI * 2,
    twinkleSpeed: wallpaperRng() * 0.4 + 0.4,
    twinkleDepth: wallpaperRng() * 0.3 + 0.5,
    baseRadius: Math.max(0.5, (6.2 - mag) * 0.62),
    baseOpacity: Math.max(0.25, Math.min(0.9, (6.5 - mag) * 0.16)),

    // Pulse effect (tool-action)
    pulseStart: -99999,
    pulseDuration: 600, // ms
    pulseRadiusMult: 1,
    pulseColorShift: [0, 0, 0],
  };
}

/**
 * Cria uma estrela de fundo aleatória.
 */
export function createBgStarState(layer, canvasW, canvasH) {
  const mag = wallpaperRng() * 2.8 + 3.8;
  const layerFactors = {
    far:  { opacity: [0.3, 0.5], size: [0.5, 1.0], drift: 0.02 },
    mid:  { opacity: [0.5, 0.7], size: [1.0, 1.5], drift: 0.08 },
    near: { opacity: [0.7, 1.0], size: [1.5, 2.5], drift: 0.20 },
  };
  const f = layerFactors[layer] || layerFactors.mid;

  return {
    nx: wallpaperRng(),
    ny: wallpaperRng(),
    x: 0,
    y: 0,
    layer,
    phase: wallpaperRng() * Math.PI * 2,
    twinkleSpeed: wallpaperRng() * 0.25 + 0.15,
    baseRadius: Math.max(0.25, (6.8 - mag) * 0.32) * (f.size[0] + wallpaperRng() * (f.size[1] - f.size[0])),
    baseOpacity: f.opacity[0] + wallpaperRng() * (f.opacity[1] - f.opacity[0]),
    rgb: [210 + wallpaperRng() * 40, 220 + wallpaperRng() * 30, 255],
    driftVx: (wallpaperRng() - 0.5) * f.drift,
    driftVy: (wallpaperRng() - 0.5) * f.drift * 0.3,
    currentX: 0,
    currentY: 0,
  };
}

// ═══════════════════════════════════════════════════════════
//  Projection
// ═══════════════════════════════════════════════════════════

export function projectStar(s, w, h) {
  s.homeX = (s.ra / 24) * w;
  s.homeY = ((90 - s.dec) / 180) * h;
  // Ensure current position starts exactly at home so dynamic lines are
  // deterministic on the very first frame (before the animation loop runs).
  s.currentX = s.homeX;
  s.currentY = s.homeY;
}

export function projectBgStar(s, w, h) {
  s.x = s.nx * w;
  s.y = s.ny * h;
  // Same determinism fix for background stars used in dynamic lines.
  s.currentX = s.x;
  s.currentY = s.y;
}

// ═══════════════════════════════════════════════════════════
//  Orbit System (thinking-loading mode)
// ═══════════════════════════════════════════════════════════

/**
 * Atribui parâmetros de órbita a todas as estrelas.
 */
export function assignOrbits(stars, centerX, centerY, maxRadiusFactor = 0.35) {
  const maxRadius = Math.min(centerX * 2, centerY * 2) * maxRadiusFactor;

  stars.forEach((s, idx) => {
    const dx = s.homeX - centerX;
    const dy = s.homeY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Raio proporcional à distância original, com variação
    s.orbitRadius = Math.min(dist, maxRadius) * (0.6 + wallpaperRng() * 0.4);
    s.orbitRadius = Math.max(s.orbitRadius, 25); // mínimo 25px

    // Ângulo inicial baseado na posição original
    s.orbitAngle = Math.atan2(dy, dx);

    // Velocidade angular: Kepler-like simplificado
    // v ~ 1/r para órbitas mais realistas
    s.orbitSpeed = (180 / s.orbitRadius) * 0.0008;

    // Sentido alternado por anel (quanto maior o raio, mais alternância)
    const ringIndex = Math.floor(s.orbitRadius / 70);
    if (ringIndex % 2 === 1) {
      s.orbitSpeed *= -1;
    }

    s.orbitCenterX = centerX;
    s.orbitCenterY = centerY;
    s.orbitActive = true;
  });
}

/**
 * Calcula a posição orbital de uma estrela em um dado tempo.
 */
export function orbitPosition(s, timeMs) {
  const t = timeMs * 0.001;
  const angle = s.orbitAngle + s.orbitSpeed * t;
  return {
    x: s.orbitCenterX + Math.cos(angle) * s.orbitRadius,
    y: s.orbitCenterY + Math.sin(angle) * s.orbitRadius,
  };
}

/**
 * Desativa órbitas, preparando para transição de volta à posição home.
 */
export function clearOrbits(stars) {
  stars.forEach(s => {
    s.orbitActive = false;
  });
}

// ═══════════════════════════════════════════════════════════
//  Shooting Star System
// ═══════════════════════════════════════════════════════════

export class ShootingStar {
  constructor(startX, startY, angle = null, speed = null) {
    const dir = angle ?? (Math.random() * Math.PI * 2);
    const spd = speed ?? (3 + Math.random() * 4);

    this.x = startX;
    this.y = startY;
    this.vx = Math.cos(dir) * spd;
    this.vy = Math.sin(dir) * spd;
    this.headBrightness = 1.0;
    this.life = 1.0;
    this.decay = 0.003 + Math.random() * 0.004;
    this.trail = [];
    this.maxTrail = 18;
    this.color = [220, 235, 255]; // white-blue
    this.tailColor = [180, 200, 255];
    this.dead = false;
  }

  update() {
    // Guarda posição no trail
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > this.maxTrail) {
      this.trail.shift();
    }

    this.x += this.vx;
    this.y += this.vy;
    this.life -= this.decay;
    this.headBrightness = Math.max(0, this.life);

    if (this.life <= 0 || this.x < -100 || this.x > 3000 || this.y < -100 || this.y > 3000) {
      this.dead = true;
    }
  }

  draw(ctx) {
    if (this.trail.length < 2) return;

    // Cauda com gradiente de opacidade
    for (let i = 1; i < this.trail.length; i++) {
      const t = i / this.trail.length;
      const alpha = t * this.headBrightness * 0.5;
      if (alpha < 0.01) continue;

      ctx.beginPath();
      ctx.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
      ctx.lineTo(this.trail[i].x, this.trail[i].y);
      ctx.strokeStyle = `rgba(${this.tailColor[0]},${this.tailColor[1]},${this.tailColor[2]},${alpha})`;
      ctx.lineWidth = t * 2.2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Núcleo com glow
    ctx.save();
    ctx.shadowBlur = 12;
    ctx.shadowColor = `rgba(${this.color[0]},${this.color[1]},${this.color[2]},0.7)`;
    ctx.fillStyle = `rgba(255,255,255,${this.headBrightness})`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ═══════════════════════════════════════════════════════════
//  Background Drawing
// ═══════════════════════════════════════════════════════════

export function drawAtmosphericBg(ctx, w, h, mode, timeMs) {
  const t = timeMs * 0.0001;
  const tint = MODE_BG_TINTS[mode] || MODE_BG_TINTS.thinking;

  // Gradiente base escuro
  const baseGrad = ctx.createLinearGradient(0, 0, 0, h);
  baseGrad.addColorStop(0, '#080816');
  baseGrad.addColorStop(1, '#020208');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, w, h);

  // Nebulosa radial sutil que se move lentamente
  const nebulaX = w * 0.3 + Math.sin(t) * w * 0.08;
  const nebulaY = h * 0.35 + Math.cos(t * 0.7) * h * 0.06;

  const nebGrad = ctx.createRadialGradient(nebulaX, nebulaY, 0, nebulaX, nebulaY, w * 0.7);
  nebGrad.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},0.04)`);
  nebGrad.addColorStop(0.5, `rgba(${tint[0]},${tint[1]},${tint[2]},0.015)`);
  nebGrad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.fillStyle = nebGrad;
  ctx.fillRect(0, 0, w, h);

  // Segunda nebulosa em posição oposta
  const nebula2X = w * 0.7 + Math.sin(t * 0.6 + 2) * w * 0.06;
  const nebula2Y = h * 0.6 + Math.cos(t * 0.5 + 1) * h * 0.05;

  const neb2Grad = ctx.createRadialGradient(nebula2X, nebula2Y, 0, nebula2X, nebula2Y, w * 0.5);
  neb2Grad.addColorStop(0, `rgba(${tint[0] * 0.7},${tint[1] * 0.7},${tint[2] * 0.7},0.025)`);
  neb2Grad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.fillStyle = neb2Grad;
  ctx.fillRect(0, 0, w, h);
}

// ═══════════════════════════════════════════════════════════
//  Constellation Lines Helpers
// ═══════════════════════════════════════════════════════════

export function buildDynamicLines(allStars, maxDist = 100, maxPerStar = 3) {
  const lines = [];
  const maxSq = maxDist * maxDist;

  for (let i = 0; i < allStars.length; i++) {
    let count = 0;
    for (let j = i + 1; j < allStars.length; j++) {
      const dx = allStars[i].currentX - allStars[j].currentX;
      const dy = allStars[i].currentY - allStars[j].currentY;
      const distSq = dx * dx + dy * dy;
      if (distSq < maxSq && count < maxPerStar) {
        lines.push({
          i,
          j,
          dist: Math.sqrt(distSq),
          phase: wallpaperRng() * Math.PI * 2,
          speed: wallpaperRng() * 0.3 + 0.2,
        });
        count++;
      }
    }
  }
  return lines;
}

// ═══════════════════════════════════════════════════════════
//  Voice Wave Position
// ═══════════════════════════════════════════════════════════

/**
 * Calcula a posição de uma estrela em modo voice-listening.
 * As estrelas formam uma onda sonora horizontal no centro da tela,
 * reativa aos dados de frequência do microfone.
 */
export function voiceWavePosition(s, idx, totalStars, audioBins, w, h, timeMs) {
  const t = timeMs * 0.001;
  const centerY = h * 0.5;
  const waveWidth = w * 0.85;
  const waveHeight = h * 0.35;

  // Mapeia a estrela para um índice no array de áudio
  const audioIndex = Math.floor((idx / totalStars) * audioBins.length) % audioBins.length;
  const amplitude = audioBins[audioIndex] / 255; // 0.0 a 1.0

  // Posição X espelhada em torno do centro (estrelas agrupadas no meio)
  const normalizedX = (idx / totalStars) * 2 - 1; // -1 a 1
  const x = w * 0.5 + normalizedX * waveWidth * 0.5;

  // Posição Y = onda base + amplitude do áudio + perturbação orgânica
  const baseWave = Math.sin(normalizedX * Math.PI * 3 + t * 2) * 20;
  const audioWave = amplitude * waveHeight * 0.5;
  const organic = Math.sin(t * 3 + idx * 0.5) * 8;

  // Estrelas mais brilhantes respondem mais ao áudio
  const brightnessFactor = 0.5 + s.brightness * 0.5;
  const y = centerY + baseWave + audioWave * brightnessFactor + organic;

  return { x, y, amplitude };
}

/**
 * Smoothly maps audio amplitude to a star radius multiplier.
 */
export function voicePulseRadius(baseRadius, amplitude, brightness) {
  const pulse = 1 + amplitude * 0.8 * (0.5 + brightness * 0.5);
  return baseRadius * pulse;
}
