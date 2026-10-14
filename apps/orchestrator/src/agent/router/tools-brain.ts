import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Sql } from '@luna/database';
import type { FastTool, ToolContext, ToolResult } from './tools.js';

/**
 * Tools do Brain pra FAST (P4): memória duradoura consultável no turno.
 * LEITURA apenas. Root do brain injetável pros testes.
 *
 * - `brain.search`: grep recursivo (case-insensitive) sobre todos os .md
 *   do brain — recortes com arquivo + linha. Limitado (navegação com teto
 *   de arquivos/matches) pra não estourar o contexto do FAST.
 * - `brain.client_ficha`: FICHA.md + MEMORY.md + OPINIONES.md recentes do
 *   cliente (dir slug em .brain/clients/<slug>/), resolvido por nome/código
 *   do client_id do contexto.
 */

export interface BrainToolsDeps {
  brainRoot?: string;
  maxFiles?: number;
  maxMatches?: number;
}

// 2026-10-14: era caminho Windows absoluto; agora relativo ao modulo
// (este arquivo fica em apps/orchestrator/src/agent/router/ → repo root = ../../../../).
import { fileURLToPath as _furl } from 'node:url';
const DEFAULT_ROOT = _furl(new URL('../../../../.brain', import.meta.url));

const ok = (data: unknown): ToolResult => ({ ok: true, data });
const fail = (error: string): ToolResult => ({ ok: false, data: null, error });

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function walkMdFiles(dir: string, maxFiles: number, acc: string[] = []): string[] {
  if (acc.length >= maxFiles || !existsSync(dir)) return acc;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (acc.length >= maxFiles) break;
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkMdFiles(full, maxFiles, acc);
    else if (e.endsWith('.md') || e.endsWith('.txt')) acc.push(full);
  }
  return acc;
}

export function createBrainTools(deps: BrainToolsDeps = {}): Record<string, FastTool> {
  const root = deps.brainRoot ?? DEFAULT_ROOT;
  const maxFiles = deps.maxFiles ?? 200;
  const maxMatches = deps.maxMatches ?? 12;

  return {
    /** grep recursivo sobre o brain: args { q: string } → recortes. */
    'brain.search': async (_db: Sql, _ctx: ToolContext, args: Record<string, unknown>) => {
      const q = String(args.q ?? '').trim();
      if (q.length < 2) return fail('brain.search: arg "q" (mín. 2 chars) é obrigatório');
      const needle = q.toLowerCase();
      const files = walkMdFiles(root, maxFiles);
      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const f of files) {
        if (matches.length >= maxMatches) break;
        let content: string;
        try {
          content = readFileSync(f, 'utf8');
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
          if (lines[i]!.toLowerCase().includes(needle)) {
            matches.push({
              path: f.slice(root.length + 1),
              line: i + 1,
              text: lines[i]!.trim().slice(0, 220),
            });
          }
        }
      }
      if (matches.length === 0) return ok({ matches: [], note: `nada no brain sobre "${q}"` });
      return ok({ matches, note: `${matches.length} recortes (máx ${maxMatches})` });
    },

    /** Ficha do cliente no brain: FICHA.md + MEMORY.md + OPINIONES.md (tail). */
    'brain.client_ficha': async (db: Sql, ctx: ToolContext) => {
      if (!ctx.clientId) return fail('brain.client_ficha: sem client_id no contexto');
      const client = await db.query<{ name: string; code: string | null }>(
        'SELECT name, code FROM clients WHERE id = $1',
        [ctx.clientId],
      );
      const row = client.rows[0];
      if (!row) return fail('brain.client_ficha: cliente não encontrado');
      const clientsDir = join(root, 'clients');
      const wanted = [normalize(row.code ?? ''), normalize(row.name)].filter(Boolean);
      let dir: string | null = null;
      try {
        for (const d of readdirSync(clientsDir)) {
          const nd = normalize(d);
          if (wanted.some((w) => w && (nd === w || nd.includes(w) || w.includes(nd)))) {
            dir = join(clientsDir, d);
            break;
          }
        }
      } catch {
        return fail('brain.client_ficha: .brain/clients indisponível');
      }
      if (!dir) return ok({ client: row.name, files: {}, note: 'sem pasta no brain ainda (cliente novo)' });
      const read = (name: string, tailLines?: number): string | null => {
        const p = join(dir!, name);
        if (!existsSync(p)) return null;
        try {
          const content = readFileSync(p, 'utf8');
          if (!tailLines) return content.slice(0, 4000);
          const lines = content.split(/\r?\n/);
          return lines.slice(-tailLines).join('\n');
        } catch {
          return null;
        }
      };
      return ok({
        client: row.name,
        ficha: read('FICHA.md'),
        memory: read('MEMORY.md'),
        opiniones_recentes: read('OPINIONES.md', 40),
        note: 'memória duradoura — opiniões são observações passadas, não fatos atuais',
      });
    },
  };
}
