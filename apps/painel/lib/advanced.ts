import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, queryDb, type AccessEntry } from './store';
const KERNEL = 'http://127.0.0.1:3458';
const PROMPTS = { whatsapp: path.join(REPO_ROOT, '.kimi-code/agents/luna.md'), caller: path.join(REPO_ROOT, '.luna-config/caller-prompt.md') } as const;
export interface AdvancedTool { name: string; description: string; layer: string }
function atomicWrite(file: string, content: string): void {
  if (!content.trim()) throw new Error('prompt vazio não é permitido');
  if (content.length > 200_000) throw new Error('prompt excede 200 KB');
  const tmp = `${file}.tmp`; fs.writeFileSync(tmp, content, 'utf8'); fs.renameSync(tmp, file);
}
function sourceTools(): AdvancedTool[] {
  const tools: AdvancedTool[] = [];
  for (const source of [
    { file: path.join(REPO_ROOT, 'apps/orchestrator/src/agent/router/tools.ts'), layer: 'WhatsApp · FAST' },
    { file: path.join(REPO_ROOT, 'apps/worker/src/jobs/live-tools.ts'), layer: 'Cérebro LIVE' },
  ]) {
    const content = fs.readFileSync(source.file, 'utf8');
    const re = /['"]([\w.-]+)['"]\s*:\s*\{\s*desc:\s*['"`]([^'"`]+)['"`]/g;
    for (const m of content.matchAll(re)) tools.push({ name: m[1]!, description: m[2]!.replace(/\s+/g, ' ').trim(), layer: source.layer });
  }
  return tools.sort((a, b) => a.layer.localeCompare(b.layer) || a.name.localeCompare(b.name));
}
async function kernelConfig(): Promise<{ prompt: string; online: boolean }> {
  try { const r = await fetch(`${KERNEL}/api/config`, { signal: AbortSignal.timeout(3_000), cache: 'no-store' }); const d = await r.json() as { systemPrompt?: string }; return { prompt: d.systemPrompt ?? '', online: r.ok }; }
  catch { return { prompt: '', online: false }; }
}
export async function getAdvancedConfig() {
  const [kernel, access] = await Promise.all([kernelConfig(), queryDb<AccessEntry>(`SELECT id::text, canonical_name AS name, chat_key AS chat_id, phone_e164, role, note FROM chat_registry WHERE kind='individual' ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'allowed' THEN 1 ELSE 2 END, lower(canonical_name)`)]);
  return { prompts: { whatsapp: fs.readFileSync(PROMPTS.whatsapp, 'utf8'), web: kernel.prompt, caller: fs.readFileSync(PROMPTS.caller, 'utf8') }, kernelOnline: kernel.online, tools: sourceTools(), access, policy: { groupsAllowed: false, unknownContacts: false, defaultRole: 'blocked' } };
}
export async function savePrompt(kind: string, content: string): Promise<void> {
  if (kind === 'whatsapp' || kind === 'caller') return atomicWrite(PROMPTS[kind], content);
  if (kind !== 'web') throw new Error('tipo de prompt inválido');
  const r = await fetch(`${KERNEL}/api/config`, { method: 'POST', signal: AbortSignal.timeout(5_000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ systemPrompt: content }) });
  if (!r.ok) throw new Error(`Luna Kernel recusou o prompt: HTTP ${r.status}`);
}
export async function setAccessRole(id: string, role: string): Promise<void> {
  if (!/^\d+$/.test(id) || !['owner', 'allowed', 'blocked'].includes(role)) throw new Error('entrada ou papel inválido');
  await queryDb('UPDATE chat_registry SET role=$2, resolved_by=$3, note=$4 WHERE id=$1::bigint AND kind=\'individual\'', [id, role, 'luna_painel_advanced', `Papel ${role} definido nas Configs avançadas`]);
}
