// Wave 10 T3: mobile perf budget for the particle background.
// Pure policy helpers so the rules are unit-testable under node --test;
// ParticleBackground.svelte feeds them live env readings (matchMedia /
// innerWidth / document.hidden) and they decide how hard the canvas may run.
export const MOBILE_BREAKPOINT_PX = 768;
export const MOBILE_FPS = 15;
export const MOBILE_MAX_DPR = 1.5;

// Coarse pointers (touch) or narrow viewports get the throttled path.
export function isMobileEnv({ innerWidth = Infinity, pointerCoarse = false } = {}) {
  return pointerCoarse === true || innerWidth <= MOBILE_BREAKPOINT_PX;
}

// The rAF loop runs only when the tab is visible and the user has not
// asked for reduced motion (reduced motion → one static frame, no loop).
export function shouldAnimateBackground({ reducedMotion = false, hidden = false } = {}) {
  return !reducedMotion && !hidden;
}

// ms between rendered frames. 0 = uncapped (one render per rAF, desktop).
export function backgroundFrameIntervalMs(env = {}) {
  return isMobileEnv(env) ? Math.round(1000 / MOBILE_FPS) : 0;
}

// iPhone 15 reports DPR 3 — rendering the full-screen starfield at 3x is
// wasted GPU. Cap at 1.5 on mobile; desktop keeps the raw ratio.
export function capDevicePixelRatio(dpr, env = {}) {
  const raw = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return isMobileEnv(env) ? Math.min(raw, MOBILE_MAX_DPR) : raw;
}
