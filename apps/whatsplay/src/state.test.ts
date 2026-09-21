import { describe, it, expect } from 'vitest';
import { detectStateFromProbes, type StateProbes } from './state.js';

/**
 * Fixtures extraídos do probe ao vivo (2026-09-21, .brain/luna/incidents/probe-*.json)
 * e do DOM de splash capturado. Cenário cobre o falso negativo da F1.4.
 */

// Amostra real da sessão LOGADA (probe 16:50:00Z, app renderizado).
const REAL_LOGGED_IN: StateProbes = {
  paneSide: 1,
  chatListTestId: 1,
  chatListRoleGrid: 1,
  landingWrapper: 0,
  landingMain: 0,
  qrTestId: 0,
  qrRef: 0,
  canvasInLanding: 0,
};

// Splash screen: nenhum marcador estrutural (dump de 2828 bytes, noscript bootstrap).
const SPLASH: StateProbes = {
  paneSide: 0,
  chatListTestId: 0,
  chatListRoleGrid: 0,
  landingWrapper: 0,
  landingMain: 0,
  qrTestId: 0,
  qrRef: 0,
  canvasInLanding: 0,
};

// Tela de intro/QR de verdade: landing + data-ref, sem lista de chats.
const QR_SCREEN: StateProbes = {
  ...SPLASH,
  landingWrapper: 1,
  landingMain: 1,
  qrRef: 1,
  canvasInLanding: 1,
};

describe('heurística de estado da sessão (fix do falso negativo F1.4)', () => {
  it('sessão logada real → LOGGED_IN', () => {
    expect(detectStateFromProbes(REAL_LOGGED_IN)).toBe('LOGGED_IN');
  });

  it('REGRESSÃO: app logado com canvas presente → LOGGED_IN (nunca QR_PENDING)', () => {
    // O bug da F1.4: canvas solto como marcador de QR falsificava QR_PENDING.
    expect(detectStateFromProbes({ ...REAL_LOGGED_IN, chatListTestId: 0 })).toBe('LOGGED_IN');
    expect(detectStateFromProbes({ ...REAL_LOGGED_IN, paneSide: 1, chatListRoleGrid: 3 })).toBe('LOGGED_IN');
  });

  it('REGRESSÃO: marcadores de QR coexistindo com lista de chats → LOGGED_IN', () => {
    // Frame transitório: landing ainda no DOM mas o app já renderizou.
    expect(detectStateFromProbes({ ...REAL_LOGGED_IN, landingWrapper: 1, qrRef: 1 })).toBe('LOGGED_IN');
  });

  it('aria-label localizada não é mais dependência: sem testid, pane-side/grid resolve', () => {
    // UI em ES/PT nunca casa [aria-label="Chat list"] — pane-side resolve.
    expect(
      detectStateFromProbes({ ...SPLASH, paneSide: 1, chatListRoleGrid: 1 }),
    ).toBe('LOGGED_IN');
  });

  it('tela de QR real → QR_PENDING', () => {
    expect(detectStateFromProbes(QR_SCREEN)).toBe('QR_PENDING');
  });

  it('splash sem nada → LOADING (nunca QR_PENDING)', () => {
    expect(detectStateFromProbes(SPLASH)).toBe('LOADING');
  });

  it('sem pane-side mas com grid de chats → LOGGED_IN', () => {
    expect(detectStateFromProbes({ ...SPLASH, chatListRoleGrid: 1 })).toBe('LOGGED_IN');
  });
});
