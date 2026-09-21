import type { KimiAdapterConfig } from './types.js';

/**
 * Probe de capability VISÃO (Model Router contrato §9: validar no boot).
 * Envia um chat completion com uma imagem 1x1 embutida e observa se o
 * provider aceita. kimi-k2.6 (coding endpoint) é texto puro — o probe
 * confirma na prática; sem visão, a auto-reparação analisa DOM-texto
 * (degradação explícita, ADR-021).
 */

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export interface VisionProbeResult {
  supported: boolean;
  detail: string;
}

export async function probeVisionSupport(
  config: KimiAdapterConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<VisionProbeResult> {
  const key = config.apiKey ?? process.env.LLM_API_KEY;
  const base = (config.apiBaseUrl ?? process.env.LLM_BASE_URL ?? 'https://api.kimi.com/coding/v1').replace(/\/$/, '');
  const model = config.apiModel ?? process.env.LLM_MODEL ?? 'kimi-k2.6';
  if (!key) return { supported: false, detail: 'sem API key — visão não verificável' };

  try {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Descreva esta imagem em uma palavra.' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG}` } },
            ],
          },
        ],
        max_tokens: 8,
      }),
    });
    if (res.ok) return { supported: true, detail: 'provider aceitou content multipart com imagem' };
    const body = (await res.text().catch(() => '')).slice(0, 200);
    return { supported: false, detail: `HTTP ${res.status}: ${body}` };
  } catch (err) {
    return { supported: false, detail: `probe falhou: ${err instanceof Error ? err.message : String(err)}` };
  }
}
