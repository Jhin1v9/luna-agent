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
  // oficial (§7.2, ADR-016); gemini = fast brain INTERINO para teste (ADR-018);
  // kimiwork = a Luna do Kimi Work como cérebro (ADR-040, decreto owner
  // 2026-09-24) — turnos na fila kimiwork_llm_turns, resposta na varredura;
  // roda = fast brain na roda de providers do painel (ADR-041, opt-in);
  // fcc = live brain no gateway FCC local (ADR-041).
  KIMI_ADAPTER_MODE: z.enum(['mock', 'kimi-web', 'kimi-api', 'gemini', 'kimiwork', 'roda', 'fcc', 'pi']).default('mock'),
  KIMIWORK_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  KIMIWORK_LLM_POLL_MS: z.coerce.number().int().positive().default(2_500),
  KIMI_WEB_URL: z.string().url().default('http://127.0.0.1:58627'),
  KIMI_WEB_TOKEN: z.string().optional(),
  KIMI_API_KEY: z.string().optional(),
  KIMI_API_BASE_URL: z.string().url().default('https://api.moonshot.ai/v1'),
  KIMI_API_MODEL: z.string().default('kimi-k2-0905-preview'),
  // LLM_* — contrato Model Router §9: trocar de provider = só trocar o .env.
  // Decreto do owner: modelo SEMPRE o mais barato; NUNCA 2.7, NUNCA K3 (ADR-019).
  LLM_PROVIDER: z.enum(['kimi', 'gemini', 'roda']).default('kimi'),
  LLM_BASE_URL: z.string().url().default('https://api.moonshot.ai/v1'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('kimi-k2.6'),
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
  WHATSAPP_DEBOUNCE_MS: z.coerce.number().int().positive().default(3000),
  // Telegram fallback vivo (§15): sessão WhatsApp caiu → msg ao time.
  // TELEGRAM_CHAT_ID (novo nome) ou TELEGRAM_TEAM_CHAT_ID (legado).
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_TEAM_CHAT_ID: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // ── P2/P3 — Ponte FAST↔LIVE (ADR-033): investigação HANDOFF_LIVE e
  // canal admin rodam o kimi CLI headless. Budget de rondas, timeout de
  // parede e autonomia do processo (-y yolo | --auto).
  INVESTIGATE_BUDGET_ROUNDS: z.coerce.number().int().positive().default(3),
  INVESTIGATE_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  LIVE_AUTONOMY: z.enum(['none', 'yolo', 'auto']).default('yolo'),
  // ── BLOCO 2 (ADR-039) — Cérebro Vivo RESERVA: pi-coding-agent (MIT).
  // 'kimi' = Kimi CLI (default, primário); 'pi' = reserva quando o Kimi CLI
  // está sem quota; 'kimiwork' = a Luna do Kimi Work assume o live brain
  // inteiro (ADR-040, decreto owner 2026-09-24). Troca = só .env, zero
  // código (mesma interface estável).
  LIVE_BRAIN_PROVIDER: z.enum(['kimi', 'pi', 'kimiwork', 'kimi-web-local', 'fcc']).default('kimi'),
  // FCC (ADR-041) — gateway local Anthropic-style (rota LIVE).
  FCC_BASE_URL: z.string().default('http://127.0.0.1:8082'),
  FCC_MODEL: z.string().default('nvidia_nim/moonshotai/kimi-k3'),
  KIMIWEB_LOCAL_URL: z.string().default('http://127.0.0.1:58629'),
  KIMIWEB_LOCAL_TOKEN: z.string().default(''),
  KIMIWEB_SESSION_ID: z.string().default(''),
  PI_BIN: z.string().default('pi'),
  PI_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  PI_ENTRY: z.string().optional(), // override do caminho do cli.js do pi
  // F6 — Pré-voo do Operador (ADR-036): espera da confirmação de atividade
  // antes de discar (ordem invertida — nunca ligar com operador frio).
  OPERATOR_PREFLIGHT_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  // P3 — Canal admin: whitelist de user_ids do Telegram (vírgula) e
  // confirmação inline para ações destrutivas/irreversíveis.
  ADMIN_TELEGRAM_IDS: z.string().default(''),
  ADMIN_CONFIRM_DESTRUCTIVE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  // ── F2 — Canais de notificação (§22). Fail-closed: sem credencial o
  // canal falha EXPLICITAMENTE na delivery; o boot loga a capability.
  SMTP_URL: z.string().optional(),           // smtp://user:pass@host:587
  SMTP_FROM: z.string().default('Luna <luna@nexo-digital.local>'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:luna@nexo-digital.local'),

  // ── F2 — Endpoint do workspace (BLOCO 5): token de serviço (Bearer).
  // Sem token configurado o endpoint fica 503 (fail-closed explícito).
  WORKSPACE_SERVICE_TOKEN: z.string().optional(),

  // ── Tools da VPS Nexo (docs/tools/nexo-api-catalog.md) — LEITURA apenas.
  // Credenciais SÓ via env (nunca commit; pino mascara). Sem credencial a
  // tool falha explicitamente (fail-closed).
  NEXO_API_BASE_URL: z.string().url().default('https://vps.nexo-digital.app'),
  NEXO_API_USERNAME: z.string().optional(),
  NEXO_API_PASSWORD: z.string().optional(),

  // ── F7/BLOCO 4 — auto-heal com diagnóstico por IA (ADR-031). OFF por
  // default: com ON, serviço próprio DOWN sem plano → FAST diagnostica e
  // propõe patch → executa dentro do runHeal (gate de testes + LKG + rollback).
  AUTOHEAL_LLM_PATCH: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Reaper: locks 'running' travados há mais que isso voltam para a fila.
  LOCK_REAPER_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  // Anti-ban (ADR-004): espera humana antes de entregar a resposta no
  // WhatsApp — "responde como gente". Decreto owner: 3-4s (era 6-9s) +
  // typing delay curto no sendMessage.
  HUMAN_RESPONSE_DELAY_MS: z.coerce.number().int().min(0).default(3500),
  // GUARDRAIL DE CÓDIGO (decreto do owner): fora de produção, SÓ estes
  // contatos (nome ou jid, separados por vírgula) podem receber mensagem da
  // Luna. Lista VAZIA em dev = recusa TUDO (fail-closed). Em produção a
  // allowlist de teste não se aplica (ADR-020).
  WHATSAPP_OUTBOUND_ALLOWLIST: z.string().default(''),
  // ESCOPO DE INGESTÃO (decreto do owner, ADR-020): o watcher SÓ processa
  // conversas desta lista — fora do escopo é ignorado SEM abrir o chat e SEM
  // gastar tokens (nem Context Builder, nem LLM). Vazia em dev = nada
  // processado (fail-closed).
  WHATSAPP_INGEST_ALLOWLIST: z.string().default(''),
  // Sweep periódico das conversas allowlisted (decreto owner 2026-09-24):
  // o agente NÃO fica abrindo chats sozinho em loop — quem orquestra é a
  // Luna. Sweep só para teste manual do owner: 'true' liga, qualquer outro
  // valor (default) mantém desligado. O ingest normal (badge/DOM-mutação)
  // não depende dele.
  WHATSAPP_SWEEP_ENABLED: z.string().default('false'),
  // Reconciler de não-lidas (decreto owner 03/10/2026 "a cada not, responde
  // SEMPRE"): de quanto em quanto tempo o watcher relê a lista e ingere
  // chats allowlisted com badge de não-lida — rede de segurança do caminho
  // por diff de preview. 0 desliga. Default 60s.
  WHATSAPP_RECONCILE_MS: z.coerce.number().int().min(0).default(60_000),
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
