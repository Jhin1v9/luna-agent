/**
 * Testes de INTEGRAÇÃO do Context Builder enriquecido (decreto owner
 * 2026-09-24 11:55): o prompt do Operador tem de nascer com TUDO — quem liga,
 * últimas mensagens, solicitações pendentes e memórias do brain.
 *
 * Banco dedicado `luna_test` (mesmo padrão dos demais arquivos de
 * integração): criado no beforeAll, migrado pelo migrator real, truncado
 * entre testes e derrubado no afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { migrate } from '../../packages/database/src/migrate.js';
import {
  buildContactContext,
  formatContactContextText,
  checkConnection,
} from '../../packages/database/src/index.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://luna:luna@localhost:5433/luna_test';
const ADMIN_URL = (() => {
  const u = new URL(TEST_URL);
  u.pathname = '/postgres';
  return u.toString();
})();
const TEST_DB_NAME = new URL(TEST_URL).pathname.slice(1);

const TABLES = [
  'organizations', 'plans', 'clients', 'contacts', 'channel_preferences',
  'conversations', 'messages', 'events', 'jobs', 'notifications',
  'agent_runs', 'run_buffer_lines', 'tool_runs', 'escalations', 'incidents',
  'usage_entries', 'memory_index', 'projects', 'tasks', 'reports',
  'brain_commits', 'outbox', 'dead_letter_events', 'idempotency_keys',
  'audit_log', 'activity_log',
];

let pool: pg.Pool;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();

  await migrate(TEST_URL);
  pool = new pg.Pool({ connectionString: TEST_URL });
  expect(await checkConnection(pool)).toBe(true);
});

afterAll(async () => {
  await pool.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.end();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
});

const q = (text: string, values?: unknown[]) => pool.query(text, values);

/** Cenário base: cliente Onadance + contato Jess + conversa + mensagens +
 *  memória do brain + tarefa aberta + escalação aberta + job morto que
 *  menciona o telefone do contato. */
async function seed(): Promise<{ contactId: string; clientId: string }> {
  const org = await q(
    `INSERT INTO organizations (name, slug) VALUES ('Nexo Digital', 'nexo') RETURNING id`,
  );
  const plan = await q(`INSERT INTO plans (name, code) VALUES ('Base', 'base') RETURNING id`);
  const client = await q(
    `INSERT INTO clients (organization_id, plan_id, name, code) VALUES ($1, $2, 'Onadance', 'onadance') RETURNING id`,
    [org.rows[0].id, plan.rows[0].id],
  );
  const clientId = client.rows[0].id as string;
  const contact = await q(
    `INSERT INTO contacts (client_id, name, channel, address, metadata)
     VALUES ($1, 'Jess', 'whatsapp', '+34 685 093 192', '{"role": "dona"}') RETURNING id`,
    [clientId],
  );
  const contactId = contact.rows[0].id as string;
  const conv = await q(
    `INSERT INTO conversations (client_id, contact_id, channel) VALUES ($1, $2, 'whatsapp') RETURNING id`,
    [clientId, contactId],
  );
  await q(
    `INSERT INTO messages (conversation_id, direction, channel, sender, body, author_name)
     VALUES ($1, 'inbound', 'whatsapp', $2, 'Oi! Quando fica pronto o vídeo do slider?', 'Jess')`,
    [conv.rows[0].id, contactId],
  );
  await q(
    `INSERT INTO messages (conversation_id, direction, channel, sender, body, author_name)
     VALUES ($1, 'outbound', 'whatsapp', $2, 'Fica pronto amanhã, te mando preview.', 'Luna')`,
    [conv.rows[0].id, contactId],
  );
  await q(
    `INSERT INTO memory_index (client_id, type, path, tags, summary)
     VALUES ($1, 'opinion', 'brain://test', '{"site"}', 'Cliente pediu para trocar o slider do site por vídeo vertical')`,
    [clientId],
  );
  await q(
    `INSERT INTO tasks (client_id, title, status, due_date)
     VALUES ($1, 'Trocar slider por vídeo vertical', 'open', '2026-09-30')`,
    [clientId],
  );
  await q(
    `INSERT INTO escalations (client_id, conversation_id, reason, priority, status)
     VALUES ($1, $2, 'Cliente pediu urgência no vídeo', 'high', 'open')`,
    [clientId, conv.rows[0].id],
  );
  await q(
    `INSERT INTO jobs (job_type, payload, status, priority, run_at, attempts, max_attempts)
     VALUES ('video.render', '{"destinatario": "34685093192"}', 'dead', 1, now(), 3, 3)`,
  );
  return { contactId, clientId };
}

describe('context builder (integração — decreto owner 11:55)', () => {
  it('resolve contato por telefone e traz clientId (ponte pro brain/solicitações)', async () => {
    const { contactId } = await seed();
    const ctx = await buildContactContext(pool, { phone: '+34 685 093 192' });
    expect(ctx.contact).not.toBeNull();
    expect(ctx.contact!.id).toBe(contactId);
    expect(ctx.contact!.name).toBe('Jess');
    expect(ctx.contact!.role).toBe('dona');
    expect(ctx.contact!.clientId).toBeTruthy();
  });

  it('traz memórias do brain, solicitações pendentes e últimas mensagens', async () => {
    await seed();
    const ctx = await buildContactContext(pool, { phone: '34685093192' });
    // Brain: memória do client_id do contato.
    expect(ctx.brainMemories.length).toBe(1);
    expect(ctx.brainMemories[0].summary).toContain('slider');
    expect(ctx.brainMemories[0].tags).toContain('site');
    // Solicitações: tarefa aberta + escalação aberta + job morto (menciona o telefone).
    const kinds = ctx.openSolicitations.map((s) => s.kind).sort();
    expect(kinds).toEqual(['escalação', 'job', 'tarefa']);
    const job = ctx.openSolicitations.find((s) => s.kind === 'job')!;
    expect(job.status).toBe('dead');
    expect(job.summary).toContain('FALHOU');
    // Mensagens: ambas as direções, mais recente por último.
    expect(ctx.recentMessages.length).toBe(2);
    expect(ctx.recentMessages[1].body).toContain('preview');
  });

  it('não lista tarefa concluída nem escalação resolvida', async () => {
    const { clientId } = await seed();
    await q(`UPDATE tasks SET status='done' WHERE client_id=$1`, [clientId]);
    await q(`UPDATE escalations SET status='resolved' WHERE client_id=$1`, [clientId]);
    await q(`UPDATE jobs SET status='completed' WHERE status='dead'`);
    const ctx = await buildContactContext(pool, { phone: '34685093192' });
    expect(ctx.openSolicitations).toEqual([]);
  });

  it('formatContactContextText injeta TODOS os blocos no prompt do Operador', async () => {
    await seed();
    const ctx = await buildContactContext(pool, { phone: '34685093192' });
    const text = formatContactContextText(ctx);
    expect(text).toContain('QUEM ESTÁ NA LINHA: Jess');
    expect(text).toContain('- papel: dona');
    expect(text).toContain('SOLICITAÇÕES PENDENTES');
    expect(text).toContain('Trocar slider por vídeo vertical');
    expect(text).toContain('Cliente pediu urgência no vídeo');
    expect(text).toContain('video.render');
    expect(text).toContain('ÚLTIMA CONVERSA NO WHATSAPP');
    expect(text).toContain('Oi! Quando fica pronto o vídeo do slider?');
    expect(text).toContain('O QUE SEI SOBRE ESSA PESSOA/CLIENTE');
    expect(text).toContain('slider do site por vídeo vertical');
  });

  it('contato desconhecido: tudo vazio e texto de fallback fail-closed', async () => {
    const ctx = await buildContactContext(pool, { phone: '+99 999 999 999' });
    expect(ctx.contact).toBeNull();
    expect(ctx.recentMessages).toEqual([]);
    expect(ctx.brainMemories).toEqual([]);
    expect(ctx.openSolicitations).toEqual([]);
    expect(formatContactContextText(ctx)).toContain('desconhecido');
  });
});
