/**
 * Heurística de estado da sessão WhatsApp Web — PURA e testável.
 *
 * Causa raiz do falso negativo da F1.4 (análise ao vivo 2026-09-21, probe real
 * contra a sessão logada — ver .brain/luna/incidents/probe-*.json):
 *
 * 1. **Race com a splash screen**: a descoberta avaliava os seletores após uma
 *    espera fixa de 15s, mas o app às vezes fica mais tempo na tela intermediária
 *    (intro/QR) — o QR era detectado num frame transitório e o relatório saía
 *    QR_PENDING instantes antes do app terminar de carregar a lista de chats.
 * 2. **`canvas` genérico como marcador de QR**: `canvas` existe em várias telas;
 *    como marcador de "QR visível" ele gera falso positivo de QR_PENDING.
 * 3. **aria-label localizada**: `[aria-label="Chat list"]` nunca casa em UI
 *    ES/PT ("Lista de chats") — sorte do `data-testid="chat-list"` existir.
 *
 * Regras da heurística (ordem importa):
 *   - Marcadores LOGGED são autoridade: qualquer um presente → LOGGED_IN,
 *     MESMO que marcadores de QR/canvas também existam (app logado com overlay).
 *   - QR só vale na ausência de marcadores LOGGED e com marcadores estruturais
 *     de landing (nunca `canvas` solto).
 *   - Nada de marcador estrutural → LOADING (a página ainda está carregando).
 */

export interface StateProbes {
  /** #pane-side — container da lista de chats (presente só logado). */
  paneSide: number;
  /** [data-testid="chat-list"] — versões atuais do app. */
  chatListTestId: number;
  /** role="grid" — lista de chats em versões sem testid. */
  chatListRoleGrid: number;
  /** .landing-wrapper / .landing-main — tela de intro/QR. */
  landingWrapper: number;
  landingMain: number;
  /** QR propriamente: testid ou atributo data-ref (nunca canvas solto). */
  qrTestId: number;
  qrRef: number;
  /** Canvas DENTRO da landing — único canvas que vale como marcador de QR. */
  canvasInLanding: number;
}

export type SessionState = 'LOGGED_IN' | 'QR_PENDING' | 'LOADING' | 'UNKNOWN';

export function detectStateFromProbes(p: Partial<StateProbes>): SessionState {
  const logged =
    (p.paneSide ?? 0) > 0 || (p.chatListTestId ?? 0) > 0 || (p.chatListRoleGrid ?? 0) > 0;
  if (logged) return 'LOGGED_IN';

  const qr =
    (p.landingWrapper ?? 0) > 0 ||
    (p.landingMain ?? 0) > 0 ||
    (p.qrTestId ?? 0) > 0 ||
    (p.qrRef ?? 0) > 0 ||
    (p.canvasInLanding ?? 0) > 0;
  if (qr) return 'QR_PENDING';

  // Nenhum marcador estrutural reconhecido: ainda carregando (splash).
  return 'LOADING';
}
