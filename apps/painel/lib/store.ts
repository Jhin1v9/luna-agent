// ============================================================================
// STORE REAL — painel da Luna plugado no stack (Postgres / .env / colibri / venus)
// Contratos de retorno idênticos ao mock (são o contrato da API e do frontend).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import pg from 'pg';

export interface Modo { KIMI_ADAPTER_MODE: string; LIVE_BRAIN_PROVIDER: string; VENUS_AUTONOMO: string }
export interface Check { id: string; label: string; ok: boolean; detail: string }
export interface Chat { chat_id: string; label: string; count: number; last_used: string }
export interface Msg {
  id: string; conversation_id: string; chat_id: string; direction: 'inbound' | 'outbound';
  sender: string; body: string; send_state: 'queued' | 'sent' | 'failed'; created_at: string;
}
export interface CtxLine { sender: string; direction: string; body: string; created_at: string }
export interface Servico {
  service: string; pid: number; state: string; seconds_since: number; alive: boolean;
  status: 'vivo' | 'parado'; next_beat_in_s: number; progress: number; interval_s: number;
}
export interface InboxEvent {
  id: string; kind: string; payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'done' | 'error';
  received_at: string; processed_at: string | null; processing_by: string | null;
  result: Record<string, unknown> | null;
}
export interface Turno {
  id: string; session_key: string; prompt: string; channel: 'geral';
  status: 'pending' | 'answered' | 'failed'; response: string | null;
  answered_at: string | null; created_at: string;
}
export interface VenusInfo { status: string; running: boolean; processed_by_venus: number; log: string[] }
// Erros & incidências do Vênus (decreto owner 2026-10-09: "pega o log do venus
// e deixa tudo na parte de erros do painel") — inbox em error + linhas de erro
// dos logs pm2, pra gente trabalhar em cima depois.
export interface VenusIncidencia {
  id: string; kind: string; received_at: string;
  motivo: string | null; por: string | null;
}
export interface VenusErros { incidencias: VenusIncidencia[]; log: string[] }
export interface Ordem {
  id: string; ordem: string; contexto: string | null;
  status: 'pending' | 'processing' | 'done' | 'error' | 'ignored';
  result: string | null; created_at: string; executed_at: string | null;
}
export interface Comando { perguntas: Turno[]; ordens: Ordem[] }
export interface SavedContact { id: string; name: string; chat_id: string; phone_e164: string | null }
export interface AccessEntry extends SavedContact { role: 'owner' | 'allowed' | 'blocked'; note: string | null }

// ---------------------------------------------------------------------------
// Caminhos e .env (raiz do repo = dois níveis acima de apps/painel)
// ---------------------------------------------------------------------------
export const REPO_ROOT = path.resolve(process.cwd(), '..', '..');
const REPO_ENV = path.join(REPO_ROOT, '.env');
const COLIBRI = (process.env.VENUS_BASE_URL ?? 'http://127.0.0.1:8000/v1').replace(/\/$/, '');
const BRAIN_REMOTE = 'https://vps.nexo-digital.app/brain/';
const VENUS_LOG = path.join(os.homedir(), '.pm2', 'logs', 'venus-varredura-out.log');

export const ENV_ALLOWLIST: Record<string, string[]> = {
  KIMI_ADAPTER_MODE: ['mock', 'kimi-web', 'kimi-api', 'kimi-cli', 'kimi-web-local', 'gemini', 'pi', 'kimiwork'],
  LIVE_BRAIN_PROVIDER: ['kimi', 'pi', 'kimiwork', 'kimi-web-local'],
  VENUS_AUTONOMO: ['true', 'false'],
};

const BEAT_INTERVAL_S: Record<string, number> = {
  orchestrator: 30, worker: 30, watchdog: 30, whatsplay: 15, 'venus-varredura': 30,
};
const STALE_S = 90;

export function envAll(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(REPO_ENV)) return out;
  for (const line of fs.readFileSync(REPO_ENV, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i)] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

async function db<T>(query: string, params: unknown[] = []): Promise<T[]> {
  const env = envAll();
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL ausente no .env');
  const c = new pg.Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  try { return (await c.query(query, params as never[])).rows as T[]; }
  finally { await c.end(); }
}

export async function queryDb<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return db<T>(query, params);
}

// ---------------------------------------------------------------------------
// CONTATOS — Chat Registry é a fonte de autorização do WhatsApp
// ---------------------------------------------------------------------------
export async function getContacts(): Promise<{ contacts: SavedContact[] }> {
  const contacts = await db<SavedContact>(
    `SELECT id::text, canonical_name AS name, chat_key AS chat_id, phone_e164
       FROM chat_registry
      WHERE kind='individual' AND role IN ('allowed', 'owner')
      ORDER BY lower(canonical_name)`,
  );
  return { contacts };
}

export async function saveContact(input: { name: string; chat_id: string }): Promise<{ ok: boolean; contact?: SavedContact; error?: string }> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  const digits = input.chat_id.replace(/\D/g, '');
  if (name.length < 2) return { ok: false, error: 'nome precisa ter ao menos 2 caracteres' };
  if (digits.length < 8 || digits.length > 15) return { ok: false, error: 'número inválido: informe DDI + número' };

  const env = envAll();
  if (!env.DATABASE_URL) return { ok: false, error: 'DATABASE_URL ausente no .env' };

  // v15: org e prefixo configuráveis via .env — default da PROPRIA identidade
  // (decreto owner 15/10: infos internas ficam em cada repo).
  const orgName = process.env.LUNA_PANEL_ORG?.trim() || 'Superclim';
  const orgSlug = process.env.LUNA_PANEL_ORG_SLUG?.trim() || 'superclim';
  const clientPrefix = process.env.LUNA_PANEL_CLIENT_PREFIX?.trim() || 'sc';

  const c = new pg.Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    const org = await c.query<{ id: string }>(
      `INSERT INTO organizations (name, slug)

       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, updated_at=now()
       RETURNING id`,
      [orgName, orgSlug],
    );
    const code = `${clientPrefix}-${digits}`;

    const client = await c.query<{ id: string }>(
      `INSERT INTO clients (organization_id, name, code, status, metadata)
       VALUES ($1, $2, $3, 'active', $4::jsonb)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, status='active', updated_at=now()
       RETURNING id`,
      [org.rows[0]!.id, name, code, JSON.stringify({ source: 'luna_painel' })],
    );
    const contact = await c.query<{ id: string }>(
      `INSERT INTO contacts (client_id, name, channel, address, is_primary, metadata)
       VALUES ($1, $2, 'whatsapp', $3, true, $4::jsonb)
       ON CONFLICT (client_id, channel, address) DO UPDATE
         SET name=EXCLUDED.name, is_primary=true, metadata=contacts.metadata || EXCLUDED.metadata, updated_at=now()
       RETURNING id`,
      [client.rows[0]!.id, name, digits, JSON.stringify({ phone: `+${digits}`, role: 'cliente', source: 'luna_painel' })],
    );
    await c.query(
      `INSERT INTO conversations (client_id, contact_id, channel, state, metadata)
       SELECT $1, $2, 'whatsapp', 'NEW', $3::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM conversations WHERE client_id=$1 AND contact_id=$2 AND channel='whatsapp'
       )`,
      [client.rows[0]!.id, contact.rows[0]!.id, JSON.stringify({ chat_id: digits, chat_name: name, source: 'luna_painel' })],
    );
    const saved = await c.query<SavedContact>(
      `INSERT INTO chat_registry
         (chat_key, kind, canonical_name, display_hint, role, notify_channel, phone_e164, resolved_by, note)
       VALUES ($1, 'individual', $2, $2, 'allowed', $3, $4, 'luna_painel', 'Cadastrado pelo Painel da Luna')
       ON CONFLICT (chat_key, kind) DO UPDATE SET
         canonical_name=EXCLUDED.canonical_name, display_hint=EXCLUDED.display_hint,
         role='allowed', notify_channel=EXCLUDED.notify_channel,
         phone_e164=EXCLUDED.phone_e164, resolved_by='luna_painel',
         note='Atualizado pelo Painel da Luna', updated_at=now()
       RETURNING id::text, canonical_name AS name, chat_key AS chat_id, phone_e164`,
      [digits, name, `whatsapp:+${digits}`, `+${digits}`],
    );
    await c.query('COMMIT');
    return { ok: true, contact: saved.rows[0] };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  } finally {
    await c.end();
  }
}

export async function removeContact(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^\d+$/.test(id)) return { ok: false, error: 'id inválido' };
  const removed = await db<{ id: string }>(
    `DELETE FROM chat_registry WHERE id=$1::bigint AND kind='individual' RETURNING id::text`,
    [id],
  );
  return removed.length ? { ok: true } : { ok: false, error: 'contato não encontrado' };
}

// ---------------------------------------------------------------------------
// MODO / .env — allowlist fail-closed, gravação atômica (tmp + rename)
// ---------------------------------------------------------------------------
export function getModo(): Modo {
  const e = envAll();
  return {
    KIMI_ADAPTER_MODE: e.KIMI_ADAPTER_MODE ?? 'mock',
    LIVE_BRAIN_PROVIDER: e.LIVE_BRAIN_PROVIDER ?? 'kimi',
    VENUS_AUTONOMO: e.VENUS_AUTONOMO ?? 'false',
  };
}

export function setEnvKey(key: string, value: string): { ok: boolean; error?: string; gravado?: Record<string, string> } {
  if (!Object.prototype.hasOwnProperty.call(ENV_ALLOWLIST, key)) {
    return { ok: false, error: `chave fora da allowlist: ${key}` };
  }
  if (!ENV_ALLOWLIST[key].includes(String(value))) {
    return { ok: false, error: `valor nao permitido para ${key}: ${value}` };
  }
  const lines = fs.readFileSync(REPO_ENV, 'utf8').split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  const tmp = REPO_ENV + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n'));
  fs.renameSync(tmp, REPO_ENV); // atômico
  return { ok: true, gravado: { [key]: String(value) } };
}

// ---------------------------------------------------------------------------
// VALIDAÇÃO AO VIVO — colibri / postgres / telegram / brain + presença de keys
// ---------------------------------------------------------------------------
export async function getValidacao(): Promise<Check[]> {
  const e = envAll();
  const checks: Check[] = [];
  try {
    const r = await fetch(`${COLIBRI}/models`, { signal: AbortSignal.timeout(3_000) });
    const d = await r.json().catch(() => ({}));
    checks.push({ id: 'colibri', label: 'Colibri (modelo da Venus)', ok: r.ok, detail: d.data?.[0]?.id ?? `HTTP ${r.status}` });
  } catch {
    checks.push({ id: 'colibri', label: 'Colibri (modelo da Venus)', ok: false, detail: 'colibri fora do ar (127.0.0.1:8000)' });
  }
  try {
    await db('SELECT 1');
    checks.push({ id: 'postgres', label: 'PostgreSQL', ok: true, detail: `SELECT 1 ok — ${e.DATABASE_URL?.split('@')[1]?.split('/')[0] ?? 'ok'}` });
  } catch (err) {
    checks.push({ id: 'postgres', label: 'PostgreSQL', ok: false, detail: (err as Error).message.slice(0, 80) });
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(5_000) });
    const d = await r.json();
    checks.push({ id: 'telegram', label: 'Telegram', ok: !!d.ok, detail: d.ok ? `@${d.result.username}` : 'token invalido' });
  } catch {
    checks.push({ id: 'telegram', label: 'Telegram', ok: false, detail: 'rede/timeout' });
  }
  try {
    const r = await fetch(BRAIN_REMOTE, { signal: AbortSignal.timeout(5_000) });
    checks.push({ id: 'brain', label: 'Brain remoto', ok: r.ok || r.status < 500, detail: `HTTP ${r.status} — vps.nexo-digital.app/brain/` });
  } catch {
    checks.push({ id: 'brain', label: 'Brain remoto', ok: false, detail: 'inacessivel' });
  }
  for (const k of ['DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'BRAIN_API_TOKEN', 'KIMI_API_KEY_2', 'LLM_API_KEY', 'GEMINI_API_KEY']) {
    checks.push({ id: `key:${k}`, label: `Key ${k}`, ok: Boolean(e[k]), detail: e[k] ? 'presente (valor oculto)' : 'AUSENTE no .env' });
  }
  return checks;
}

// ---------------------------------------------------------------------------
// MENSAGENS / CHATS — tabela `messages`; envio = INSERT queued + pg_notify
// ---------------------------------------------------------------------------
const CHAT_LABELS: Record<string, string> = {}; // white-label: preencher com os proprios grupos

export async function getChats(): Promise<Chat[]> {
  const rows = await db<{ chat_id: string; count: number; last_used: string }>(
    `SELECT metadata->>'chat_id' AS chat_id, COUNT(*)::int AS count, MAX(created_at) AS last_used
     FROM messages WHERE direction='outbound' AND metadata->>'chat_id' IS NOT NULL
     GROUP BY 1 ORDER BY last_used DESC LIMIT 20`,
  );
  const chats = rows.map((r) => ({ ...r, label: CHAT_LABELS[r.chat_id] ?? r.chat_id }));
  return chats.sort((a, b) => (a.chat_id === 'productions' ? -1 : b.chat_id === 'productions' ? 1 : 0));
}

interface MsgRow {
  id: string; conversation_id: string; chat_id: string; direction: 'inbound' | 'outbound';
  sender: string; body: string; send_state: 'queued' | 'sent' | 'failed'; created_at: string;
}

export async function getAtividade(limit = 20): Promise<Omit<Msg, 'direction'>[]> {
  const rows = await db<MsgRow>(
    `SELECT id, conversation_id, metadata->>'chat_id' AS chat_id, direction, sender,
            left(body, 500) AS body, send_state, created_at
     FROM messages WHERE direction='outbound' AND sender IN ('luna','agent:venus')
     ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(({ id, conversation_id, chat_id, sender, body, send_state, created_at }) =>
    ({ id, conversation_id, chat_id, sender, body, send_state, created_at }));
}

export async function getContexto(conversation_id: string): Promise<CtxLine[]> {
  const rows = await db<CtxLine>(
    `SELECT sender, direction, left(body, 500) AS body, created_at FROM messages
     WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 8`,
    [conversation_id],
  );
  return rows.reverse();
}

// guard-rail de saída (ativado em QUALQUER envio)
const DEADLINE_RE = /\b(essa semana|este fim de semana|nesta semana|amanh[aã]|hoje ainda|te entrego|te mando|fica pronto|agendamos|at[eé] (hoje|amanh[aã]|sexta|segunda|ter[cç]a|quarta|quinta|domingo)|pra (hoje|amanh[aã])|prazo de \d|em \d+ dias)\b/i;

export async function sendMessage(input: { chat_id: string; body: string; sender: string }):
  Promise<{ ok: boolean; blocked?: boolean; error?: string; id?: string; send_state?: string }> {
  const { body, sender } = input;
  const chat_id = input.chat_id.replace(/\D/g, '');
  if (!chat_id || !body || !['luna', 'agent:venus'].includes(sender)) {
    return { ok: false, error: 'payload invalido' };
  }
  if (body.length > 900) return { ok: false, error: 'texto acima de 900 chars' };
  if (DEADLINE_RE.test(body)) {
    return { ok: false, blocked: true, error: 'guard-rail de prazo: mensagem promete prazo/deadline. Reformule sem prometer data.' };
  }
  const conv = await db<{ conversation_id: string }>(
    `SELECT conversation_id FROM messages WHERE metadata->>'chat_id' = $1 ORDER BY created_at DESC LIMIT 1`,
    [chat_id],
  );
  if (!conv[0]) {
    const registered = await db<{ conversation_id: string }>(
      `SELECT cv.id AS conversation_id
         FROM conversations cv
         JOIN contacts ct ON ct.id=cv.contact_id
        WHERE cv.channel='whatsapp'
          AND (ct.address=$1 OR cv.metadata->>'chat_id'=$1)
        ORDER BY cv.updated_at DESC LIMIT 1`,
      [chat_id],
    );
    if (registered[0]) conv.push(registered[0]);
  }
  if (!conv[0]) {
    // Registros antigos podem existir apenas na allowlist. Materialize a
    // estrutura operacional no primeiro envio, sem liberar números novos.
    const allowed = await db<{ canonical_name: string }>(
      `SELECT canonical_name
         FROM chat_registry
        WHERE kind='individual' AND role='allowed' AND chat_key=$1
        LIMIT 1`,
      [chat_id],
    );
    if (allowed[0]) {
      const materialized = await saveContact({ name: allowed[0].canonical_name, chat_id });
      if (!materialized.ok) return { ok: false, error: materialized.error ?? 'falha ao preparar contato autorizado' };
      const created = await db<{ conversation_id: string }>(
        `SELECT cv.id AS conversation_id
           FROM conversations cv
           JOIN contacts ct ON ct.id=cv.contact_id
          WHERE cv.channel='whatsapp' AND ct.address=$1
          ORDER BY cv.updated_at DESC LIMIT 1`,
        [chat_id],
      );
      if (created[0]) conv.push(created[0]);
    }
  }
  if (!conv[0]) return { ok: false, error: 'conversation_id nao encontrada pra este contato cadastrado' };
  const ins = await db<{ id: string }>(
    `INSERT INTO messages (conversation_id, direction, channel, sender, body, send_state, metadata)
     VALUES ($1, 'outbound', 'whatsapp', $2, $3, 'queued', $4) RETURNING id`,
    [conv[0].conversation_id, sender, body, JSON.stringify({ source: 'painel', chat_id })],
  );
  await db(`SELECT pg_notify('luna_outbound', $1)`, [ins[0].id]);
  return { ok: true, id: ins[0].id, send_state: 'queued' };
}

// ---------------------------------------------------------------------------
// SERVIÇOS — service_heartbeats
// ---------------------------------------------------------------------------
interface BeatRow { service: string; pid: number; meta: { state?: string; overall?: string; ready?: boolean } | null; seen_at: string }

export async function getServicos(): Promise<Servico[]> {
  const rows = await db<BeatRow>('SELECT service, pid, meta, seen_at FROM service_heartbeats ORDER BY service');
  const now = Date.now();
  return rows.map((s) => {
    const seconds_since = Math.max(0, Math.floor((now - new Date(s.seen_at).getTime()) / 1000));
    const interval_s = BEAT_INTERVAL_S[s.service] ?? 30;
    const alive = seconds_since <= STALE_S;
    return {
      service: s.service, pid: s.pid ?? 0,
      state: s.meta?.state ?? s.meta?.overall ?? (s.meta?.ready ? 'READY' : '—'),
      seconds_since, alive, status: alive ? 'vivo' as const : 'parado' as const,
      next_beat_in_s: Math.max(0, interval_s - seconds_since),
      progress: Math.min(1, seconds_since / interval_s),
      interval_s,
    };
  });
}

// ---------------------------------------------------------------------------
// INBOX (kimiwork_inbox) — processamento real do Vênus marca result.processed_by
// ---------------------------------------------------------------------------
interface InboxRow {
  id: string; kind: string; payload: Record<string, unknown>; status: InboxEvent['status'];
  received_at: string; processed_at: string | null; result: Record<string, unknown> | null;
}

export async function getInbox(): Promise<InboxEvent[]> {
  const rows = await db<InboxRow>(
    `SELECT id, kind, payload, status, received_at, processed_at, result
     FROM kimiwork_inbox ORDER BY received_at DESC LIMIT 50`,
  );
  return rows.map((r) => ({
    ...r,
    processing_by: (r.result?.processed_by as string) ?? (r.payload?.processing_by as string) ?? null,
  }));
}

export async function reprocessarInbox(id: string): Promise<{ ok: boolean; error?: string; id?: string }> {
  const rows = await db<{ id: string }>(
    `UPDATE kimiwork_inbox SET status='pending', processed_at=NULL, result=NULL
     WHERE id=$1 AND status IN ('done','error') RETURNING id`,
    [id],
  );
  if (rows[0]) return { ok: true, id };
  const exists = await db<{ status: string }>(`SELECT status FROM kimiwork_inbox WHERE id=$1`, [id]);
  if (!exists[0]) return { ok: false, error: 'evento nao encontrado' };
  return { ok: false, error: `so e permitido reprocessar done/error (atual: ${exists[0].status})` };
}

// Zerar fila (owner 12/10): pendencias antigas acumuladas travam o Vênus.
// Cancela tudo que está pending/processing — os eventos ficam em 'cancelled'
// (fora do claim dele) e podem ser reprocessados manualmente um a um se precisar.
export async function cancelarFilaInbox(): Promise<{ ok: boolean; cancelados: number }> {
  const rows = await db<{ id: string }>(
    `UPDATE kimiwork_inbox SET status='cancelled', processed_at=now(),
       result=COALESCE(result::text,'{}')::jsonb || '{"motivo":"fila cancelada pelo painel (owner)"}'::jsonb
     WHERE status IN ('pending','processing') AND kind IN ('whatsapp.message','telegram.message')
     RETURNING id`,
  );
  return { ok: true, cancelados: rows.length };
}

// ---------------------------------------------------------------------------
// TURNOS (kimiwork_llm_turns) — UPDATE atômico evita corrida
// ---------------------------------------------------------------------------
interface TurnoRow {
  id: string; session_key: string; prompt: string; status: Turno['status'];
  response: string | null; created_at: string; answered_at: string | null;
}

export async function getTurnos(): Promise<Turno[]> {
  const rows = await db<TurnoRow>(
    `SELECT id, session_key, prompt, status, response, created_at, answered_at
     FROM kimiwork_llm_turns ORDER BY created_at DESC LIMIT 50`,
  );
  return rows.map((r) => ({ ...r, channel: 'geral' as const }));
}

export async function responderTurno(id: string, response: string): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!response || !String(response).trim()) return { ok: false, error: 'resposta vazia' };
  const rows = await db<{ id: string }>(
    `UPDATE kimiwork_llm_turns SET status='answered', response=$2, answered_at=now()
     WHERE id=$1 AND status='pending' RETURNING id`,
    [id, String(response).trim()],
  );
  if (rows[0]) return { ok: true, id };
  return { ok: false, error: 'turno ja respondido/falhou ou nao existe (claim perdido)' };
}

export async function escalarInbox(id: string): Promise<{ ok: boolean; error?: string; turno_id?: string }> {
  const ev = await db<InboxRow>(`SELECT * FROM kimiwork_inbox WHERE id=$1`, [id]);
  if (!ev[0]) return { ok: false, error: 'evento nao encontrado' };
  const texto = (ev[0].payload as { from?: string; text?: string }).text ?? JSON.stringify(ev[0].payload);
  const de = (ev[0].payload as { from?: string }).from ?? '?';
  const rows = await db<{ id: string }>(
    `INSERT INTO kimiwork_llm_turns (session_key, prompt, idempotency_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [`inbox:${id}`, `[escalado da inbox ${id} | ${ev[0].kind}] ${de}: ${texto}`, `escalate-${id}`],
  );
  if (rows[0]) return { ok: true, turno_id: rows[0].id };
  return { ok: false, error: 'este evento ja foi escalado' };
}

// ---------------------------------------------------------------------------
// CADEIA DE COMANDO LUNA > VÊNUS (decreto owner 2026-10-09):
//   perguntas = turnos venus:* (ele pergunta → a Luna responde, UPDATE atômico)
//   ordens    = luna_ordens (a Luna ordena → ele executa na varredura, prioridade máxima)
// ---------------------------------------------------------------------------
export async function getComando(): Promise<Comando> {
  const perguntas = await db<TurnoRow>(
    `SELECT id, session_key, prompt, status, response, created_at, answered_at
     FROM kimiwork_llm_turns WHERE session_key LIKE 'venus:%'
     ORDER BY created_at DESC LIMIT 20`,
  );
  const ordens = await db<Ordem>(
    `SELECT id, ordem, contexto, status, result, created_at, executed_at
     FROM luna_ordens ORDER BY created_at DESC LIMIT 20`,
  );
  return { perguntas: perguntas.map((r) => ({ ...r, channel: 'geral' as const })), ordens };
}

export async function criarOrdem(ordem: string, contexto?: string): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!ordem || !String(ordem).trim()) return { ok: false, error: 'ordem vazia' };
  const rows = await db<{ id: string }>(
    `INSERT INTO luna_ordens (ordem, contexto) VALUES ($1, $2) RETURNING id`,
    [String(ordem).trim(), contexto?.trim() ? String(contexto).trim() : null],
  );
  return { ok: true, id: rows[0].id };
}

export async function reprocessarOrdem(id: string): Promise<{ ok: boolean; error?: string; id?: string }> {
  const rows = await db<{ id: string }>(
    `UPDATE luna_ordens SET status='pending', result=NULL, executed_at=NULL
     WHERE id=$1 AND status IN ('done','error','ignored') RETURNING id`,
    [id],
  );
  if (rows[0]) return { ok: true, id };
  const cur = await db<{ status: string }>(`SELECT status FROM luna_ordens WHERE id=$1`, [id]);
  if (!cur[0]) return { ok: false, error: 'ordem nao encontrada' };
  return { ok: false, error: `so e permitido reprocessar done/error/ignored (atual: ${cur[0].status})` };
}

// ---------------------------------------------------------------------------
// VÊNUS — status via heartbeat 'venus-varredura', log via tail do pm2,
// invocar tarefa = spawn real do venus.mjs (process.execPath = node.exe real)
// ---------------------------------------------------------------------------
let tarefaRunning = false;
const tarefaLog: string[] = [];
const ts = () => new Date().toLocaleTimeString('pt-BR', { hour12: false });

function tailVenusLog(): string[] {
  try {
    const lines = fs.readFileSync(VENUS_LOG, 'utf8').trim().split(/\r?\n/);
    return lines.slice(-30);
  } catch {
    return tarefaLog.length ? tarefaLog.slice(-30) : ['(log do pm2 nao encontrado — venus-varredura rodou desde o ultimo restart?)'];
  }
}

export async function getVenus(): Promise<VenusInfo> {
  const beats = await db<{ seen_at: string; meta: { state?: string } | null }>(
    `SELECT seen_at, meta FROM service_heartbeats WHERE service='venus-varredura'`,
  );
  const age = beats[0] ? Math.floor((Date.now() - new Date(beats[0].seen_at).getTime()) / 1000) : null;
  const online = age !== null && age <= STALE_S;
  const processed = await db<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM kimiwork_inbox WHERE result->>'processed_by' = 'venus'`,
  );
  return {
    status: online ? 'online' : 'parado',
    running: tarefaRunning,
    processed_by_venus: processed[0]?.n ?? 0,
    log: tailVenusLog(),
  };
}

export async function getVenusErros(): Promise<VenusErros> {
  const incidencias = await db<VenusIncidencia>(
    `SELECT id, kind, received_at, result->>'motivo' AS motivo, result->>'processed_by' AS por
     FROM kimiwork_inbox WHERE status='error' AND received_at > now() - interval '48 hours'
     ORDER BY received_at DESC LIMIT 30`,
  );
  const ERRO_RE = /(✗|ERRO|erro no ciclo|erro processando|erro na ordem|fetch failed|BLOQUEADO|estourou|ECONNREFUSED|timeout)/i;
  const RUIDO_RE = /NODE\.CMD|SyntaxError: Invalid or unexpected token|electron/i;
  const linhas: string[] = [];
  const dir = path.dirname(VENUS_LOG);
  for (const f of ['venus-varredura-out.log', 'venus-varredura-error.log']) {
    try {
      const file = path.join(dir, f);
      const size = fs.statSync(file).size;
      const buf = Buffer.alloc(Math.min(size, 200_000));
      const fd = fs.openSync(file, 'r');
      fs.readSync(fd, buf, 0, buf.length, size - buf.length);
      fs.closeSync(fd);
      for (const ln of buf.toString('utf8').split(/\r?\n/)) {
        const t = ln.trim();
        if (t && ERRO_RE.test(t) && !RUIDO_RE.test(t)) linhas.push(`[${f === 'venus-varredura-out.log' ? 'out' : 'err'}] ${t.slice(0, 280)}`);
      }
    } catch { /* log ausente — ignora */ }
  }
  return { incidencias, log: linhas.slice(-60) };
}

export function invocarTarefa(texto: string): { ok: boolean; error?: string } {
  if (!texto || !String(texto).trim()) return { ok: false, error: 'tarefa vazia' };
  if (tarefaRunning) return { ok: false, error: 'ja existe uma tarefa em execucao' };
  tarefaRunning = true;
  tarefaLog.push(`[${ts()}] [tarefa] invocada: ${texto}`);
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts', 'venus', 'venus.mjs'), '--tarefa', String(texto).trim()], {
    cwd: REPO_ROOT,
    env: { ...process.env },
  });
  child.stdout.on('data', (d) => tarefaLog.push(`[${ts()}] ${String(d).trim()}`));
  child.stderr.on('data', (d) => tarefaLog.push(`[${ts()}] ! ${String(d).trim()}`));
  child.on('close', (code) => {
    tarefaRunning = false;
    tarefaLog.push(`[${ts()}] [tarefa] concluida (exit ${code})`);
  });
  child.on('error', (err) => {
    tarefaRunning = false;
    tarefaLog.push(`[${ts()}] [tarefa] ERRO: ${err.message}`);
  });
  return { ok: true };
}
