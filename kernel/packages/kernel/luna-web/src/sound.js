// Lightweight Web Audio API sound effects for Luna Web
// Respects prefers-reduced-motion (treated as reduced sound)

let audioCtx = null;
let enabled = true;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function reducedSound() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function setSoundEnabled(v) {
  enabled = v;
}

export function isSoundEnabled() {
  return enabled && !reducedSound();
}

function playTone(freq, duration, type = 'sine', volume = 0.08) {
  if (!enabled || reducedSound()) return;
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    // silently fail if audio is blocked
  }
}

export function playSound(type) {
  switch (type) {
    case 'messageSent':
      playTone(880, 0.06, 'sine', 0.06);
      break;
    case 'messageReceived':
      playTone(660, 0.1, 'sine', 0.05);
      setTimeout(() => playTone(880, 0.08, 'sine', 0.04), 60);
      break;
    case 'thinkingStart':
      playTone(200, 0.15, 'triangle', 0.04);
      break;
    case 'toolComplete':
      playTone(1000, 0.12, 'sine', 0.06);
      setTimeout(() => playTone(1200, 0.1, 'sine', 0.05), 80);
      break;
    case 'error':
      playTone(150, 0.2, 'sawtooth', 0.04);
      break;
    case 'modeChange':
      playTone(520, 0.08, 'sine', 0.05);
      break;
  }
}
