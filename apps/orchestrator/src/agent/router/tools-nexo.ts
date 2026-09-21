import type { Sql } from '@luna/database';
import type { ToolContext, ToolResult } from './tools.js';

/**
 * Tools da VPS Nexo (catálogo oficial: docs/tools/nexo-api-catalog.md) —
 * LEITURA apenas (§28: finanças/dados do workspace são consulta; regla de
 * ouro §4 intocável). Auth: NEXO_API_USERNAME/NEXO_API_PASSWORD via env —
 * nunca hardcode, pino mascara. Sem credencial: falha EXPLÍCITA por tool.
 */

export interface NexoApiConfig {
  baseUrl: string;           // default https://vps.nexo-digital.app
  username?: string;         // env NEXO_API_USERNAME
  password?: string;         // env NEXO_API_PASSWORD
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class NexoApiClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly config: NexoApiConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async login(): Promise<void> {
    if (!this.config.username || !this.config.password) {
      throw new Error('NEXO_API_USERNAME/NEXO_API_PASSWORD ausentes no .env — tool desligada (fail-closed)');
    }
    const res = await this.fetchImpl(`${this.config.baseUrl}/dashboard/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.config.username, password: this.config.password }),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; token?: string; error?: string };
    if (!res.ok || !data.success || !data.token) {
      throw new Error(`login dashboard falhou: ${data.error ?? `HTTP ${res.status}`}`);
    }
    this.token = data.token;
    // JWT expira em ~8h; renovamos com folga em 6h.
    this.tokenExpiresAt = Date.now() + 6 * 60 * 60_000;
  }

  private async ensureToken(): Promise<string> {
    if (!this.token || Date.now() > this.tokenExpiresAt) await this.login();
    return this.token!;
  }

  /** GET autenticado. Só leitura — escrever exige tool restrita (que não existe). */
  async get<T = unknown>(path: string): Promise<T> {
    const token = await this.ensureToken();
    const res = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      this.token = null; // token expirado: força relogin na próxima
      throw new Error('dashboard 401 — token expirado/revogado');
    }
    if (!res.ok) throw new Error(`dashboard ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

const ok = (data: unknown): ToolResult => ({ ok: true, data });
const fail = (error: string): ToolResult => ({ ok: false, data: null, error });

/** Factory: registry de tools Nexo (leitura) pras FAST_TOOLS do router. */
export function createNexoTools(
  config: NexoApiConfig,
  fetchImpl?: FetchLike,
): Record<string, (db: Sql, ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>> {
  const client = new NexoApiClient(config, fetchImpl);
  const wrap = (fn: () => Promise<unknown>) => async (): Promise<ToolResult> => {
    try {
      return ok(await fn());
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };

  return {
    'nexo.finance.summary': wrap(() => client.get('/dashboard/api/finance/summary')),
    'nexo.clients.list': wrap(() => client.get('/dashboard/api/workspace/clients')),
    'nexo.leads.list': wrap(() => client.get('/dashboard/api/leads')),
    'nexo.tasks.list': wrap(async () => {
      const data = (await client.get<Array<{ title?: string; status?: string; source?: string }>>('/dashboard/api/tasks')) ?? [];
      return data.slice(0, 15).map((t) => ({ title: t.title, status: t.status, source: t.source }));
    }),
    'nexo.cashbox.summary': wrap(() => client.get('/dashboard/api/cash-box')),
    'nexo.expenses.list': wrap(() => client.get('/dashboard/api/expenses')),
    'nexo.payments.list': wrap(() => client.get('/dashboard/api/payments')),
    'nexo.quotes.list': wrap(() => client.get('/dashboard/api/quotes')),
    'nexo.ideas.list': wrap(() => client.get('/dashboard/api/ideas')),
    'nexo.system.status': wrap(() => client.get('/dashboard/api/system/status')),
    'nexo.ops.overview': wrap(() => client.get('/dashboard/api/ops')),
    'nexo.notifications.list': wrap(async () => {
      const data = (await client.get<{ notifications?: unknown[] }>('/dashboard/api/notifications')) ?? {};
      return { notifications: (data.notifications ?? []).slice(0, 10) };
    }),
    'nexo.reports.history': wrap(async () => {
      const data = (await client.get<{ reports?: unknown[] }>('/dashboard/api/reports/history')) ?? {};
      return { reports: (data.reports ?? []).slice(0, 5) };
    }),
  };
}
