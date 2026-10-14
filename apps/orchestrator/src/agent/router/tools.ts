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
  'brain.search': { desc: 'Busca texto no brain da Nexo (memória duradoura).', args: 'q (mín. 2 chars)' },
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
    return {
      ok: true,
      data: {
        tools,
        hint: 'Chame qualquer uma via {"type":"TOOL_CALL","tool":"nome","args":{...}}. Se uma tool falhar por arg faltando, leia o erro e tente de novo com o arg certo.',
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
