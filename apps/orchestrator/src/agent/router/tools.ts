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

export const FAST_TOOLS: Record<string, FastTool> = {
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
