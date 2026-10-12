// wave10-mobile-perf.test.cjs — Wave 10 T3 regression tests (mobile perf)
// A: ParticleBackground pauses on visibilitychange, honors reduced-motion,
//    caps fps + DPR on mobile (lib/perfBudget.js)
// B: per-message backdrop-filter gated behind @media (max-width: 768px)
//    in the 5 glass components
// C: content-visibility: auto on the message wrapper (cheap virtualization)
// D: infinite animations only on the last assistant message
//    (AssistantMessage isLast + LunaAvatar animate prop)
// E: instant scroll during streaming (no smooth-scroll per token delta)
// Run: node --test packages/kernel/tests/wave10-mobile-perf.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..', '..');
const WEB = path.join(REPO, 'packages/kernel/luna-web/src');
const PARTICLE_BG = path.join(WEB, 'components/ParticleBackground.svelte');
const MESSAGES_LIST = path.join(WEB, 'components/MessagesList.svelte');
const ASSISTANT_MSG = path.join(WEB, 'components/AssistantMessage.svelte');
const LUNA_AVATAR = path.join(WEB, 'components/LunaAvatar.svelte');

const read = (p) => fs.readFileSync(p, 'utf8');

// ── A: perf-budget policy helpers (pure logic, unit-tested) ──────────────────

const {
  isMobileEnv,
  shouldAnimateBackground,
  backgroundFrameIntervalMs,
  capDevicePixelRatio,
  MOBILE_BREAKPOINT_PX,
  MOBILE_FPS,
} = require('../luna-web/src/lib/perfBudget.js');

test('A: shouldAnimateBackground is false when hidden or reduced-motion', () => {
  assert.strictEqual(shouldAnimateBackground({ reducedMotion: false, hidden: false }), true);
  assert.strictEqual(shouldAnimateBackground({ reducedMotion: true, hidden: false }), false);
  assert.strictEqual(shouldAnimateBackground({ reducedMotion: false, hidden: true }), false);
  assert.strictEqual(shouldAnimateBackground({ reducedMotion: true, hidden: true }), false);
  assert.strictEqual(shouldAnimateBackground(), true, 'defaults animate (desktop, visible)');
});

test('A: isMobileEnv triggers on coarse pointer or <= breakpoint width', () => {
  assert.strictEqual(isMobileEnv({ innerWidth: 390, pointerCoarse: true }), true, 'iPhone 15');
  assert.strictEqual(isMobileEnv({ innerWidth: 390, pointerCoarse: false }), true, 'narrow window');
  assert.strictEqual(isMobileEnv({ innerWidth: MOBILE_BREAKPOINT_PX, pointerCoarse: false }), true, 'edge inclusive');
  assert.strictEqual(isMobileEnv({ innerWidth: 1440, pointerCoarse: false }), false, 'desktop');
  assert.strictEqual(isMobileEnv({ innerWidth: 1440, pointerCoarse: true }), true, 'touch laptop is throttled');
});

test('A: backgroundFrameIntervalMs caps mobile at ~15fps, desktop uncapped', () => {
  const mobile = backgroundFrameIntervalMs({ innerWidth: 390, pointerCoarse: true });
  assert.strictEqual(mobile, Math.round(1000 / MOBILE_FPS));
  assert.ok(mobile >= 60 && mobile <= 70, '~15fps means a ~66ms interval');
  assert.strictEqual(backgroundFrameIntervalMs({ innerWidth: 1440, pointerCoarse: false }), 0);
});

test('A: capDevicePixelRatio caps mobile at 1.5, desktop keeps raw ratio', () => {
  assert.strictEqual(capDevicePixelRatio(3, { innerWidth: 390, pointerCoarse: true }), 1.5, 'iPhone 15 DPR 3 → 1.5');
  assert.strictEqual(capDevicePixelRatio(2, { innerWidth: 390, pointerCoarse: true }), 1.5);
  assert.strictEqual(capDevicePixelRatio(1, { innerWidth: 390, pointerCoarse: true }), 1);
  assert.strictEqual(capDevicePixelRatio(3, { innerWidth: 1440, pointerCoarse: false }), 3, 'desktop unchanged');
  assert.strictEqual(capDevicePixelRatio(undefined, { innerWidth: 1440 }), 1, 'fallback is 1');
  assert.strictEqual(capDevicePixelRatio(0, { innerWidth: 1440 }), 1, 'invalid DPR falls back to 1');
});

// ── A: ParticleBackground wiring (source inspection) ─────────────────────────

test('A: ParticleBackground pauses the loop on visibilitychange with cleanup', () => {
  const src = read(PARTICLE_BG);
  assert.ok(src.includes("addEventListener('visibilitychange', handleVisibilityChange)"), 'listener must be registered');
  assert.ok(src.includes("removeEventListener('visibilitychange', handleVisibilityChange)"), 'listener must be removed in onDestroy');
  assert.ok(src.includes('document.hidden'), 'handler must branch on document.hidden');
  assert.ok(src.includes('stopLoop()'), 'hidden must cancel the rAF loop');
  assert.ok(src.includes('cancelAnimationFrame'), 'stop path must cancel the pending frame');
});

test('A: ParticleBackground honors prefers-reduced-motion with a static frame', () => {
  const src = read(PARTICLE_BG);
  assert.ok(src.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'must query reduced-motion');
  assert.ok(src.includes('renderStaticFrame'), 'reduced motion must render one static frame');
  assert.ok(src.includes("motionQuery.addEventListener('change'"), 'must react to live changes');
  assert.ok(src.includes("motionQuery.removeEventListener('change'"), 'media listener must be cleaned up');
});

test('A: ParticleBackground applies the fps cap via frame-skip and caps DPR', () => {
  const src = read(PARTICLE_BG);
  assert.ok(src.includes('backgroundFrameIntervalMs'), 'must use the shared fps helper');
  assert.ok(/now - lastRenderTime < frameIntervalMs/.test(src), 'loop must skip frames by timestamp delta');
  assert.ok(src.includes('capDevicePixelRatio'), 'resize must cap DPR through the shared helper');
  assert.ok(!/const dpr = window\.devicePixelRatio/.test(src), 'raw uncapped DPR read must be gone');
});

// ── B: backdrop-filter gate on the five glass components ─────────────────────

const GLASS_COMPONENTS = [
  'UserMessage.svelte',
  'AssistantMessage.svelte',
  'ToolCard.svelte',
  'ThinkingBubble.svelte',
  'PlanCard.svelte',
];

for (const name of GLASS_COMPONENTS) {
  test(`B: ${name} drops backdrop-filter under max-width: 768px with an opaque fallback`, () => {
    const src = read(path.join(WEB, 'components', name));
    assert.ok(src.includes('@media (max-width: 768px)'), `${name}: missing the mobile media query`);
    assert.ok(src.includes('backdrop-filter: none'), `${name}: media query must disable backdrop-filter`);
    assert.ok(src.includes('-webkit-backdrop-filter: none'), `${name}: must disable the -webkit- variant too`);
    // The fallback background must be substantially more opaque than the
    // glass original (which relied on blur for legibility over the canvas).
    const m = src.match(/@media \(max-width: 768px\)[\s\S]*?rgba\((\d+), (\d+), (\d+), (0\.\d+)\)/);
    assert.ok(m, `${name}: media query must set an rgba fallback background`);
    assert.ok(parseFloat(m[4]) >= 0.9, `${name}: fallback alpha ${m[4]} is too transparent without blur`);
  });
}

test('B: desktop glass rules are untouched (still blur at >768px)', () => {
  for (const name of GLASS_COMPONENTS) {
    const src = read(path.join(WEB, 'components', name));
    assert.ok(/backdrop-filter: blur\(\d+px\)/.test(src), `${name}: original blur rule must remain`);
  }
});

// ── C: content-visibility cheap virtualization ───────────────────────────────

test('C: message wrapper uses content-visibility: auto with intrinsic size', () => {
  const src = read(MESSAGES_LIST);
  assert.ok(src.includes('content-visibility: auto'), 'wrapper must skip off-screen layout/paint');
  assert.ok(src.includes('contain-intrinsic-size: auto 120px'), 'must keep a sane placeholder height');
});

// ── D: infinite animations only on the last assistant message ────────────────

test('D: MessagesList computes the last assistant index and passes isLast', () => {
  const src = read(MESSAGES_LIST);
  assert.ok(src.includes('lastAssistantIndex'), 'must track the last assistant message');
  assert.ok(src.includes('isLast={i === lastAssistantIndex}'), 'each AssistantMessage must receive isLast');
});

test('D: AssistantMessage gates gradientRotate and the ::after blur on .animated', () => {
  const src = read(ASSISTANT_MSG);
  assert.ok(src.includes('export let isLast'), 'must accept the isLast prop');
  assert.ok(src.includes('class:animated={isLast}'), 'root must toggle the animated class');
  assert.ok(src.includes('.assistant-message.animated::before'), 'gradientRotate must be scoped to animated');
  assert.ok(src.includes('.assistant-message.animated::after'), 'blur layer must be scoped to animated');
  // The base ::before rule must no longer carry the infinite animation
  const base = src.match(/\.assistant-message::before \{[\s\S]*?\}/);
  assert.ok(base && !base[0].includes('animation:'), 'base ::before must be static');
});

test('D: LunaAvatar animation is opt-in via the animate prop', () => {
  const src = read(LUNA_AVATAR);
  assert.ok(src.includes('export let animate'), 'must accept the animate prop');
  assert.ok(src.includes('class:static={!animate}'), 'static class must toggle off animate');
  assert.ok(src.includes('.luna-avatar.static'), 'static state must override the infinite pulse');
  const am = read(ASSISTANT_MSG);
  assert.ok(am.includes('animate={isLast}'), 'AssistantMessage must pass animate=isLast to LunaAvatar');
});

// ── E: streaming scroll behavior ─────────────────────────────────────────────

test('E: auto-scroll is instant during streaming, smooth otherwise', () => {
  const src = read(MESSAGES_LIST);
  assert.ok(
    src.includes("scrollManager.scrollToBottom(listEl, $isStreaming ? 'auto' : 'smooth')"),
    'reactive auto-scroll must pick behavior by streaming state'
  );
  // CSS scroll-behavior: smooth would override behavior:'auto' — it must be gone
  assert.ok(!src.includes('scroll-behavior: smooth'), 'CSS scroll-behavior: smooth must be removed');
});

test('E: user-initiated scrolls stay smooth and the scroll-up guard survives', () => {
  const src = read(MESSAGES_LIST);
  assert.ok(src.includes('userScrolledUp'), 'user-scrolled-up guard must remain');
  const badge = src.match(/function scrollToBottom\(\) \{[\s\S]*?\}/);
  assert.ok(badge && badge[0].includes("'smooth'"), 'badge jump must stay smooth');
});
