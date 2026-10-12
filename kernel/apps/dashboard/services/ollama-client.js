/**
 * Ollama Unified Client for NEXO Dashboard PRO
 * Abstrai chamadas ao daemon Ollama com circuit breaker, retry e fallback.
 * 
 * Hardware target: 5-6GB RAM, CPU-only (no GPU)
 * Models: gemma2:2b (intent + chat fallback), qwen3:1.7b (chat PT/ES)
 */

const DEFAULT_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

// Model selection based on available hardware
const MODELS = {
  intent: process.env.OLLAMA_INTENT_MODEL || 'gemma2:2b',   // fast, low latency
  chat: process.env.OLLAMA_CHAT_MODEL || 'qwen3:1.7b',      // multilingual PT/ES
  embed: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text'
};

class OllamaClient {
  constructor(config = {}) {
    this.host = config.host || DEFAULT_HOST;
    this.intentModel = config.intentModel || MODELS.intent;
    this.chatModel = config.chatModel || MODELS.chat;
    this.embedModel = config.embedModel || MODELS.embed;
    this.timeout = config.timeout || 30000;       // 30s default (CPU is slow)
    this.retries = config.retries || 1;           // 1 retry (RAM is tight)
    
    // Circuit breaker state
    this.cb = {
      state: 'CLOSED',     // CLOSED | OPEN | HALF_OPEN
      failCount: 0,
      threshold: 3,        // open after 3 consecutive failures
      resetMs: 60000,      // try again after 60s
      lastFailure: null
    };
  }

  _isCircuitOpen() {
    if (this.cb.state === 'CLOSED') return false;
    if (this.cb.state === 'OPEN') {
      const now = Date.now();
      if (now - this.cb.lastFailure >= this.cb.resetMs) {
        this.cb.state = 'HALF_OPEN';
        this.cb.failCount = 0;
        console.log('[OllamaClient] Circuit breaker HALF_OPEN — testing Ollama...');
        return false;
      }
      return true;
    }
    return false; // HALF_OPEN allows one trial
  }

  _recordSuccess() {
    this.cb.state = 'CLOSED';
    this.cb.failCount = 0;
    this.cb.lastFailure = null;
  }

  _recordFailure(err) {
    this.cb.failCount++;
    this.cb.lastFailure = Date.now();
    if (this.cb.failCount >= this.cb.threshold) {
      this.cb.state = 'OPEN';
      console.error(`[OllamaClient] Circuit breaker OPEN after ${this.cb.failCount} failures. Will retry in ${this.cb.resetMs}ms`);
    }
  }

  async _fetchWithTimeout(url, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${txt.slice(0, 200)}`);
      }
      const text = await res.text();
      // Ollama sometimes returns NDJSON (multiple JSON objects) even with stream:false
      // Parse only the first valid JSON object
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        const firstLine = text.trim().split('\n')[0];
        if (firstLine) {
          try {
            return JSON.parse(firstLine);
          } catch {
            // fallback: try to extract JSON from the first line
          }
        }
        throw new Error(`Ollama JSON parse error: ${parseErr.message}`);
      }
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('OLLAMA_TIMEOUT');
      throw err;
    }
  }

  async _call(endpoint, body, { model, timeout } = {}) {
    if (this._isCircuitOpen()) {
      throw new Error('OLLAMA_CIRCUIT_OPEN');
    }

    const url = `${this.host}${endpoint}`;
    const useModel = model || this.chatModel;
    const useTimeout = timeout || this.timeout;
    let lastErr;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const result = await this._fetchWithTimeout(url, { ...body, model: useModel }, useTimeout);
        this._recordSuccess();
        return result;
      } catch (err) {
        lastErr = err;
        console.warn(`[OllamaClient] Attempt ${attempt + 1} failed: ${err.message}`);
        if (attempt < this.retries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // exponential backoff
        }
      }
    }

    this._recordFailure(lastErr);
    throw lastErr;
  }

  /**
   * Generic text generation via /api/generate
   */
  async generate(prompt, { model, system, temperature = 0.7, maxTokens = 1024, stream = false } = {}) {
    const result = await this._call('/api/generate', {
      prompt,
      system,
      stream,
      options: {
        temperature,
        num_predict: maxTokens,
        stop: ['\n\n', '```']
      }
    }, { model: model || this.chatModel, timeout: 45000 }); // 45s for CPU-only cold start
    return result;
  }

  /**
   * Generate structured intent classification (JSON)
   * Uses low temperature, small max_tokens, fast model
   */
  async classifyIntent(userMessage, context = {}) {
    const systemPrompt = `You are an intent classifier for a business dashboard assistant (NEXO). 
Available intents: consultar_emails, enviar_email, responder_email, criar_tarefa, listar_tarefas, consultar_caixa, registrar_pagamento, listar_leads, criar_lead, consultar_whatsapp, unknown.
Respond ONLY with valid JSON. No markdown, no explanations.
Format: {"intent":"...","confidence":0.0-1.0,"action":"...","entities":{}}`;

    const prompt = `Context: ${JSON.stringify(context)}
User message: "${userMessage}"
Intent JSON:`;

    const result = await this._call('/api/generate', {
      prompt,
      system: systemPrompt,
      stream: false,
      options: {
        temperature: 0.05,
        num_predict: 128,
        stop: ['\n\n', '```']
      }
    }, { model: this.intentModel, timeout: 15000 });

    // Parse JSON from response (model may wrap in markdown)
    let raw = result.response || '';
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('OLLAMA_INVALID_JSON');
    
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      intent: parsed.intent || 'unknown',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      action: parsed.action || parsed.intent || 'unknown',
      entities: parsed.entities || {},
      needsConfirmation: ['enviar_email', 'responder_email', 'excluir_despesa', 'excluir_lead'].includes(parsed.action),
      raw
    };
  }

  /**
   * Chat response with streaming support
   * Uses chat model for natural language responses
   */
  async *chatStream(messages, { temperature = 0.7, maxTokens = 512 } = {}) {
    const url = `${this.host}/api/chat`;
    const body = {
      model: this.chatModel,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      options: { temperature, num_predict: maxTokens }
    };

    if (this._isCircuitOpen()) {
      yield { error: 'OLLAMA_CIRCUIT_OPEN', done: true };
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${txt.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            yield { text: chunk.message?.content || '', done: chunk.done || false };
          } catch (e) {
            // ignore malformed lines
          }
        }
      }
      this._recordSuccess();
    } catch (err) {
      clearTimeout(timer);
      this._recordFailure(err);
      yield { error: err.message, done: true };
    }
  }

  /**
   * Non-streaming chat for simple responses
   */
  async chat(messages, opts = {}) {
    const chunks = [];
    for await (const chunk of this.chatStream(messages, opts)) {
      if (chunk.error) throw new Error(chunk.error);
      if (chunk.done) break;
      chunks.push(chunk.text);
    }
    return chunks.join('');
  }

  /**
   * Generate embeddings for RAG
   */
  async embed(text) {
    const result = await this._call('/api/embeddings', {
      prompt: text
    }, { model: this.embedModel, timeout: 10000 });
    return result.embedding;
  }

  /**
   * Health check
   */
  async isHealthy() {
    try {
      const res = await fetch(`${this.host}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  getStatus() {
    return {
      circuit: this.cb.state,
      failCount: this.cb.failCount,
      models: MODELS,
      host: this.host
    };
  }

  /**
   * Preload model into memory to avoid cold starts
   */
  async preload() {
    try {
      console.log('[OllamaClient] Preloading intent model:', this.intentModel);
      // Send a dummy generate request to load model into RAM
      await this._call('/api/generate', {
        prompt: 'hello',
        options: { temperature: 0, num_predict: 1 }
      }, { model: this.intentModel, timeout: 60000 });
      console.log('[OllamaClient] Preload complete');
    } catch (err) {
      console.warn('[OllamaClient] Preload failed:', err.message);
      throw err;
    }
  }
}

module.exports = { OllamaClient, MODELS };
