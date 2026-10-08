#!/usr/bin/env node
// Vênus — runtime da 2ª mente local (qwen3-coder-30b @ colibri).
// Uso:
//   node scripts/venus/venus.mjs --intro          → gera apresentação e ENVIA no grupo productions
//   node scripts/venus/venus.mjs --pergunta "x"   → turno simples (imprime resposta)
//   node scripts/venus/venus.mjs --tarefa "x"     → turno com tools liberadas
// Fail-closed: allowlist de leitura, guard-rail de saída, segredos nunca no prompt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ENV = path.join(ROOT, '.env');
const COLIBRI = (process.env.VENUS_BASE_URL ?? 'http://127.0.0.1:8000/v1').replace(/\/$/, '');
const MODEL = process.env.VENUS_MODEL ?? 'qwen3-coder-30b-a3b-colibri';
const MAX_ROUNDS = 5;
const PRODUCTIONS_CHAT_ID = '🏆Production - 2026🙏🏻';

// ── env (só DATABASE_URL; nunca logar) ──
function dbUrl() {
  const line = fs.readFileSync(REPO_ENV, 'utf8').split(/\r?\n/).find((l) => /^DATABASE_URL=/.test(l.trim()));
  if (!line) throw new Error('DATABASE_URL não encontrado no .env');
  let url = line.slice(line.indexOf('=') + 1).trim();
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) url = url.slice(1, -1);
  return url;
}
// pg resolve via node_modules do repo (rodar sempre da raiz do luna-agent)
const pg = await import('pg');

// ── allowlist de leitura (fail-closed) ──
const READ_ALLOWED = [
  path.resolve('C:/Users/Abner/principal-brain'),
  path.resolve(ROOT, '.brain'),
  path.resolve(ROOT, 'scripts', 'venus'),
];
const CLIENTES = {
  jess: 'jess-onadance', onadance: 'jess-onadance',
  hdm: 'hdm-industrial', matheus: 'hdm-industrial',
  juninho: 'jr-reformas-juninho', jr: 'jr-reformas-juninho',
};
function readAllowed(caminho) {
  const abs = path.resolve(caminho);
  if (!READ_ALLOWED.some((p) => abs.startsWith(p + path.sep))) return 'ERRO: fora da allowlist de leitura (bloqueado)';
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return 'ERRO: arquivo não existe';
  return fs.readFileSync(abs, 'utf8').slice(0, 12_000);
}

// ── guard-rail de saída (aprendizado do teste Jess 2026-10-08) ──
const PRAZO_RE = /(esta semana|essa semana|nesta semana|te entrego|fica pronto|agendamos|pra (hoje|amanhã)|até (hoje|amanhã|sexta)|deadline)/i;
function guardTexto(texto) {
  if (PRAZO_RE.test(texto)) return 'BLOQUEADO pelo guard-rail: possível promessa de prazo. Reformule sem prometer data.';
  if (texto.length > 900) return 'BLOQUEADO pelo guard-rail: texto acima de 900 chars.';
  return null;
}

// ── colibri ──
async function chat(messages, tools) {
  const res = await fetch(`${COLIBRI}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, tools, temperature: 0, max_tokens: 900 }),
    signal: AbortSignal.timeout(900_000),
  });
  if (!res.ok) throw new Error(`colibri HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ── tools ──
async function db(query, params = []) {
  const c = new pg.Client({ connectionString: dbUrl() });
  await c.connect();
  try { return await c.query(query, params); } finally { await c.end(); }
}
async function sendGroup(chatId, texto) {
  const bloqueio = guardTexto(texto);
  if (bloqueio) {
    logRun({ guard_blocked: texto.slice(0, 200) });
    return bloqueio;
  }
  const conv = await db(
    `SELECT conversation_id FROM messages WHERE metadata->>'chat_id' = $1 AND direction='outbound' ORDER BY created_at DESC LIMIT 1`,
    [chatId],
  );
  if (!conv.rows[0]) return 'ERRO: conversation_id do grupo não encontrada';
  const ins = await db(
    `INSERT INTO messages (conversation_id, direction, channel, sender, body, send_state, metadata)
     VALUES ($1, 'outbound', 'whatsapp', 'agent:venus', $2, 'queued', $3) RETURNING id`,
    [conv.rows[0].conversation_id, texto, JSON.stringify({ source: 'venus', chat_id: chatId })],
  );
  await db(`SELECT pg_notify('luna_outbound', $1)`, [ins.rows[0].id]);
  return `MENSAGEM ENFILEIRADA (id ${ins.rows[0].id}). Guard-rail ok.`;
}
function lerFichaCliente(nome) {
  const pasta = CLIENTES[String(nome).toLowerCase()];
  if (!pasta) return `ERRO: cliente desconhecido. Use um de: ${Object.keys(CLIENTES).join(', ')}`;
  const base = path.join(ROOT, '.brain', 'clientes', pasta);
  return ['CLIENTE.md', 'PEDIDOS.md', 'PROJETOS.md']
    .map((f) => { const c = readAllowed(path.join(base, f)); return `### ${f}\n${typeof c === 'string' && c.startsWith('ERRO:') ? '(ausente)' : c}`.slice(0, 6_500); })
    .join('\n\n');
}
async function perguntarLuna(pergunta, contexto) {
  const prompt = `[TURNO DA VÊNUS — 2ª mente local]\nA Vênus (qwen3-coder-30b local) está executando uma tarefa e precisa do seu julgamento, Luna.\n\nCONTEXTO QUE ELA TEM:\n${String(contexto).slice(0, 1_500)}\n\nPERGUNTA:\n${String(pergunta).slice(0, 1_500)}\n\nResponda direto ao ponto, em PT-BR, como Luna. A resposta fica no turno e ela lê na próxima execução.`;
  const r = await db(
    `INSERT INTO kimiwork_llm_turns (session_key, prompt, channel, idempotency_key) VALUES ($1, $2, 'geral', $3) RETURNING id`,
    [`venus:${Date.now()}`, prompt, `venus-${Date.now()}`],
  );
  return `PERGUNTA REGISTRADA pra Luna (turno ${r.rows[0].id}). Ela responde na próxima varredura — não espere no mesmo turno; registre o que fez e siga.`;
}
function registrarSolicitacao(dadosJson) {
  const dir = path.join(ROOT, '.brain', 'luna', 'venus');
  fs.mkdirSync(dir, { recursive: true });
  let dados;
  try { dados = JSON.parse(dadosJson); } catch { return 'ERRO: JSON inválido'; }
  const linha = JSON.stringify({ ...dados, registrado_por: 'venus', em: new Date().toISOString() });
  fs.appendFileSync(path.join(dir, 'solicitacoes.jsonl'), linha + '\n');
  return 'SOLICITAÇÃO REGISTRADA em .brain/luna/venus/solicitacoes.jsonl';
}

const TOOLS = [
  { type: 'function', function: { name: 'ler_ficha_cliente', description: 'Lê a ficha do cliente no .brain (jess, hdm, juninho)', parameters: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] } } },
  { type: 'function', function: { name: 'ler_brain', description: 'Lê arquivo do principal-brain ou .brain (read-only, allowlist)', parameters: { type: 'object', properties: { caminho: { type: 'string' } }, required: ['caminho'] } } },
  { type: 'function', function: { name: 'perguntar_luna', description: 'Pergunta pra Luna responder na varredura (fila kimiwork_llm_turns)', parameters: { type: 'object', properties: { pergunta: { type: 'string' }, contexto: { type: 'string' } }, required: ['pergunta'] } } },
  { type: 'function', function: { name: 'registrar_solicitacao', description: 'Registra pedido novo de cliente em JSONL local', parameters: { type: 'object', properties: { dados_json: { type: 'string' } }, required: ['dados_json'] } } },
  { type: 'function', function: { name: 'enviar_mensagem_grupo', description: `Envia mensagem SUA em grupo WhatsApp (ex.: ${PRODUCTIONS_CHAT_ID}). Guard-rail valida antes.`, parameters: { type: 'object', properties: { chat_id: { type: 'string' }, texto: { type: 'string' } }, required: ['chat_id', 'texto'] } } },
];
const EXEC = {
  ler_ficha_cliente: async (a) => lerFichaCliente(a.nome),
  ler_brain: async (a) => readAllowed(a.caminho),
  perguntar_luna: perguntarLuna,
  registrar_solicitacao: async (a) => registrarSolicitacao(a.dados_json),
  enviar_mensagem_grupo: (a) => sendGroup(a.chat_id, a.texto),
};

function logRun(extra) {
  const dir = path.join(ROOT, '.brain', 'luna', 'venus');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'runs.jsonl'), JSON.stringify({ em: new Date().toISOString(), ...extra }) + '\n');
}

// ── agent loop ──
async function run(tarefa, { comTools }) {
  const persona = fs.readFileSync(path.join(ROOT, 'scripts', 'venus', 'persona.md'), 'utf8');
  const messages = [
    { role: 'system', content: persona },
    { role: 'user', content: tarefa },
  ];
  for (let rodada = 1; rodada <= MAX_ROUNDS; rodada++) {
    const resp = await chat(messages, comTools ? TOOLS : undefined);
    const msg = resp.choices[0].message;
    if (msg.tool_calls?.length) {
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        const fn = tc.function.name;
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* args inválido → tool erro */ }
        console.log(`  ⚙ rodada ${rodada}: ${fn}(${JSON.stringify(args).slice(0, 120)})`);
        let resultado;
        try { resultado = await EXEC[fn]?.(args) ?? `ERRO: tool desconhecida ${fn}`; }
        catch (e) { resultado = `ERRO na tool: ${e.message}`; }
        messages.push({ role: 'tool', tool_call_id: tc.id, name: fn, content: String(resultado).slice(0, 2_000) });
      }
      continue;
    }
    console.log('\n=== RESPOSTA VÊNUS ===\n' + (msg.content ?? '(vazio)'));
    logRun({ tarefa: tarefa.slice(0, 200), resposta: (msg.content ?? '').slice(0, 2_000), tokens: resp.usage });
    return msg.content ?? '';
  }
  throw new Error(`estourou ${MAX_ROUNDS} rodadas de tool-call`);
}

// ── CLI ──
const [, , cmd, ...rest] = process.argv;
const arg = rest.join(' ');
if (cmd === '--intro') {
  await run(
    `Tarefa: escreva SUA apresentação pro grupo productions da Nexo no WhatsApp e envie com enviar_mensagem_grupo. ` +
    `Conteúdo: quem é a Vênus (2ª mente local da Nexo, roda no PC do owner, custo zero), o que faz, como se divide com a Luna, ` +
    `e como o time pede coisas a você. Tom parceira, direta, leve, com um toque de personalidade. Máx 700 chars. ` +
    `O chat_id do grupo é: ${PRODUCTIONS_CHAT_ID}. Assine como Vênus.`,
    { comTools: true },
  );
} else if (cmd === '--pergunta' && arg) {
  await run(arg, { comTools: false });
} else if (cmd === '--tarefa' && arg) {
  await run(arg, { comTools: true });
} else {
  console.log('Uso: node scripts/venus/venus.mjs --intro | --pergunta "x" | --tarefa "x"');
  process.exit(1);
}
