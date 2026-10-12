'use strict';

/**
 * Wave 2 Fix D3: premature-completion guard for sendMessageStream.
 *
 * Right after Enter, the PREVIOUS turn's response is still visible and stable
 * in the DOM, so the DOM poller can re-fire a completion_candidate before any
 * text of the new turn has streamed. If nothing has been observed yet this
 * turn (no response and no thinking text), the candidate is stale and must be
 * ignored — accepting it would end the stream instantly with the old turn's
 * content.
 */
function isPrematureCompletion({ lastResponse, lastThinking }) {
  return !lastResponse && !lastThinking;
}

module.exports = { isPrematureCompletion };
