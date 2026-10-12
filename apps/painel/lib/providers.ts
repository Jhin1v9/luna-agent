// ============================================================================
// PROVIDERS DE LLM — config/providers.json na raiz do repo (REPO_ROOT)
// Gravação atômica (tmp + rename, mesmo padrão do setEnvKey).
// Regra inegociável: a API key NUNCA entra no json — só o NOME da env var.
// Validação manual fail-closed (sem zod neste pacote): tipos, ids únicos,
// campos desconhecidos rejeitados, allowlist de envs de key.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, envAll } from './store';

export type Transport = 'openai' | 'anthropic' | 'fcc-local';

export interface ProviderEntry {
  id: string;
  label: string;
  transport: Transport;
  baseUrl: string;
  apiKeyEnv: string | null;
  model: string;
  models: string[];
  enabled: boolean;
  priority: number;
  builtin: boolean;
}

export interface ProvidersConfig {
  fastBrain: string;
  liveBrain: string;
  providers: ProviderEntry[];
}

export interface KeyStatus { configured: boolean; preview: string | null }
export type ProviderWithStatus = ProviderEntry & { keyStatus: KeyStatus };

const CONFIG_DIR = path.join(REPO_ROOT, 'config');
const PROVIDERS_FILE = path.join(CONFIG_DIR, 'providers.json');
const REPO_ENV = path.join(REPO_ROOT, '.env');

// Allowlist explícita: só estas envs podem receber key via painel (fail-closed)
export const KEY_ALLOWLIST = [
  'KIMI_API_KEY', 'KIMI_API_KEY_2', 'NVIDIA_API_KEY', 'NVIDIA_API_KEY_2',
  'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY',
  'OPENWEBUI_API_KEY', 'GITHUB_API_KEY', 'CEREBRAS_API_KEY', 'SAMBANOVA_API_KEY',
  'MISTRAL_API_KEY', 'TOGETHER_API_KEY', 'ZAI_API_KEY',
];

const TRANSPORTS: Transport[] = ['openai', 'anthropic', 'fcc-local'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const FCC_BASE = 'http://127.0.0.1:8082';

// Defaults (perfil por cérebro, decreto owner): corrente "roda infinita" —
// conversacionais grátis primeiro (rotação quando a quota acaba), coding fica
// desabilitado (uso do luna-kernel, fora do escopo desta página).
const DEFAULT_CONFIG: ProvidersConfig = {
  fastBrain: 'groq',
  liveBrain: 'fcc-local',
  providers: [
    {
      id: 'groq', label: 'Groq (conversacional)', transport: 'openai',
      baseUrl: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY',
      model: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile'],
      enabled: true, priority: 1, builtin: true,
    },
    {
      id: 'gemini', label: 'Gemini (conversacional)', transport: 'openai',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', apiKeyEnv: 'GEMINI_API_KEY',
      model: 'gemini-3.6-flash', models: ['gemini-3.6-flash'],
      enabled: true, priority: 2, builtin: true,
    },
    {
      id: 'openrouter', label: 'OpenRouter DeepSeek (conversacional · grátis)', transport: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY',
      model: 'deepseek/deepseek-chat-v3-0324:free', models: ['deepseek/deepseek-chat-v3-0324:free'],
      enabled: true, priority: 3, builtin: true,
    },
    {
      id: 'xai', label: 'xAI Grok 4.5 (conversacional)', transport: 'openai',
      baseUrl: 'https://api.x.ai/v1', apiKeyEnv: 'XAI_API_KEY',
      model: 'grok-4.5', models: ['grok-4.5', 'grok-3', 'grok-3-mini'],
      enabled: true, priority: 4, builtin: true,
    },
    {
      id: 'fcc-local', label: 'FCC (local · rota LIVE)', transport: 'fcc-local',
      baseUrl: FCC_BASE, apiKeyEnv: null, model: 'auto', models: [],
      enabled: true, priority: 5, builtin: true,
    },
    {
      id: 'kimi-coding', label: 'Kimi for Coding (kernel)', transport: 'openai',
      baseUrl: 'https://api.kimi.com/coding/v1', apiKeyEnv: 'KIMI_API_KEY',
      model: 'kimi-for-coding', models: ['kimi-for-coding', 'k3', 'k3-256k', 'kimi-k2.6'],
      enabled: false, priority: 6, builtin: true,
    },
    {
      id: 'nvidia-nim', label: 'NVIDIA NIM kimi-k3 (kernel)', transport: 'openai',
      baseUrl: 'https://integrate.api.nvidia.com/v1', apiKeyEnv: 'NVIDIA_API_KEY',
      model: 'moonshotai/kimi-k3',
      models: ['moonshotai/kimi-k3', 'deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3', 'nvidia/nemotron-3-super-120b-a12b'],
      enabled: false, priority: 7, builtin: true,
    },
    {
      id: 'colibri-local', label: 'Colibri (local)', transport: 'openai',
      baseUrl: 'http://127.0.0.1:8000/v1', apiKeyEnv: null,
      model: 'qwen3-coder-30b-a3b-colibri', models: ['qwen3-coder-30b-a3b-colibri'],
      enabled: false, priority: 99, builtin: true,
    },
  ],
};

// Presets do dropdown "Adicionar provider" (builtin:false, removíveis)
export const PRESETS: ProviderEntry[] = [
  {
    id: 'pollinations', label: 'Pollinations (grátis, sem key)', transport: 'openai',
    baseUrl: 'https://text.pollinations.ai/openai', apiKeyEnv: null,
    model: 'openai', models: ['openai', 'mistral', 'llama', 'deepseek'],
    enabled: true, priority: 99, builtin: false,
  },
  {
    id: 'open-webui', label: 'Open WebUI (local)', transport: 'openai',
    baseUrl: 'http://127.0.0.1:3000/api/v1', apiKeyEnv: 'OPENWEBUI_API_KEY',
    model: 'auto', models: [],
    enabled: false, priority: 99, builtin: false,
  },
  {
    id: 'nvidia-nim', label: 'NVIDIA NIM', transport: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1', apiKeyEnv: 'NVIDIA_API_KEY',
    model: 'moonshotai/kimi-k3',
    models: ['moonshotai/kimi-k3', 'deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3', 'nvidia/nemotron-3-super-120b-a12b'],
    enabled: true, priority: 99, builtin: false,
  },
  {
    id: 'groq', label: 'Groq', transport: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY',
    model: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile'],
    enabled: true, priority: 99, builtin: false,
  },
  {
    id: 'gemini', label: 'Gemini (Google)', transport: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', apiKeyEnv: 'GEMINI_API_KEY',
    model: 'gemini-3.6-flash', models: ['gemini-3.6-flash'],
    enabled: true, priority: 99, builtin: false,
  },
  {
    id: 'openrouter', label: 'OpenRouter', transport: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY',
    model: 'deepseek/deepseek-chat-v3-0324:free', models: ['deepseek/deepseek-chat-v3-0324:free'],
    enabled: true, priority: 99, builtin: false,
  },
  {
    id: 'xai', label: 'xAI (Grok 4.5)', transport: 'openai',
    baseUrl: 'https://api.x.ai/v1', apiKeyEnv: 'XAI_API_KEY',
    model: 'grok-4.5', models: ['grok-4.5', 'grok-3', 'grok-3-mini'],
    enabled: true, priority: 99, builtin: false,
  },
  {
    id: 'deepseek', label: 'DeepSeek', transport: 'openai',
    baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY',
    model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'],
    enabled: true, priority: 99, builtin: false,
  },
  {
    id: 'kimi-api', label: 'Kimi API (platform)', transport: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1', apiKeyEnv: 'KIMI_API_KEY_2',
    model: 'kimi-k2-0905-preview', models: ['kimi-k2-0905-preview', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    enabled: true, priority: 99, builtin: false,
  },
  {
    id: 'colibri-local', label: 'Colibri (local)', transport: 'openai',
    baseUrl: 'http://127.0.0.1:8000/v1', apiKeyEnv: null,
    model: 'qwen3-coder-30b-a3b-colibri', models: ['qwen3-coder-30b-a3b-colibri'],
    enabled: true, priority: 99, builtin: false,
  },
  {
    id: 'luna-kernel', label: 'Luna Kernel (local, coding)', transport: 'openai',
    baseUrl: 'http://127.0.0.1:3458/v1', apiKeyEnv: null,
    model: 'kimi-for-coding', models: ['kimi-for-coding', 'k3'],
    enabled: false, priority: 98, builtin: false,
  },
  {
    id: 'github-models', label: 'GitHub Models (grátis)', transport: 'openai',
    baseUrl: 'https://models.github.ai/inference', apiKeyEnv: 'GITHUB_API_KEY',
    model: 'openai/gpt-4o',
    models: ['openai/gpt-4o', 'openai/gpt-4o-mini', 'meta/Llama-3.3-70B-Instruct'],
    enabled: true, priority: 99, builtin: false,
  },
  {
    id: 'cerebras', label: 'Cerebras (free tier)', transport: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1', apiKeyEnv: 'CEREBRAS_API_KEY',
    model: 'llama-3.3-70b', models: ['llama-3.3-70b', 'llama-3.1-8b'],
    enabled: false, priority: 99, builtin: false,
  },
  {
    id: 'sambanova', label: 'SambaNova (free)', transport: 'openai',
    baseUrl: 'https://api.sambanova.ai/v1', apiKeyEnv: 'SAMBANOVA_API_KEY',
    model: 'Meta-Llama-3.3-70B-Instruct', models: ['Meta-Llama-3.3-70B-Instruct', 'Meta-Llama-3.1-8B-Instruct'],
    enabled: false, priority: 99, builtin: false,
  },
  {
    id: 'mistral', label: 'Mistral (free tier)', transport: 'openai',
    baseUrl: 'https://api.mistral.ai/v1', apiKeyEnv: 'MISTRAL_API_KEY',
    model: 'mistral-small-latest', models: ['mistral-small-latest', 'devstral-small-latest', 'codestral-latest'],
    enabled: false, priority: 99, builtin: false,
  },
  {
    id: 'together', label: 'Together AI (créditos)', transport: 'openai',
    baseUrl: 'https://api.together.xyz/v1', apiKeyEnv: 'TOGETHER_API_KEY',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free'],
    enabled: false, priority: 99, builtin: false,
  },
  {
    id: 'zai-glm', label: 'Z.ai GLM (free tier)', transport: 'openai',
    baseUrl: 'https://api.z.ai/api/coding/paas/v1', apiKeyEnv: 'ZAI_API_KEY',
    model: 'glm-4.6', models: ['glm-4.6', 'glm-4.5-flash'],
    enabled: false, priority: 99, builtin: false,
  },
  {
    id: 'fcc-local', label: 'FCC (local)', transport: 'fcc-local',
    baseUrl: FCC_BASE, apiKeyEnv: null, model: 'auto', models: [],
    enabled: true, priority: 99, builtin: false,
  },
];

// ---------------------------------------------------------------------------
// Validação manual fail-closed
// ---------------------------------------------------------------------------
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, campo: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${campo} deve ser string nao-vazia`);
  return v.trim();
}

function strOrNull(v: unknown, campo: string): string | null {
  if (v === null) return null;
  return str(v, campo);
}

export function validateProviderEntry(raw: unknown): ProviderEntry {
  if (!isObj(raw)) throw new Error('provider deve ser um objeto');
  for (const k of Object.keys(raw)) {
    if (!['id', 'label', 'transport', 'baseUrl', 'apiKeyEnv', 'model', 'models', 'enabled', 'priority', 'builtin'].includes(k)) {
      throw new Error(`campo desconhecido no provider: ${k}`);
    }
  }
  const id = str(raw.id, 'id');
  if (!SLUG_RE.test(id)) throw new Error(`id invalido (slug a-z 0-9 -): ${id}`);
  const transport = str(raw.transport, 'transport');
  if (!TRANSPORTS.includes(transport as Transport)) throw new Error(`transport invalido: ${transport}`);
  if (typeof raw.enabled !== 'boolean') throw new Error('enabled deve ser boolean');
  if (typeof raw.builtin !== 'boolean') throw new Error('builtin deve ser boolean');
  if (typeof raw.priority !== 'number' || !Number.isFinite(raw.priority)) throw new Error('priority deve ser numero');
  if (!Array.isArray(raw.models) || raw.models.some((m) => typeof m !== 'string')) throw new Error('models deve ser string[]');
  const apiKeyEnv = strOrNull(raw.apiKeyEnv, 'apiKeyEnv');
  if (apiKeyEnv && !/^[A-Z0-9_]+$/.test(apiKeyEnv)) throw new Error(`apiKeyEnv invalido: ${apiKeyEnv}`);
  const baseUrl = str(raw.baseUrl, 'baseUrl');
  if (!/^https?:\/\//.test(baseUrl)) throw new Error(`baseUrl invalida: ${baseUrl}`);
  return {
    id, label: str(raw.label, 'label'), transport: transport as Transport, baseUrl,
    apiKeyEnv, model: typeof raw.model === 'string' ? raw.model : '',
    models: raw.models as string[], enabled: raw.enabled, priority: raw.priority, builtin: raw.builtin,
  };
}

export function validateProvidersConfig(raw: unknown): ProvidersConfig {
  if (!isObj(raw)) throw new Error('config deve ser um objeto');
  for (const k of Object.keys(raw)) {
    if (!['fastBrain', 'liveBrain', 'providers'].includes(k)) throw new Error(`campo desconhecido: ${k}`);
  }
  const fastBrain = str(raw.fastBrain, 'fastBrain');
  const liveBrain = str(raw.liveBrain, 'liveBrain');
  if (!Array.isArray(raw.providers) || raw.providers.length === 0) throw new Error('providers deve ser array nao-vazio');
  const providers = raw.providers.map(validateProviderEntry);
  const ids = new Set<string>();
  for (const p of providers) {
    if (ids.has(p.id)) throw new Error(`id duplicado: ${p.id}`);
    ids.add(p.id);
  }
  return { fastBrain, liveBrain, providers };
}

// ---------------------------------------------------------------------------
// Leitura / gravação atômica
// ---------------------------------------------------------------------------
function writeAtomic(file: string, content: string): void {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function getProvidersConfig(): ProvidersConfig {
  if (!fs.existsSync(PROVIDERS_FILE)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    writeAtomic(PROVIDERS_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    return DEFAULT_CONFIG;
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf8'));
  return validateProvidersConfig(parsed);
}

// Reconcilia builtin server-side: flag builtin NUNCA vem do cliente —
// preserva a do estado atual (por id); provider novo entra como builtin:false.
export function saveProvidersConfig(raw: unknown): ProvidersConfig {
  const cfg = validateProvidersConfig(raw);
  let current: ProvidersConfig | null = null;
  try { current = getProvidersConfig(); } catch { /* arquivo ausente/corrompido — segue com o enviado */ }
  if (current) {
    const builtinById = new Map(current.providers.map((p) => [p.id, p.builtin]));
    cfg.providers = cfg.providers.map((p) => ({ ...p, builtin: builtinById.get(p.id) ?? false }));
  } else {
    cfg.providers = cfg.providers.map((p) => ({ ...p, builtin: false }));
  }
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  writeAtomic(PROVIDERS_FILE, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}

// ---------------------------------------------------------------------------
// Status da key (presença + preview mascarado — nunca a key completa)
// ---------------------------------------------------------------------------
function keyStatusOf(envName: string | null): KeyStatus {
  if (!envName) return { configured: true, preview: null }; // local sem key
  const v = envAll()[envName];
  if (!v) return { configured: false, preview: null };
  const preview = v.length > 12 ? `${v.slice(0, 6)}•••${v.slice(-4)}` : '••••••';
  return { configured: true, preview };
}

export function getProvidersWithStatus(): ProvidersConfig & { providers: ProviderWithStatus[] } {
  const cfg = getProvidersConfig();
  return {
    ...cfg,
    providers: cfg.providers.map((p) => ({ ...p, keyStatus: keyStatusOf(p.apiKeyEnv) })),
  };
}

// ---------------------------------------------------------------------------
// Gravação de key no .env — allowlist fail-closed, tmp+rename, sem retornar valor
// ---------------------------------------------------------------------------
export function setProviderKey(envName: string, value: string): { ok: boolean; error?: string } {
  if (!KEY_ALLOWLIST.includes(envName)) return { ok: false, error: `env fora da allowlist: ${envName}` };
  if (typeof value !== 'string' || value.length < 8 || value.length > 500 || /[\r\n]/.test(value)) {
    return { ok: false, error: 'valor invalido (8-500 chars, sem quebra de linha)' };
  }
  const lines = fs.existsSync(REPO_ENV) ? fs.readFileSync(REPO_ENV, 'utf8').split(/\r?\n/) : [];
  const idx = lines.findIndex((l) => l.trim().startsWith(`${envName}=`));
  if (idx >= 0) lines[idx] = `${envName}=${value}`;
  else lines.push(`${envName}=${value}`);
  writeAtomic(REPO_ENV, lines.join('\n'));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Adicionar / remover provider
// ---------------------------------------------------------------------------
export function addPresetProvider(presetId: string): { ok: boolean; error?: string; id?: string } {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return { ok: false, error: `preset desconhecido: ${presetId}` };
  const cfg = getProvidersConfig();
  if (cfg.providers.some((p) => p.id === preset.id)) return { ok: false, error: `provider ja existe: ${preset.id}` };
  cfg.providers.push({ ...preset });
  saveProvidersConfig(cfg);
  return { ok: true, id: preset.id };
}

export function addCustomProvider(raw: unknown): { ok: boolean; error?: string; id?: string } {
  const entry = validateProviderEntry(raw);
  const cfg = getProvidersConfig();
  if (cfg.providers.some((p) => p.id === entry.id)) return { ok: false, error: `provider ja existe: ${entry.id}` };
  cfg.providers.push({ ...entry, builtin: false });
  saveProvidersConfig(cfg);
  return { ok: true, id: entry.id };
}

export function removeProvider(id: string): { ok: boolean; error?: string } {
  const cfg = getProvidersConfig();
  const p = cfg.providers.find((x) => x.id === id);
  if (!p) return { ok: false, error: 'provider nao encontrado' };
  if (p.builtin) return { ok: false, error: 'provider embutido (builtin) nao pode ser removido' };
  if (cfg.fastBrain === id || cfg.liveBrain === id) return { ok: false, error: 'provider em uso por um dos cerebros' };
  cfg.providers = cfg.providers.filter((x) => x.id !== id);
  saveProvidersConfig(cfg);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Catálogo ao vivo de modelos do FCC (falha silenciosa -> lista vazia)
// ---------------------------------------------------------------------------
export async function getFccModels(): Promise<string[]> {
  try {
    const r = await fetch(`${FCC_BASE}/admin/api/models`, { signal: AbortSignal.timeout(3_000) });
    if (!r.ok) return [];
    const d: unknown = await r.json().catch(() => null);
    const list = Array.isArray(d) ? d
      : isObj(d) && Array.isArray(d.data) ? d.data
      : isObj(d) && Array.isArray(d.models) ? d.models
      : [];
    return list
      .map((m) => String(typeof m === 'string' ? m : (isObj(m) ? (m.id ?? m.name ?? '') : '')))
      .filter(Boolean)
      .slice(0, 200);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Teste de 1 chamada mínima (max_tokens 8) — nunca vaza a key no detail
// ---------------------------------------------------------------------------
function scrub(text: string, key: string | null): string {
  let out = text;
  if (key) out = out.split(key).join('•••');
  return out.slice(0, 140);
}

export async function testProvider(providerId: string): Promise<{ ok: boolean; detail: string; latencyMs: number }> {
  const started = Date.now();
  const lat = () => Date.now() - started;
  let cfg: ProvidersConfig;
  try { cfg = getProvidersConfig(); } catch (e) { return { ok: false, detail: scrub((e as Error).message, null), latencyMs: lat() }; }
  const p = cfg.providers.find((x) => x.id === providerId);
  if (!p) return { ok: false, detail: 'provider nao encontrado', latencyMs: lat() };
  const key = p.apiKeyEnv ? (envAll()[p.apiKeyEnv] ?? null) : null;
  if (p.apiKeyEnv && !key) return { ok: false, detail: `key ${p.apiKeyEnv} ausente no .env`, latencyMs: lat() };
  const model = p.model || p.models[0] || '';
  const prompt = 'Responda apenas: ok';

  try {
    if (p.transport === 'openai') {
      const r = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key ?? ''}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 8 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (j as { error?: { message?: string } }).error?.message ?? `HTTP ${r.status}`;
        return { ok: false, detail: scrub(String(msg), key), latencyMs: lat() };
      }
      const content = (j as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
      return { ok: true, detail: `respondeu: ${String(content ?? '(vazio)').slice(0, 40)}`, latencyMs: lat() };
    }
    // anthropic e fcc-local: API de messages
    const url = p.transport === 'fcc-local' ? `${FCC_BASE}/v1/messages` : `${p.baseUrl.replace(/\/$/, '')}/v1/messages`;
    const r = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'content-type': 'application/json',
        'x-api-key': key ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: prompt }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j as { error?: { message?: string } }).error?.message ?? `HTTP ${r.status}`;
      return { ok: false, detail: scrub(String(msg), key), latencyMs: lat() };
    }
    const content = (j as { content?: { text?: string }[] }).content?.[0]?.text;
    return { ok: true, detail: `respondeu: ${String(content ?? '(vazio)').slice(0, 40)}`, latencyMs: lat() };
  } catch (e) {
    return { ok: false, detail: scrub((e as Error).message, key), latencyMs: lat() };
  }
}
