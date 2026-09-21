import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT: z.coerce.number().int().positive().default(3100),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgres://luna:luna@localhost:5433/luna'),
  RUN_MIGRATIONS_ON_BOOT: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // KimiAdapter (§7.3, ADR-010/015/016/018): mock = dev/testes determinístico
  // (proibido em produção — ADR-016); kimi-web = servidor local 127.0.0.1
  // (sendTurn via WS ainda não mapeado — ADR-015); kimi-api = fast brain
  // oficial (§7.2, ADR-016); gemini = fast brain INTERINO para teste (ADR-018).
  KIMI_ADAPTER_MODE: z.enum(['mock', 'kimi-web', 'kimi-api', 'gemini']).default('mock'),
  KIMI_WEB_URL: z.string().url().default('http://127.0.0.1:58627'),
  KIMI_WEB_TOKEN: z.string().optional(),
  KIMI_API_KEY: z.string().optional(),
  KIMI_API_BASE_URL: z.string().url().default('https://api.moonshot.ai/v1'),
  KIMI_API_MODEL: z.string().default('kimi-k2-0905-preview'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta/openai/'),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  // WhatsPlay (§13): Chrome DEDICADO com user-data-dir próprio — nunca o
  // perfil do Chrome do usuário.
  WHATSAPP_CHROME_PATH: z
    .string()
    .default('C:/Program Files/Google/Chrome/Application/chrome.exe'),
  WHATSAPP_USER_DATA_DIR: z.string().default(''),
  WHATSAPP_HEADLESS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  WHATSAPP_DEBOUNCE_MS: z.coerce.number().int().positive().default(4000),
  // Telegram fallback vivo (§15): sessão WhatsApp caiu → msg ao time.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_TEAM_CHAT_ID: z.string().optional(),
  // Reaper: locks 'running' travados há mais que isso voltam para a fila.
  LOCK_REAPER_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

/** Carrega e valida a config a partir do ambiente. Cacheado por processo. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  cached = envSchema.parse(env);
  return cached;
}

/** Só para testes: reseta o cache. */
export function resetConfigCache(): void {
  cached = null;
}

/**
 * Carrega um arquivo .env simples (KEY=VALUE por linha) para process.env,
 * sem sobrescrever variáveis já definidas. Não expande variáveis.
 * Procura do cwd para cima (apps/<app> acham o .env da raiz do monorepo).
 */
export function loadDotEnv(path?: string): void {
  let envPath = path;
  if (!envPath) {
    let dir = process.cwd();
    for (;;) {
      const candidate = resolve(dir, '.env');
      if (existsSync(candidate)) {
        envPath = candidate;
        break;
      }
      const parent = resolve(dir, '..');
      if (parent === dir) return; // nenhum .env achado — defaults assumem o volante
      dir = parent;
    }
  }
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}
