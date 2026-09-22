/**
 * Auto-atender chamada entrante (§26): o WhatsApp Web toca um popup de chamada;
 * o WhatsPlay atende via Playwright e liga o VoiceBridge. Se ninguém atende
 * em ~15s, msg automática de fallback. Sem hardware de voz montado, atender
 * abre a chamada SEM áudio duplex — o software fica pronto e o guia de
 * hardware (docs/hardware-voz.md) conduz o resto manualmente.
 */

export interface IncomingCallDetector {
  /** true se há chamada entrando tocando agora. */
  hasIncoming(): Promise<boolean>;
  /** Atende. Retorna true se o clique funcionou. */
  accept(): Promise<boolean>;
  /** Recusa/encerra. */
  decline(): Promise<void>;
}

/** Script de detecção: popup de chamada no WA Web (best-effort, marcadores). */
export const INCOMING_CALL_SCRIPT = `(() => {
  const markers = [
    '[data-testid="incoming-call"]',
    '[data-icon="audio-call-incoming"]',
    '[aria-label*="Atender" i]',
    '[aria-label*="Answer" i]',
  ];
  for (const m of markers) {
    const el = document.querySelector(m);
    if (el && el.offsetParent !== null) return { incoming: true, marker: m };
  }
  return { incoming: false };
})()`;

export const ACCEPT_CALL_SCRIPT = `(() => {
  const btn = document.querySelector('[data-testid="answer"], [aria-label*="Atender" i], [aria-label*="Answer" i], [data-icon="call-incoming"]');
  if (btn) { btn.click(); return true; }
  return false;
})()`;

export const FALLBACK_CALL_TEXT =
  'vi que você ligou — manda áudio ou escreve que eu faço na hora';

export interface AutoAnswerDeps {
  detector: IncomingCallDetector;
  /** Só dispara fallback para caller no escopo (allowlist — decreto owner). */
  isCallerAllowed: (chatId: string) => boolean | Promise<boolean>;
  callerChatId: string;
  sendText: (chatId: string, text: string) => Promise<void>;
  onAnswered: () => Promise<void>;
  timeoutMs?: number;
  now?: () => number;
}

/** Um ciclo: se tocando, espera até timeoutMs e decide atender ou fallback. */
export async function handleIncomingCall(deps: AutoAnswerDeps): Promise<'answered' | 'fallback' | 'none'> {
  if (!(await deps.detector.hasIncoming())) return 'none';
  const deadline = (deps.now?.() ?? Date.now()) + (deps.timeoutMs ?? 15_000);
  while ((deps.now?.() ?? Date.now()) < deadline) {
    if (await deps.detector.accept()) {
      await deps.onAnswered(); // liga o VoiceBridge (guia hardware)
      return 'answered';
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  // timeout ~15s (§26): fallback automático, SÓ se o caller estiver no escopo.
  if (await deps.isCallerAllowed(deps.callerChatId)) {
    await deps.sendText(deps.callerChatId, FALLBACK_CALL_TEXT);
    return 'fallback';
  }
  await deps.detector.decline();
  return 'none';
}
