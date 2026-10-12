'use strict';
// Wave 4 bug 6: normalize tool progress payloads. Tools report progress
// positionally — onProgress(chunkString, streamName) — while the SSE pipeline
// needs a named `chunk` field on a plain action_progress event.
function makeProgressEvent({ toolInstanceId, tool, chunk, stream, sessionId } = {}) {
  return {
    type: 'action_progress',
    toolInstanceId,
    tool,
    chunk: typeof chunk === 'string' ? chunk : (chunk == null ? '' : String(chunk)),
    stream: stream || 'stdout',
    sessionId,
  };
}
module.exports = { makeProgressEvent };
