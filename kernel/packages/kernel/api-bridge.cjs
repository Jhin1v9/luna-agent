'use strict';
/**
 * ApiBridge — transporte OpenAI-compatible para a Luna (Fase 1 da Fusão API).
 * Implementa a MESMA interface pública do KimiBridge:
 *   connect(), disconnect(), sendMessageStream(userId, prompt, opts, provider),
 *   newChat(), cancelStream(), recoverSession(), canSteer()
 * Sem Chrome, sem CDP, sem DOM. O prompt já chega com o master prompt embutido
 * (builder de contexto do soul), então o protocolo [[action]] continua valendo —
 * o parse e a execução de tools continuam 100% no luna-soul.
 */

const TIMEOUT_MS = 10 * 60 * 1000; // exceção justificada no ADR: APIs grátis são lentas

class ApiBridge {
  constructor({ baseUrl, apiKey = null, model, label = 'api' }) {
    if (!baseUrl || !model) throw new Error('ApiBridge exige baseUrl e model');
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = apiKey || null;
    this.model = model;
    this.label = label;
    this.connected = false;
    this._abort = null;
    console.log(`[API-BRIDGE] transporte API: ${label} @ ${this.baseUrl} model=${model}${apiKey ? ' (key ok)' : ' (sem key)'}`);
  }

  async connect() { this.connected = true; }
  async disconnect() { this.connected = false; await this.cancelStream(); }
  async newChat() { /* stateless — nada a fazer */ }
  async recoverSession() { /* noop ok por contrato */ }
  canSteer() { return false; }

  async cancelStream() {
    if (this._abort) {
      try { this._abort.abort(); } catch { /* já abortado */ }
      this._abort = null;
    }
  }

  /**
   * Envia o prompt para {baseUrl}/chat/completions (SSE) e yielda eventos
   * no formato que o soul consome: thinking_delta / response_delta / done.
   */
  async *sendMessageStream(userId, prompt, options = {}, provider) {
    if (options.files && options.files.length) {
      console.warn('[API-BRIDGE] anexos de arquivo ignorados no transporte API (v1)');
    }

    this._abort = new AbortController();
    const timeout = setTimeout(() => this._abort.abort(new Error('timeout 10min')), TIMEOUT_MS);

    let fullThinking = '';
    let fullResponse = '';
    let usage = null;
    let finished = false;

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          stream: true,
        }),
        signal: this._abort.signal,
      });

      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`HTTP ${res.status} do provider ${this.label}: ${body}`);
      }

      // ── SSE parsing ──
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // último pedaço pode estar incompleto
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const data = t.slice(5).trim();
          if (data === '[DONE]') { finished = true; break; }
          let json;
          try { json = JSON.parse(data); } catch { continue; }
          const delta = json.choices?.[0]?.delta || {};
          if (delta.reasoning_content) {
            fullThinking += delta.reasoning_content;
            yield { type: 'thinking_delta', text: delta.reasoning_content, fullThinking };
          }
          if (delta.content) {
            fullResponse += delta.content;
            yield { type: 'response_delta', text: delta.content, fullResponse };
          }
          if (json.usage) usage = json.usage;
          if (json.choices?.[0]?.finish_reason && !delta.content && !delta.reasoning_content) finished = true;
        }
        if (finished) break;
      }

      if (!fullResponse && !fullThinking) {
        throw new Error(`provider ${this.label} respondeu vazio`);
      }

      yield {
        type: 'done',
        result: { success: true, mode: 'CHAT', response: fullResponse || fullThinking, usage },
      };
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error(`provider ${this.label}: stream abortado (cancel/timeout)`);
      }
      throw e;
    } finally {
      clearTimeout(timeout);
      this._abort = null;
    }
  }
}

module.exports = { ApiBridge };
