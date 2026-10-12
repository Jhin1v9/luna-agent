(() => {
  // Luna Stream Interceptor v3.7
  // Intercepts Kimi Web API responses to extract thinking vs response text
  // CRITICAL FIX: Uses ReadableStream.tee() because response.clone().text()
  // does NOT work for SSE streaming responses — the clone's body is already
  // consumed by the page's reader, so clone.text() returns empty.

  window.__lunaStream = {
    active: true,
    reasoning: [],
    content: [],
    toolCalls: [],
    reset() {
      this.reasoning = [];
      this.content = [];
      this.toolCalls = [];
    }
  };

  // v3.6-fix: Expose reset function for kimibridge to call between messages
  window.__lunaResetStream = function() {
    if (window.__lunaStream) {
      window.__lunaStream.reasoning = [];
      window.__lunaStream.content = [];
      window.__lunaStream.toolCalls = [];
    }
  };

  const ORIGINAL_FETCH = window.fetch;
  window.fetch = async function(...args) {
    const response = await ORIGINAL_FETCH.apply(this, args);
    // v3.8-fix: Support Request objects (Kimi passes Request, not string)
    let url = args[0];
    if (url instanceof Request) url = url.url;
    if (typeof url === 'string' && (
      url.includes('/api/chat') ||
      url.includes('/ChatService/Chat') ||
      url.includes('/kimi.gateway.chat') ||
      url.includes('/apiv2/kimi.chat') ||
      url.includes('/apiv2/kimi.gateway.chat') ||
      url.includes('/kimi.chat.v1.ChatService') ||
      url.includes('/ChatService/ChatCompletion')
    )) {
      // CRITICAL: For streaming SSE responses, we MUST tee the body stream.
      // response.clone() creates a new Response with a cloned body, but if
      // the original body is a ReadableStream that's already being consumed
      // by the page's EventSource/fetch reader, the clone will be empty.
      // tee() splits the stream into two independent readable streams.
      if (response.body && typeof response.body.tee === 'function') {
        try {
          const [streamForPage, streamForInterceptor] = response.body.tee();
          // Give the page the original stream
          const newResponse = new Response(streamForPage, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
          // Read the interceptor stream in the background
          (async () => {
            const reader = streamForInterceptor.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  if (buffer.trim()) parseKimiStream(buffer);
                  break;
                }
                buffer += decoder.decode(value, { stream: true });
                // Parse complete lines, keep partial line in buffer
                let lines;
                [lines, buffer] = splitLines(buffer);
                if (lines.length > 0) {
                  parseKimiStream(lines.join('\n'));
                }
              }
            } catch (e) { /* ignore stream read errors */ }
          })();
          return newResponse;
        } catch (e) {
          // Fallback: try clone (may not work for streams but worth a shot)
          const clone = response.clone();
          clone.text().then(body => parseKimiStream(body)).catch(() => {});
        }
      } else {
        // Non-streaming fallback
        const clone = response.clone();
        clone.text().then(body => parseKimiStream(body)).catch(() => {});
      }
    }
    return response;
  };

  function splitLines(text) {
    const idx = text.lastIndexOf('\n');
    if (idx === -1) return [[], text];
    return [text.slice(0, idx).split('\n'), text.slice(idx + 1)];
  }

  function parseKimiStream(text) {
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line.trim() || !line.startsWith('data:')) continue;
      try {
        const json = JSON.parse(line.slice(5));
        // Kimi Connect-RPC format: { result: { message: { reasoning_content, content } } }
        const msg = json?.result?.message || json?.message;
        if (msg) {
          if (msg.reasoning_content) {
            window.__lunaStream.reasoning.push(msg.reasoning_content);
          }
          if (msg.content) {
            window.__lunaStream.content.push(msg.content);
          }
          if (msg.tool_calls) {
            window.__lunaStream.toolCalls.push(...msg.tool_calls);
          }
        }
        // Alternative: delta format
        const delta = json?.result?.delta || json?.delta;
        if (delta) {
          if (delta.reasoning_content) {
            window.__lunaStream.reasoning.push(delta.reasoning_content);
          }
          if (delta.content) {
            window.__lunaStream.content.push(delta.content);
          }
        }
      } catch (e) { /* ignore JSON parse errors */ }
    }
  }

  // Also intercept XMLHttpRequest as fallback
  const ORIGINAL_XHR_OPEN = XMLHttpRequest.prototype.open;
  const ORIGINAL_XHR_SEND = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._lunaUrl = url;
    return ORIGINAL_XHR_OPEN.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    this.addEventListener('load', function() {
      if (typeof this._lunaUrl === 'string' && (
        this._lunaUrl.includes('/api/chat') ||
        this._lunaUrl.includes('/ChatService/Chat') ||
        this._lunaUrl.includes('/kimi.gateway.chat') ||
        this._lunaUrl.includes('/apiv2/kimi.chat') ||
        this._lunaUrl.includes('/apiv2/kimi.gateway.chat') ||
        this._lunaUrl.includes('/kimi.chat.v1.ChatService') ||
        this._lunaUrl.includes('/ChatService/ChatCompletion')
      )) {
        try { parseKimiStream(this.responseText); } catch (e) {}
      }
    });
    return ORIGINAL_XHR_SEND.call(this, body);
  };
})();
