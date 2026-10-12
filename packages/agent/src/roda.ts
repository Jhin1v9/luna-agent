import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createLogger } from '@luna/logging';
import type { Logger } from 'pino';
import type {
  KimiAdapterConfig,
  KimiLiveAdapter,
  SessionInfo,
  TurnRequest,
  TurnResult,
} from './types.js';
import { KimiAdapterError } from './types.js';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * RodaAdapter — FAST brain na "roda de providers" (ADR-041).
 * `KIMI_ADAPTER_MODE=roda` troca o fast brain de Kimi+FallbackAdapter para a
 * roda configurada em config/providers.json (contrato único editado pelo
 * painel — troca de provider = só o painel, zero deploy).
 *
 * Regras (herdadas do espírito do FallbackAdapter, ADR-039 — nunca falha em
 * silêncio):
 *  - Só entram providers `enabled === true` E `transport === 'openai'`,
 *    ordenados por priority (menor = tenta primeiro).
 *  - A key de cada provider vem do process.env pelo NOME em `apiKeyEnv`
 *    (nunca o valor no JSON — secrets só via env, §21). `apiKeyEnv: null`
 *    = provider sem Authorization header (locais).
 *  - Key ausente = provider PULADO com log estruturado (não é falha de rede).
 *  - Cada provider: POST {baseUrl}/chat/completions (mesmo shape do
 *    OpenAiCompatAdapter), retry 2x, timeout 60s.
 *  - Falha (rede, 429, 5xx, key ausente): cooldown de 60s em memória por
 *    provider e segue pro próximo, logando `roda: <id> falhou (<causa>) →
 *    próximo: <id>` — SEM a key na causa.
 *  - Se TODOS falharem: erro explícito com as causas acumuladas
 *    (200 chars cada, sem secrets).
 */

const COOLDOWN_MS = 60_000;
const RETRIES = 2;
const TIMEOUT_MS = 60_000;

const providerSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  transport: z.enum(['openai', 'anthropic', 'fcc-local']),
  baseUrl: z.string(),
  apiKeyEnv: z.string().nullable(),
  model: z.string(),
  models: z.array(z.string()).optional(),
  enabled: z.boolean(),
  priority: z.number(),
  builtin: z.boolean().optional(),
});

const rodaConfigSchema = z.object({
  fastBrain: z.string(),
  liveBrain: z.string(),
  providers: z.array(providerSchema),
});

export type RodaProvider = z.infer<typeof providerSchema>;
export type RodaConfig = z.infer<typeof rodaConfigSchema>;

/** Config da roda ausente/inválida — ação humana no painel. */
export class RodaConfigMissing extends KimiAdapterError {
  constructor(detail: string) {
    super(`roda: config/providers.json ${detail} — configure a roda de providers no painel.`);
    this.name = 'RodaConfigMissing';
  }
}

export interface RodaAdapterDeps {
  /** Caminho do providers.json (default: raiz do monorepo). */
  configPath?: string;
  /** Fetch injetável (testes). */
  fetchImpl?: FetchLike;
  /** Logger injetável (testes). */
  log?: Logger;
  /** Clock injetável (testes). */
  now?: () => number;
}

/** Causa resumida e sanitizada para log/erro — nunca inclui a key. */
function summarize(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/Bearer\s+\S+/gi, 'Bearer <redigido>').slice(0, 200);
}

export class RodaAdapter implements KimiLiveAdapter {
  readonly mode = 'roda' as const;
  private readonly providers: RodaProvider[];
  private readonly fetchImpl: FetchLike;
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly temperature: number | undefined;
  private readonly cooldownUntil = new Map<string, number>();

  constructor(config: KimiAdapterConfig = { mode: 'roda' }, deps: RodaAdapterDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.log = deps.log ?? createLogger({ name: 'roda' });
    this.now = deps.now ?? Date.now;
    this.timeoutMs = config.apiTimeoutMs ?? TIMEOUT_MS;
    this.temperature = config.apiTemperature ?? 0;

    const configPath =
      deps.configPath ??
      join(dirname(fileURLToPath(import.meta.url)), '../../../config/providers.json');
    if (!existsSync(configPath)) {
      throw new RodaConfigMissing(`não encontrado em ${configPath}`);
    }
    let parsed: RodaConfig;
    try {
      parsed = rodaConfigSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')));
    } catch (err) {
      if (err instanceof RodaConfigMissing) throw err;
      throw new RodaConfigMissing(`inválido: ${summarize(err)}`);
    }
    this.providers = parsed.providers
      .filter((p) => p.enabled === true && p.transport === 'openai')
      .sort((a, b) => a.priority - b.priority);
    if (this.providers.length === 0) {
      throw new RodaConfigMissing('não tem nenhum provider openai habilitado');
    }
  }

  async ensureSession(sessionKey: string): Promise<SessionInfo> {
    return { session_id: `roda:${sessionKey}`, busy: false };
  }

  async sendTurn(request: TurnRequest): Promise<TurnResult> {
    const erros: string[] = [];
    let ultimoTentado: string | null = null;
    for (const provider of this.providers) {
      if (this.inCooldown(provider.id)) continue;
      const key = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined;
      if (provider.apiKeyEnv && !key) {
        // Key ausente não é falha de rede — pula com log e segue (sem
        // cooldown: a key pode ser adicionada sem restart).
        this.log.warn({ roda: provider.id, apiKeyEnv: provider.apiKeyEnv }, 'roda: key ausente no env — provider pulado');
        continue;
      }
      ultimoTentado = provider.id;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= RETRIES; attempt++) {
        try {
          const r = await this.callProvider(provider, key, request);
          this.cooldownUntil.delete(provider.id);
          return { ...r, provider: provider.id };
        } catch (err) {
          lastErr = err;
        }
      }
      this.cooldownUntil.set(provider.id, this.now() + COOLDOWN_MS);
      const causa = summarize(lastErr);
      const proximo = this.nextAfter(provider.id);
      this.log.warn({ roda: provider.id, causa }, `roda: ${provider.id} falhou (${causa}) → próximo: ${proximo ?? 'nenhum'}`);
      erros.push(`${provider.id}: ${causa}`);
    }
    throw new KimiAdapterError(
      `roda: todos os providers falharam (${erros.length} tentados${ultimoTentado === null ? ' — todos em cooldown' : ''}) — ` +
        (erros.length ? erros.join(' | ') : 'rode inteira em cooldown (60s)'),
    );
  }

  private nextAfter(id: string): string | null {
    const idx = this.providers.findIndex((p) => p.id === id);
    for (let i = idx + 1; i < this.providers.length; i++) {
      if (!this.inCooldown(this.providers[i].id)) return this.providers[i].id;
    }
    return null;
  }

  private inCooldown(id: string): boolean {
    return (this.cooldownUntil.get(id) ?? 0) > this.now();
  }

  private async callProvider(
    provider: RodaProvider,
    key: string | undefined,
    request: TurnRequest,
  ): Promise<TurnResult> {
    const started = this.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'user', content: request.prompt }],
          temperature: this.temperature,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new KimiAdapterError(`${provider.id}: timeout após ${Math.round(this.timeoutMs / 1000)}s`, err);
      }
      throw new KimiAdapterError(`${provider.id}: inacessível (rede/DNS)`, err);
    }
    clearTimeout(timer);

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new KimiAdapterError(`${provider.id}: HTTP ${res.status} ${detail}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new KimiAdapterError(`${provider.id}: resposta sem choices[0].message.content`);
    }
    return {
      reply_text: content,
      session_id: `roda:${request.session_key}`,
      duration_ms: this.now() - started,
      model: provider.model,
      usage: data.usage
        ? {
            input_tokens: data.usage.prompt_tokens ?? 0,
            output_tokens: data.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }

  async readMessages(_sessionKey: string, _afterSeq?: number): Promise<unknown[]> {
    return [];
  }
}
