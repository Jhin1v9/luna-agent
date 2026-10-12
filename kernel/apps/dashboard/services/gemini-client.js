/**
 * Gemini Multi-Key Client with Quota Fallback
 * -----------------------------------------------------------
 * Rotates between multiple API keys. If one hits 429/quota,
 * automatically tries the next. Returns human-readable reset
 * time when all keys are exhausted.
 *
 * Usage:
 *   const { genAI, getGeminiResetTime } = require('./services/gemini-client');
 *   const result = await genAI.models.generateContent({ model: '...', contents: [...] });
 */

const { GoogleGenAI } = require('@google/genai');

// ── Parse multi-key env var ───────────────────────────────
const rawKeys = (process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);

const genAIInstances = rawKeys.map(key => new GoogleGenAI({ apiKey: key }));

if (genAIInstances.length === 0) {
  console.warn('[GeminiClient] Nenhuma GEMINI_API_KEY configurada!');
}

// ── Reset time helper ─────────────────────────────────────
function getGeminiResetTime(timezone = 'Europe/Madrid') {
  const now = new Date();
  // Gemini free-tier quota resets at midnight Pacific Time (PT).
  // PT is UTC-7 (PDT) or UTC-8 (PST). Approximate reset = 07:00-08:00 UTC next day.
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(7, 0, 0, 0); // 07:00 UTC ≈ midnight PT

  const time = tomorrow.toLocaleTimeString('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit'
  });
  const date = tomorrow.toLocaleDateString('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit'
  });

  return {
    iso: tomorrow.toISOString(),
    time,
    date,
    tz: timezone === 'Europe/Madrid' ? 'CEST' : timezone
  };
}

// ── Proxy that does round-robin + fallback ────────────────
const genAI = {
  models: {
    generateContent: async (params) => {
      if (genAIInstances.length === 0) {
        throw new Error('Nenhuma API key do Gemini configurada');
      }
      let lastError = null;
      for (let i = 0; i < genAIInstances.length; i++) {
        try {
          return await genAIInstances[i].models.generateContent(params);
        } catch (err) {
          lastError = err;
          const msg = err.message || '';
          const isQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
          if (isQuota) {
            console.warn(`[Gemini] Key ${i + 1}/${genAIInstances.length} esgotada (429), tentando próxima...`);
            continue;
          }
          throw err;
        }
      }
      // All keys exhausted
      const resetTime = getGeminiResetTime();
      const error = new Error('GEMINI_ALL_KEYS_EXHAUSTED');
      error.code = 'GEMINI_ALL_KEYS_EXHAUSTED';
      error.resetAt = resetTime.iso;
      error.resetTime = resetTime.time;
      error.resetDate = resetTime.date;
      error.resetTz = resetTime.tz;
      error.originalError = lastError;
      throw error;
    }
  }
};

module.exports = { genAI, getGeminiResetTime, genAIInstances };
