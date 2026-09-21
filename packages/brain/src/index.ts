import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Brain protocol helpers (§11) — append-only, assinado `data + autor: Luna`.
 * O Brain é Git: histórico, diff, autor, rollback. NUNCA editar entrada
 * antiga; tudo o que entra, entra por append.
 */

export const BRAIN_ROOT = 'C:/Users/Abner/Documents/Luna cto/luna-agent/.brain';

export interface SynapseEntry {
  /** SHA curto do commit. */
  commit: string;
  /** O que mudou / aprendizado. */
  summary: string;
  correlation_id?: string | null;
  author?: string;
  date?: string; // YYYY-MM-DD
}

/**
 * Sinapse: cada commit vira uma nota estruturada no Brain
 * (`.brain/luna/synapses/YYYY-MM.md`). Correlação pro commit preservada.
 */
export function appendSynapse(entry: SynapseEntry, root: string = BRAIN_ROOT): string {
  const date = entry.date ?? new Date().toISOString().slice(0, 10);
  const month = date.slice(0, 7);
  const dir = join(root, 'luna', 'synapses');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${month}.md`);
  if (!existsSync(path)) {
    appendFileSync(
      path,
      `# Sinapses — ${month}\n\n> Uma linha por commit: o que mudou, o que aprendi. Append-only.\n\n`,
      'utf8',
    );
  }
  const line = `- ${date} · commit ${entry.commit} · autor: ${entry.author ?? 'Luna'}${entry.correlation_id ? ` · ${entry.correlation_id}` : ''} — ${entry.summary}\n`;
  appendFileSync(path, line, 'utf8');
  return path;
}

/**
 * Nota de cliente no Brain (`.brain/clients/<code>/OPINIONES.md`) — o
 * classifier pós-conversa (§27) alimenta. Append-only, assinado.
 */
export function appendClientOpinion(
  clientCode: string,
  note: { date?: string; summary: string; classification: Record<string, unknown> },
  root: string = BRAIN_ROOT,
): string {
  const date = note.date ?? new Date().toISOString().slice(0, 10);
  const dir = join(root, 'clients', clientCode);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'OPINIONES.md');
  if (!existsSync(path)) {
    appendFileSync(path, `# Opiniões — ${clientCode}\n\n> Classificação pós-conversa (§27). Append-only.\n\n`, 'utf8');
  }
  const entry =
    `## ${date} — Luna\n\n${note.summary}\n\n` +
    `\`\`\`json\n${JSON.stringify(note.classification, null, 2)}\n\`\`\`\n\n`;
  appendFileSync(path, entry, 'utf8');
  return path;
}
