import type { Sql } from '@luna/database';
import type { FastTool, ToolContext, ToolResult } from './tools.js';

/**
 * Ponte Luna Web (decreto owner 15/10): o FAST passa a enxergar o MESMO
 * catálogo de tools da Luna Web (kernel :3458). Quando a Luna lista as tools
 * (listTools), ela vê o índice completo do kernel — e executa qualquer tool
 * business (dashboard/workspace/whatsapp/brain) PELO MESMO NOME, via proxy
 * HTTP autenticado. Ferramentas de máquina (arquivos/shell/git) continuam
 * exclusivas da Luna Web — shell pela API do WhatsApp é vetado.
 *
 * Auth: Bearer LUNA_KERNEL_TOKEN (= INTERNAL_API_TOKEN do kernel). Sem
 * token: tool falha EXPLÍCITA (fail-closed), nunca silêncio.
 */

export interface LunaWebBridgeConfig {
  baseUrl: string; // env LUNA_KERNEL_URL, default http://127.0.0.1:3458
  token?: string;  // env LUNA_KERNEL_TOKEN
}

interface CatalogResponse {
  ok: boolean;
  index?: string;
  executable?: string[];
  executableCount?: number;
  error?: string;
}

interface ExecResponse {
  ok: boolean;
  tool?: string;
  result?: { success?: boolean; stdout?: string; error?: string } & Record<string, unknown>;
  error?: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const CATALOG_TTL_MS = 5 * 60_000; // catálogo muda só com deploy do kernel

const ok = (data: unknown): ToolResult => ({ ok: true, data });
const fail = (error: string): ToolResult => ({ ok: false, data: null, error });

class LunaWebBridge {
  private catalogCache: { at: number; index: string; executable: string[] } | null = null;

  constructor(
    private readonly cfg: LunaWebBridgeConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private headers(): Record<string, string> {
    if (!this.cfg.token) {
      throw new Error('LUNA_KERNEL_TOKEN ausente no .env — ponte Luna Web desligada (fail-closed)');
    }
    return { authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/json' };
  }

  /** GET /api/luna-web-catalog — o índice idêntico ao que a Luna Web usa. */
  async catalog(force = false): Promise<{ index: string; executable: string[] }> {
    if (!force && this.catalogCache && Date.now() - this.catalogCache.at < CATALOG_TTL_MS) {
      return { index: this.catalogCache.index, executable: this.catalogCache.executable };
    }
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/api/luna-web-catalog`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as CatalogResponse;
    if (!res.ok || !data.ok || !data.index) {
      throw new Error(`catálogo Luna Web indisponível: ${data.error ?? `HTTP ${res.status}`}`);
    }
    this.catalogCache = { at: Date.now(), index: data.index, executable: data.executable ?? [] };
    return { index: data.index, executable: data.executable ?? [] };
  }

  /** POST /api/luna-web-catalog/execute — roda a tool business no kernel. */
  async exec(tool: string, params: Record<string, unknown>): Promise<ToolResult> {
    if (!tool) return fail('informe a tool: lunaWeb.exec {"tool":"dashboardCreateTask","params":{...}}');
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/api/luna-web-catalog/execute`, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ tool, params }),
    });
    const data = (await res.json().catch(() => ({}))) as ExecResponse;
    if (!res.ok || !data.ok) {
      return fail(`${tool}: ${data.error ?? `HTTP ${res.status}`}`);
    }
    const r = data.result ?? {};
    if (r.success === false) return fail(`${tool}: ${r.error ?? 'falhou no kernel'}`);
    return ok(r.stdout ?? r);
  }
}

/** Factory: tools fixas da ponte (catálogo + exec genérico). Os proxies com
 *  os nomes reais do catálogo vêm de registerLunaWebCatalogProxies(). */
export function createLunaWebTools(cfg: LunaWebBridgeConfig): Record<string, FastTool> {
  const bridge = new LunaWebBridge(cfg);
  const tools: Record<string, FastTool> = {
    /** O catálogo completo da Luna Web (mesmo índice do chat web). */
    'lunaWeb.catalog': async () => {
      try {
        const { index, executable } = await bridge.catalog(true);
        return ok({
          catalog: index,
          executableCount: executable.length,
          hint: 'Todas as tools executáveis acima rodam PELO MESMO NOME. Ex.: {"type":"TOOL_CALL","tool":"dashboardListProjects","args":{}}',
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
    /** Execução genérica (fallback quando o proxy de nome não foi registrado). */
    'lunaWeb.exec': async (_db: Sql, _ctx: ToolContext, args: Record<string, unknown>) => {
      const tool = String(args.tool ?? '');
      const params = (args.params ?? {}) as Record<string, unknown>;
      try {
        return await bridge.exec(tool, params);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  };
  return tools;
}

/** Provider pro setLunaWebCatalogProvider(): devolve o índice texto do kernel. */
export function createLunaWebCatalogProvider(cfg: LunaWebBridgeConfig): () => Promise<string> {
  const bridge = new LunaWebBridge(cfg);
  return async () => (await bridge.catalog()).index;
}

/** Registro assíncrono no boot: busca o catálogo do kernel e registra um
 *  proxy pra CADA tool executável — a Luna chama pelo mesmo nome da web.
 *  listTools nativa do FAST fica (é ela que mescla o catálogo no output).
 *  Falha nunca derruba o boot: sem kernel, ficam só lunaWeb.catalog/exec. */
export async function registerLunaWebCatalogProxies(
  cfg: LunaWebBridgeConfig,
  register: (extra: Record<string, FastTool>) => void,
): Promise<number> {
  const bridge = new LunaWebBridge(cfg);
  const { executable } = await bridge.catalog();
  let n = 0;
  for (const name of executable) {
    if (name === 'listTools' || name === 'toolInfo') continue; // meta-tools: FAST tem as próprias
    register({
      [name]: async (_db: Sql, _ctx: ToolContext, args: Record<string, unknown>) => {
        try {
          return await bridge.exec(name, args);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    });
    n++;
  }
  return n;
}
