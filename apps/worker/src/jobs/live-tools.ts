import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { resolve, sep, dirname, join } from 'node:path';
import { execFile } from 'node:child_process';

/**
 * Ferramentas do CÉREBRO VIVO em modo API (ADR-042, complemento do owner
 * 14/10: "o live brain deve ver a lista de tools — ler arquivos, editar,
 * criar, tudo"). O modelo roda stateless na roda de providers e PEDE tools
 * em JSON; quem EXECUTA é o worker (processo nexo na VPS), com:
 *
 *  - RAÍZES PERMITIDAS (path traversal bloqueado): só lê/escreve dentro das
 *    raízes configuradas (luna-agent, luna-kernel, brain por default).
 *  - shell.run com timeout, denylist de comandos catastróficos e cap de saída.
 *  - Tudo auditável: o investigate grava cada chamada em audit_log.
 *
 * Contrato do loop (o prompt ensina ao modelo):
 *   {"action":"tool","tool":"nome","args":{...}}
 *   {"action":"final","text":"resposta pro WhatsApp"}
 */

export interface LiveToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface LiveToolSpec {
  desc: string;
  args: Record<string, string>;
  run: (args: Record<string, unknown>) => Promise<LiveToolResult>;
}

const MAX_READ_BYTES = 200 * 1024;
const MAX_GREP_MATCHES = 50;
const SHELL_TIMEOUT_MS = 30_000;
const SHELL_MAX_OUTPUT = 10 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.cache']);

/** Comandos catastróficos / irreversíveis — recusados na hora (decreto:
 *  braços potentes SIM, autodestruição NÃO). */
const SHELL_DENY =
  /(rm\s+(-[a-zA-Z]*\s+)?\/(\s|$)|rm\s+-rf?\s+(\/|~|\$HOME|\.{0,2}\/?$)|mkfs|dd\s+if=|:\(\)\s*\{|shutdown|poweroff|reboot|halt\b|docker\s+system\s+(prune|df)|git\s+push\b.*(--force|-f)\b|curl[^|]*\|\s*(ba)?sh|wget[^|]*\|\s*(ba)?sh)/i;

export function createLiveToolRunner(deps: {
  roots: string[];
  log: { warn: (o: unknown, m: string) => void };
  /** Pool pra tools que tocam o banco (voice.call enfileira a ligação). */
  pool?: { query: (sql: string, params?: unknown[]) => Promise<unknown> };
}) {
  const roots = deps.roots.map((r) => resolve(r.trim())).filter(Boolean);
  if (roots.length === 0) roots.push(resolve('.'));

  function guardPath(raw: unknown): { abs: string } | { error: string } {
    if (typeof raw !== 'string' || raw.trim() === '') return { error: 'caminho (args.path) é obrigatório' };
    const abs = resolve(raw.trim());
    const ok = roots.some((r) => abs === r || abs.startsWith(r + sep));
    if (!ok) return { error: `caminho fora das raízes permitidas: ${roots.join(', ')}` };
    return { abs };
  }

  const ok = (data: unknown): LiveToolResult => ({ ok: true, data });
  const fail = (error: string): LiveToolResult => ({ ok: false, error });

  const tools: Record<string, LiveToolSpec> = {
    'listTools': {
      desc: 'Lista TODAS as ferramentas disponíveis com descrição e argumentos. SEMPRE disponível — quando não souber como fazer algo, chame listTools primeiro.',
      args: {},
      run: async () =>
        ok(
          Object.entries(tools).map(([name, t]) => ({
            tool: name,
            desc: t.desc,
            args: t.args,
          })),
        ),
    },

    'fs.read': {
      desc: 'Lê um arquivo de texto (UTF-8). Use ANTES de fs.edit para pegar o old_string exato.',
      args: { path: 'caminho absoluto dentro das raízes permitidas' },
      run: async (args) => {
        const g = guardPath(args.path);
        if ('error' in g) return fail(g.error);
        try {
          const buf = readFileSync(g.abs);
          if (buf.byteLength > MAX_READ_BYTES) {
            const partial = buf.subarray(0, MAX_READ_BYTES).toString('utf8');
            return ok({ path: g.abs, bytes: buf.byteLength, lines: partial.split('\n').length, truncated: true, content: partial });
          }
          const content = buf.toString('utf8');
          return ok({ path: g.abs, bytes: buf.byteLength, lines: content.split('\n').length, content });
        } catch (err) {
          return fail(`fs.read: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },

    'fs.write': {
      desc: 'Cria ou SOBRESCREVE um arquivo com o conteúdo exato. Cria diretórios automaticamente.',
      args: { path: 'caminho absoluto', content: 'conteúdo completo do arquivo (string)' },
      run: async (args) => {
        const g = guardPath(args.path);
        if ('error' in g) return fail(g.error);
        if (typeof args.content !== 'string') return fail('fs.write: args.content (string) é obrigatório');
        try {
          mkdirSync(dirname(g.abs), { recursive: true });
          writeFileSync(g.abs, args.content, 'utf8');
          return ok({ path: g.abs, bytes: Buffer.byteLength(args.content, 'utf8'), written: true });
        } catch (err) {
          return fail(`fs.write: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },

    'fs.edit': {
      desc: 'Edição cirúrgica: substitui old_string por new_string (primeira ocorrência). Leia o arquivo com fs.read antes para garantir o old_string exato.',
      args: { path: 'caminho absoluto', old_string: 'trecho EXATO atual do arquivo', new_string: 'novo trecho' },
      run: async (args) => {
        const g = guardPath(args.path);
        if ('error' in g) return fail(g.error);
        if (typeof args.old_string !== 'string' || args.old_string === '') return fail('fs.edit: args.old_string (não-vazio) é obrigatório');
        if (typeof args.new_string !== 'string') return fail('fs.edit: args.new_string (string) é obrigatório');
        try {
          const content = readFileSync(g.abs, 'utf8');
          const idx = content.indexOf(args.old_string);
          if (idx === -1) return fail('fs.edit: old_string não encontrado no arquivo (leia com fs.read e copie o trecho exato)');
          const next = content.slice(0, idx) + args.new_string + content.slice(idx + args.old_string.length);
          writeFileSync(g.abs, next, 'utf8');
          return ok({ path: g.abs, replaced: args.old_string.length, bytes: Buffer.byteLength(next, 'utf8') });
        } catch (err) {
          return fail(`fs.edit: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },

    'fs.list': {
      desc: 'Lista arquivos e diretórios de um caminho (nome + tipo).',
      args: { path: 'caminho absoluto de um diretório' },
      run: async (args) => {
        const g = guardPath(args.path);
        if ('error' in g) return fail(g.error);
        try {
          const entries = readdirSync(g.abs).map((name) => {
            let type = 'file';
            try {
              type = statSync(join(g.abs, name)).isDirectory() ? 'dir' : 'file';
            } catch { /* quebra de corrida: assume file */ }
            return { name, type };
          });
          return ok({ path: g.abs, entries });
        } catch (err) {
          return fail(`fs.list: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },

    'fs.grep': {
      desc: 'Busca por regex no conteúdo dos arquivos (recursivo, pula node_modules/.git). Retorna até 50 ocorrências com arquivo, linha e trecho.',
      args: { pattern: 'regex (ex.: "TODO|FIXME")', path: 'diretório raiz da busca (opcional, default: primeira raiz)' },
      run: async (args) => {
        if (typeof args.pattern !== 'string' || args.pattern === '') return fail('fs.grep: args.pattern é obrigatório');
        const g = guardPath(args.path ?? roots[0]);
        if ('error' in g) return fail(g.error);
        let re: RegExp;
        try {
          re = new RegExp(args.pattern, 'i');
        } catch {
          return fail('fs.grep: regex inválida');
        }
        const matches: Array<{ file: string; line: number; text: string }> = [];
        const walk = (dir: string): void => {
          if (matches.length >= MAX_GREP_MATCHES) return;
          let entries;
          try {
            entries = readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of entries) {
            if (matches.length >= MAX_GREP_MATCHES) return;
            if (e.name.startsWith('.') && e.name !== '.env.example') continue;
            const full = join(dir, e.name);
            if (e.isDirectory()) {
              if (!SKIP_DIRS.has(e.name)) walk(full);
            } else if (e.isFile() && statSync(full).size < MAX_READ_BYTES) {
              try {
                const lines = readFileSync(full, 'utf8').split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (re.test(lines[i])) {
                    matches.push({ file: full, line: i + 1, text: lines[i].slice(0, 200) });
                    if (matches.length >= MAX_GREP_MATCHES) return;
                  }
                }
              } catch { /* binário/ilegível: ignora */ }
            }
          }
        };
        walk(g.abs);
        return ok({ matches: matches.length, results: matches });
      },
    },

    'shell.run': {
      desc: 'Roda UM comando bash não-interativo (timeout 30s, saída limitada a 10KB). Útil pra git, node, curl, grep avançado. Comandos destrutivos/irreversíveis são recusados.',
      args: { cmd: 'comando completo em uma string' },
      run: async (args) => {
        if (typeof args.cmd !== 'string' || args.cmd.trim() === '') return fail('shell.run: args.cmd é obrigatório');
        if (SHELL_DENY.test(args.cmd)) return fail('shell.run: comando recusado pelo guard de segurança (destrutivo/irreversível)');
        return new Promise((resolvePromise) => {
          execFile('bash', ['-lc', args.cmd as string], { cwd: roots[0], timeout: SHELL_TIMEOUT_MS, maxBuffer: SHELL_MAX_OUTPUT * 2 }, (err, stdout, stderr) => {
            const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).slice(0, SHELL_MAX_OUTPUT);
            if (err) {
              resolvePromise(ok({ exitCode: (err as NodeJS.ErrnoException & { code?: number }).code ?? -1, output: out, failed: true }));
            } else {
              resolvePromise(ok({ exitCode: 0, output: out }));
            }
          });
        });
      },
    },
  };

  // voice.call (REGRA OWNER 14/10): pedido no chat ("Luna, liga pro fulano e
  // fala X") vira LIGAÇÃO DE VOZ real. O report-back automático cai de volta
  // no chat de origem quando a chamada termina (call-executor).
  if (deps.pool) {
    tools['voice.call'] = {
      desc: 'Faz uma LIGAÇÃO DE VOZ pelo WhatsApp para um contato registrado. Use quando o usuário pedir para ligar/telefonar/chamar alguém. A Luna reporta o resultado da ligação de volta neste chat automaticamente.',
      args: {
        destinatario: 'nome do contato (registrado no chat_registry, ex.: Abner, Enoque)',
        objetivo: 'o que falar/pedir na ligação, em PT-BR direto',
      },
      run: async (args) => {
        const destinatario = String(args.destinatario ?? '').trim();
        const objetivo = String(args.objetivo ?? '').trim();
        if (!destinatario || !objetivo) return fail('args.destinatario e args.objetivo são obrigatórios');
        const { enqueueJob } = await import('@luna/database');
        const job = await enqueueJob(deps.pool as never, {
          job_type: 'voice.call',
          payload: {
            brief: {
              destinatario,
              objetivo,
              autorizador: 'live brain (pedido via chat)',
              motivo: `Pedido no chat: ${objetivo}`.slice(0, 250),
              origem_conversation_id: args.origem_conversation_id ?? null,
            },
          },
          priority: 8,
          max_attempts: 1,
          idempotency_key: `voice_call_tool:${Date.now()}`,
        });
        return ok({ disparada: true, job_id: (job as { job?: { id?: string } }).job?.id ?? null, destinatario, nota: 'report-back automático cai neste chat quando a chamada terminar' });
      },
    };
  }

  return {
    names: () => Object.keys(tools),
    roots,
    async run(name: string, args: Record<string, unknown>): Promise<LiveToolResult> {
      const tool = tools[name];
      if (!tool) return fail(`tool desconhecida: ${name} — chame listTools para ver o catálogo`);
      try {
        return await tool.run(args ?? {});
      } catch (err) {
        return fail(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

export type LiveToolRunner = ReturnType<typeof createLiveToolRunner>;

/** Parse tolerante do passo do modelo (JSON embrulhado em prosa vira final). */
export function parseToolStep(raw: string): { action: 'tool'; tool: string; args: Record<string, unknown> } | { action: 'final'; text: string } {
  const candidate = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return { action: 'final', text: raw.trim() };
  try {
    const parsed = JSON.parse(candidate) as { action?: unknown; tool?: unknown; args?: unknown; text?: unknown };
    if (parsed.action === 'tool' && typeof parsed.tool === 'string' && parsed.tool.length > 0) {
      return { action: 'tool', tool: parsed.tool, args: typeof parsed.args === 'object' && parsed.args !== null ? (parsed.args as Record<string, unknown>) : {} };
    }
    if (parsed.action === 'final' && typeof parsed.text === 'string') {
      return { action: 'final', text: parsed.text };
    }
    return { action: 'final', text: raw.trim() };
  } catch {
    return { action: 'final', text: raw.trim() };
  }
}
