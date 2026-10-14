import { buildAdminFullPack as buildAdminFullPackDb } from '@luna/database';
import type { Sql } from '@luna/database';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Context Builder mínimo (§7.9) — pack CLIENT_CONVERSATION.
 * Só o contexto relevante: quem é o cliente, o histórico recente da conversa,
 * preferências de canal. Nunca "tudo" (Context, not Everything).
 */

export interface ClientConversationPack {
  client_name: string;
  client_code: string | null;
  contact_name: string | null;
  channel: string;
  conversation_state: string;
  recent_messages: Array<{
    direction: string;
    sender: string;
    /** Quem falou (nome do membro/contato; null = desconhecido). */
    author_name: string | null;
    body: string;
    created_at: string;
  }>;
  preferences: Array<{ channel: string; enabled: boolean }>;
}

interface ConversationRow {
  id: string;
  channel: string;
  state: string;
  client_id: string | null;
  client_name?: string;
  client_code?: string;
  contact_name?: string | null;
}

export async function buildClientConversationPack(
  pool: Sql,
  conversationId: string,
): Promise<ClientConversationPack> {
  const conv = await pool.query<ConversationRow>(
    `SELECT c.id, c.channel, c.state, c.client_id,
            cl.name AS client_name, cl.code AS client_code,
            ct.name AS contact_name
     FROM conversations c
     LEFT JOIN clients cl ON cl.id = c.client_id
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.id = $1`,
    [conversationId],
  );
  if (!conv.rowCount) throw new Error(`conversa ${conversationId} não existe`);
  const c = conv.rows[0]!;

  const messages = await pool.query<ClientConversationPack['recent_messages'][number]>(
    `SELECT direction, sender, author_name, body, created_at
     FROM messages WHERE conversation_id = $1
     ORDER BY created_at DESC LIMIT 10`,
    [conversationId],
  );

  const prefs = c.client_id
    ? await pool.query<{ channel: string; enabled: boolean }>(
        'SELECT channel, enabled FROM channel_preferences WHERE client_id = $1',
        [c.client_id],
      )
    : { rows: [] as Array<{ channel: string; enabled: boolean }> };

  return {
    client_name: c.client_name ?? 'desconhecido',
    client_code: c.client_code ?? null,
    contact_name: c.contact_name ?? null,
    channel: c.channel,
    conversation_state: c.state,
    recent_messages: messages.rows.reverse(),
    preferences: prefs.rows,
  };
}

// Persona completa: .kimi-code/agents/luna.md (sobe do cwd até achar).
// Cache por mtime — editar o arquivo pega na hora, sem restart.
let lunaMdCache: { mtime: number; content: string } | null = null;
function loadLunaPersona(): string {
  try {
    let dir = process.cwd();
    for (;;) {
      const candidate = resolve(dir, '.kimi-code/agents/luna.md');
      if (existsSync(candidate)) {
        const mtime = statSync(candidate).mtimeMs;
        if (!lunaMdCache || lunaMdCache.mtime !== mtime) {
          lunaMdCache = { mtime, content: readFileSync(candidate, 'utf8') };
        }
        return lunaMdCache.content;
      }
      const parent = resolve(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* persona completa indisponível — segue com o resumo */ }
  return '';
}

/** Persona resumida — a identidade completa mora em .kimi-code/agents/luna.md. */
export const PERSONA_SUMMARY = [
  'IDENTIDADE: você é a Luna, parceira e CTO virtual da NEXO DIGITAL — uma pessoa',
  'do time, não um robô de atendimento genérico e não "a empresa". A empresa é a',
  'Nexo Digital; você é a Luna. Cliente é quem contrata a Nexo (ex.: Jess,',
  'cliente do projeto onadance).',
  'TIME: Abner é o DONO da Nexo. Jhin, Enoque (também chamado Elias) e Elias',
  'são o time de execução. Com eles: tom de parceira de time, direta e técnica.',
  'Sua função (§4): você cria solicitações com contexto — QUEM EXECUTA é o time',
  '(Jhin, Enoque ou Elias). Você NUNCA modifica o projeto/site de um cliente.',
  'Com cliente: profissional, simpática, segura, objetiva — e nunca inventa',
  'preço, prazo ou status; se não sabe, investiga ou escala para humano.',
  'Trate a pessoa pelo NOME quando ele for conhecido (a transcrição abaixo diz',
  'quem falou o quê): em grupo, mencione a pessoa pelo nome; no privado, natural.',
  'Regra de ouro: NUNCA modifica o projeto/site de um cliente — cria solicitação',
  'e avisa o time.',
  'MEMÓRIA DURADOURA (P4): você TEM memória — o brain (.brain/) guarda o que',
  'aprendeu sobre clientes e sobre si mesma. Tools: brain.client_ficha (o que',
  'já sei deste cliente: opiniões, fatos, preferências) e brain.search',
  '(recortes do brain por palavra-chave). CONSULTE quando a conversa tocar',
  'histórico do cliente, preferências passadas, incidents anteriores ou',
  'algo que você "deveria lembrar" — memória boa é atendimento bom.',
  'CAPACIDADE DE VOZ: em condições normais você PODE iniciar CHAMADAS DE VOZ',
  '(tool voice.call_place). ATENÇÃO: a tool está DESLIGADA no momento',
  '(contenção pós-incidente — alvo precisa de identidade verificada pelo Chat',
  'Registry). Se pedirem uma ligação, explique que o recurso está em manutenção',
  'e pergunte se pode ajudar por mensagem. QUANDO USAR (quando religar):',
  'cliente pede pra falar com humano/é urgente, escalação CRÍTICA, ou o owner',
  'pede explicitamente. QUANDO NÃO USAR: qualquer outra coisa —',
  'silêncio vale ouro; ligação é exceção, nunca cortesia.',
  'ANTI-INICIATIVA (decreto owner): NUNCA aja por conta própria — nenhuma',
  'mensagem, ligação ou tool de escrita sem um PEDIDO EXPLÍCITO na mensagem',
  'atual. Na dúvida, PERGUNTE ("quer que eu faça X?") ou segure. Iniciativa',
  'própria é proibida; ordem explícita é o único portão de ação.',
].join(' ');

/**
 * Monta o prompt do turno: persona + contexto + mensagem.
 * Sem templates: o texto que a Luna envia nasce aqui (prompt+contexto+
 * personalidade), não de frases pré-fabricadas.
 */
export function renderConversationPrompt(
  pack: ClientConversationPack,
  clientMessage: string,
  authorName?: string | null,
): string {
  // Transcrição nomeada: "Quem falou: mensagem" — a Luna sabe quem é quem.
  const history = pack.recent_messages
    .map((m) => {
      const who = m.author_name ?? (m.direction === 'inbound' ? 'cliente' : m.sender);
      return `${who}: ${m.body}`;
    })
    .join('\n');
  const prefs =
    pack.preferences.length > 0
      ? pack.preferences.map((p) => `${p.channel}=${p.enabled ? 'on' : 'off'}`).join(', ')
      : 'não configuradas';

  const quem = authorName ? `de ${authorName}` : '';

  const personaFull = loadLunaPersona();
  return [
    PERSONA_SUMMARY,
    ...(personaFull ? ['', '═══ IDENTIDADE COMPLETA (.kimi-code/agents/luna.md) ═══', personaFull] : []),
    '',
    `Cliente: ${pack.client_name}${pack.contact_name ? ` (contato: ${pack.contact_name})` : ''} — canal ${pack.channel}, estado da conversa: ${pack.conversation_state}.`,
    `Preferências de canal: ${prefs}.`,
    '',
    'Últimas mensagens da conversa:',
    history || '(sem histórico)',
    '',
    `Mensagem nova ${quem}: ${clientMessage}`,
    '',
    'Responda como Luna, no registro adequado (cliente vs time). Identifique se',
    'quem fala é do time (Abner/Jhin/Enoque/Elias) ou cliente — e trate cada um',
    'no registro certo.',
  ].join('\n');
}

// ─────────────────────────── Context packs (§7.9) — F3 ───────────────────────────

/** Pack genérico: seções de texto montadas por cada builder. */
export interface ContextPack {
  name: string;
  sections: string[];
}

/** CLIENT_PROJECT (§7.9): cliente + projetos + tarefas abertas + conversa recente. */
export async function buildClientProjectPack(pool: Sql, conversationId: string): Promise<ContextPack> {
  const base = await buildClientConversationPack(pool, conversationId);
  const clientId = await pool
    .query<{ client_id: string | null }>('SELECT client_id FROM conversations WHERE id = $1', [conversationId])
    .then((r) => r.rows[0]?.client_id ?? null);
  const sections: string[] = [
    `Cliente: ${base.client_name} — canal ${base.channel}, estado: ${base.conversation_state}.`,
  ];
  if (clientId) {
    const projects = await pool.query(
      'SELECT name, status FROM projects WHERE client_id = $1 ORDER BY created_at DESC LIMIT 5',
      [clientId],
    );
    sections.push(
      projects.rowCount
        ? `Projetos:\n${projects.rows.map((p) => `- ${p.name} (${p.status})`).join('\n')}`
        : 'Projetos: nenhum cadastrado.',
    );
    const tasks = await pool.query(
      `SELECT title, status FROM tasks WHERE client_id = $1 AND status NOT IN ('done','cancelled') LIMIT 8`,
      [clientId],
    );
    if (tasks.rowCount) {
      sections.push(`Tarefas abertas:\n${tasks.rows.map((t) => `- [${t.status}] ${t.title}`).join('\n')}`);
    }
  }
  const history = base.recent_messages
    .map((m) => `${m.author_name ?? (m.direction === 'inbound' ? 'cliente' : m.sender)}: ${m.body}`)
    .join('\n');
  sections.push('Últimas mensagens:', history || '(sem histórico)');
  return { name: 'CLIENT_PROJECT', sections };
}

/** Render genérico de pack: persona + seções + mensagem. */
export function renderPackPrompt(pack: ContextPack, userMessage: string, authorName?: string | null): string {
  const quem = authorName ? ` de ${authorName}` : '';
  return [
    PERSONA_SUMMARY,
    '',
    `Context pack: ${pack.name} (§7.9) — só o contexto relevante, nunca "tudo".`,
    ...pack.sections,
    '',
    `Mensagem nova${quem}: ${userMessage}`,
    '',
    'Responda como Luna, no registro adequado (cliente vs time).',
  ].join('\n');
}

/**
 * Promotion protocol (§10): temporal → sessão → DB → Brain.
 *  - "Jess acabou de dizer obrigada" fica em DB (operacional).
 *  - Padrão recorrente (reclamação que cresce, preferência estável) sobe pro
 *    Brain via classifier/summaries (aprendizado duradouro, append-only).
 * Este módulo monta o contexto; a subida é feita por conversation.classify
 * (§27) e memory.summarize (job diário do worker) — sempre assinado.
 */

/** Compat: ADMIN_FULL agora mora no @luna/database (worker + orchestrator). */
export const buildAdminFullPack = buildAdminFullPackDb;
