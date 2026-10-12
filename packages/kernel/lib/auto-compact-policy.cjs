'use strict';

/**
 * W10-T2: Auto-compact policy for the web chat path.
 *
 * When Kimi Web reports the context limit ("Your conversation with Kimi is
 * getting too long..."), Luna auto-compacts (new thread + checkpoint) and
 * resends the user's original message — mirroring the Telegram path
 * (_kimiSendWithTimeout). Owner directive 2026-07-13 supersedes the old
 * manual-only decision (.brain/decisions.md:24).
 *
 * Extracted from luna-soul.cjs so the one-shot guard and the newChat
 * suppression are unit-testable without a live bridge.
 */

/**
 * Decide what to do when the provider reports a context limit.
 * One-shot guard: at most ONE auto-compact per user message. If the resent
 * message hits the limit again, fall back to the manual hint (system
 * message + done) instead of compacting forever.
 *
 * @param {{autoCompactAttempted: boolean}} state per-user-message state
 * @returns {'compact_and_resend' | 'fallback_hint'}
 */
function onContextLimit(state) {
  return state && state.autoCompactAttempted ? 'fallback_hint' : 'compact_and_resend';
}

/**
 * Whether a send inside processMessageStream should force a fresh Kimi chat.
 * After an auto-compact the fresh thread was ALREADY created by
 * _compactContext (checkpoint included) — forcing another newChat on the
 * resend would throw the checkpoint away, so it is suppressed.
 *
 * @param {{provider: string, isFirstMessage: boolean, bridgeRetryCount: number, autoCompactAttempted: boolean}} opts
 * @returns {boolean}
 */
function shouldForceNewChat({ provider, isFirstMessage, bridgeRetryCount, autoCompactAttempted }) {
  return provider === 'kimi' && !!isFirstMessage && bridgeRetryCount === 0 && !autoCompactAttempted;
}

module.exports = { onContextLimit, shouldForceNewChat };
