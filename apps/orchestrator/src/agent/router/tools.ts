import type { Sql } from '@luna/database';

/**
 * Tools do FAST (contrato §5 TOOL_CALL) — catálogo de leitura do workspace.
 * Ferramentas de ESCRITA em projeto de cliente NÃO EXISTEM para a Luna (§4).
 * Adicionar tool = registrar aqui + commit (config-as-code enxuto).
 */

export interface ToolContext {
  conversationId: string;
  clientId: string | null;
}

export interface ToolResult {
  ok: boolean;
  data: unknown;
  error?: string;
}

export type FastTool = (db: Sql, ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;

/**
 * Catálogo legível (nome → descrição + args) — alimenta a tool listTools
 * (decreto owner 14/10: "ela tem que SABER quais tools tem — se quiser saber,
 * execute listTools"). Tool registrada sem entrada cai na desc genérica.
 */
export const TOOL_CATALOG: Record<string, { desc: string; args?: string }> = {
  'conversation.recent': { desc: 'Últimas 10 mensagens DESTA conversa (além do contexto que já veio no prompt).' },
  'client.summary': { desc: 'Resumo do cliente: contatos, plano, projetos, conversas abertas.' },
  'contact.register': { desc: 'Confirma/atualiza o cadastro autorizado do contato da conversa atual após ele se apresentar.', args: 'name (obrigatório), phone com DDI (obrigatório em autorização temporária), need (opcional)' },
  'brain.search': { desc: 'Busca texto no brain da Superclim (memória duradoura).', args: 'q (mín. 2 chars)' },
  'brain.client_ficha': { desc: 'Ficha completa do cliente no brain (FICHA.md + MEMORY.md + OPINIONES recentes).' },
  'voice.call_place': { desc: 'Faz uma LIGAÇÃO DE VOZ pelo WhatsApp pra contato registrado (Chat Registry, deny-first).', args: 'contato (obrigatório), motivo/objetivo (opcional)' },
  'nexo.finance.summary': { desc: 'Resumo financeiro do painel Nexo.' },
  'nexo.clients.list': { desc: 'Lista clientes do workspace Nexo.' },
  'nexo.leads.list': { desc: 'Lista leads do painel Nexo.' },
  'nexo.tasks.list': { desc: 'Lista tarefas do painel Nexo.' },
  'nexo.cashbox.summary': { desc: 'Resumo do caixa do painel Nexo.' },
  'nexo.expenses.list': { desc: 'Lista despesas do painel Nexo.' },
  'nexo.payments.list': { desc: 'Lista pagamentos do painel Nexo.' },
  'nexo.quotes.list': { desc: 'Lista orçamentos do painel Nexo.' },
  'nexo.ideas.list': { desc: 'Lista ideias do painel Nexo.' },
  'nexo.system.status': { desc: 'Status do sistema no painel Nexo.' },
  'nexo.ops.overview': { desc: 'Visão geral de operações do painel Nexo.' },
  'nexo.notifications.list': { desc: 'Notificações do painel Nexo.' },
  'lunaWeb.catalog': { desc: 'Catálogo completo da LUNA WEB (mesmas tools do painel web — índice inteiro).' },
  'lunaWeb.exec': { desc: 'Executa qualquer tool da Luna Web pelo nome: {"tool":"dashboardCreateTask","params":{...}}.' },
  'listTools': { desc: 'Lista TODAS as suas tools e o que cada uma faz (esta lista).' },
};

export const FAST_TOOLS: Record<string, FastTool> = {
  /** Catálogo completo das tools disponíveis (decreto owner 14/10 — a Luna
   *  nunca mais opera no escuro: uma chamada e ela vê todos os braços). */
  listTools: async () => {
    const tools = toolNames().map((name) => ({
      name,
      ...(TOOL_CATALOG[name] ?? { desc: 'tool registrada (sem descrição no catálogo)' }),
    }));
    // v15 (decreto owner 15/10): MESCLA o catálogo da Luna Web — o índice
    // idêntico ao do chat web (editar projetos, logins, providers, tudo).
    let lunaWeb: string | null = null;
    try {
      lunaWeb = (await lunaWebCatalogProvider?.()) ?? null;
    } catch {
      lunaWeb = null; // kernel fora: listTools nativo continua servindo
    }
    return {
      ok: true,
      data: {
        tools,
        hint: 'Chame qualquer uma via {"type":"TOOL_CALL","tool":"nome","args":{...}}. Se uma tool falhar por arg faltando, leia o erro e tente de novo com o arg certo.',
        lunaWebCatalog: lunaWeb,
        lunaWebNote: lunaWeb
          ? '↑ MESMO catálogo da Luna Web. As tools de lá (dashboard*/workspace*/whatsapp*/brain*) rodam PELO MESMO NOME aqui. Docs de qualquer uma: lunaWeb.catalog'
          : 'catálogo da Luna Web indisponível agora (kernel :3458 fora?). Disponível: lunaWeb.catalog / lunaWeb.exec',
      },
    };
  },

  /** Últimas mensagens da conversa (além do que o context pack já trouxe). */  'conversation.recent': async (db, ctx) => {
    const res = await db.query(
      `SELECT direction, author_name, body, created_at FROM messages
       WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [ctx.conversationId],
    );
    return { ok: true, data: res.rows.reverse() };
  },

  /** Resumo do cliente: contatos, plano, projetos, conversas abertas. */
  'client.summary': async (db, ctx) => {
    if (!ctx.clientId) return { ok: false, data: null, error: 'sem client_id no contexto' };
    const client = await db.query(
      `SELECT c.name, c.code, c.status, p.name AS plan FROM clients c
       LEFT JOIN plans p ON p.id = c.plan_id WHERE c.id = $1`,
      [ctx.clientId],
    );
    const contacts = await db.query(
      'SELECT name, channel, address FROM contacts WHERE client_id = $1',
      [ctx.clientId],
    );
    const projects = await db.query(
      'SELECT name, status FROM projects WHERE client_id = $1',
      [ctx.clientId],
    );
    return {
      ok: true,
      data: { client: client.rows[0] ?? null, contacts: contacts.rows, projects: projects.rows },
    };
  },

  /** Cadastro assistido do próprio interlocutor; nunca aceita chat arbitrário. */
  'contact.register': async (db, ctx, args) => {
    const name = String(args.name ?? '').trim();
    const phoneDigits = String(args.phone ?? '').replace(/\D/g, '');
    const need = String(args.need ?? '').trim();
    if (name.length < 2) return { ok: false, data: null, error: 'name é obrigatório' };
    const current = await db.query<{ contact_id: string | null; address: string | null; channel: string }>(
      `SELECT cv.contact_id, ct.address, cv.channel
       FROM conversations cv LEFT JOIN contacts ct ON ct.id = cv.contact_id
       WHERE cv.id = $1 LIMIT 1`,
      [ctx.conversationId],
    );
    const row = current.rows[0];
    if (!row || row.channel !== 'whatsapp' || !row.address) {
      return { ok: false, data: null, error: 'conversa WhatsApp atual não resolvida' };
    }
    if (row.address.includes('@g.us')) {
      return { ok: false, data: null, error: 'contact.register não cadastra grupos automaticamente' };
    }
    const currentRegistry = await db.query<{ note: string | null; phone_e164: string | null }>(
      `SELECT note, phone_e164 FROM chat_registry WHERE kind='individual' AND chat_key=$1 LIMIT 1`, [row.address],
    );
    const temporary = currentRegistry.rows[0]?.phone_e164 == null && currentRegistry.rows[0]?.note?.startsWith('Autorização temporária');
    if (temporary && (phoneDigits.length < 8 || phoneDigits.length > 15)) {
      return { ok: false, data: null, error: 'phone com DDI é obrigatório para concluir este cadastro autorizado' };
    }
    const digits = phoneDigits || row.address.replace(/\D/g, '');
    const finalChatKey = digits || row.address;
    const { registryUpsert } = await import('@luna/database');
    await registryUpsert(db, {
      chatKey: finalChatKey,
      kind: 'individual',
      canonicalName: name,
      displayHint: name,
      role: 'allowed',
      notifyChannel: digits ? `whatsapp:+${digits}` : null,
      phoneE164: digits ? `+${digits}` : null,
      resolvedBy: 'luna_onboarding',
      note: need ? `Cliente se apresentou. Necessidade inicial: ${need.slice(0, 300)}` : 'Cliente se apresentou à Luna.',
    });
    if (row.contact_id) {
      await db.query(
        `UPDATE contacts SET name = $2, address=$4, metadata = metadata || $3::jsonb, updated_at = now() WHERE id = $1`,
        [row.contact_id, name, JSON.stringify({ role: 'cliente', phone: digits ? `+${digits}` : null, need: need || null, registered_by: 'luna_onboarding' }), finalChatKey],
      );
    }
    if (temporary && finalChatKey !== row.address) {
      await db.query(
        `UPDATE chat_registry SET canonical_name=$2, display_hint=$2, phone_e164=$3, notify_channel=$4,
         note='Alias do título WhatsApp mantido para resolução; identidade numérica verificada no cadastro.', updated_at=now()
         WHERE kind='individual' AND chat_key=$1`,
        [row.address, name, `+${digits}`, `whatsapp:+${digits}`],
      );
    }
    return { ok: true, data: { registered: true, name, chat_key: finalChatKey, need: need || null } };
  },
};

export function toolNames(): string[] {
  return Object.keys(FAST_TOOLS);
}

export async function runTool(
  db: Sql,
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = FAST_TOOLS[name];
  if (!tool) return { ok: false, data: null, error: `tool desconhecida: ${name}` };
  try {
    return await tool(db, ctx, args);
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Registra tools extras no catálogo do FAST (ex.: tools Nexo da VPS). */
export function registerFastTools(extra: Record<string, FastTool>): void {
  for (const [name, fn] of Object.entries(extra)) {
    if (!(name in FAST_TOOLS)) FAST_TOOLS[name] = fn;
  }
}

/**
 * Provider do catálogo Luna Web (decreto owner 15/10): injetado no boot por
 * tools-luna-web.js; listTools mescla o índice no output. Kernel fora →
 * provider ausente/quebrado e o listTools nativo segue funcionando.
 */
let lunaWebCatalogProvider: (() => Promise<string | null>) | null = null;
export function setLunaWebCatalogProvider(fn: () => Promise<string | null>): void {
  lunaWebCatalogProvider = fn;
}
