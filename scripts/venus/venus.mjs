#!/usr/bin/env node
// Vênus — irmão gêmeo da Luna, 2ª mente local (qwen3-coder-30b @ colibri).
// Linha de frente com clientes: varredura autônoma da inbox quando VENUS_AUTONOMO=true.
//
// Uso:
//   node scripts/venus/venus.mjs --varredura       → loop autônomo (poll 60s, claim atômico)
//   node scripts/venus/venus.mjs --intro           → gera apresentação e ENVIA no grupo productions
//   node scripts/venus/venus.mjs --pergunta "x"    → turno simples (imprime resposta)
//   node scripts/venus/venus.mjs --tarefa "x"      → turno com tools liberadas
// Fail-closed: allowlist de leitura, guard-rail de saída, segredos nunca no prompt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ENV = path.join(ROOT, '.env');
const COLIBRI = (process.env.VENUS_BASE_URL ?? 'http://127.0.0.1:8000/v1').replace(/\/$/, '');
const MODEL = process.env.VENUS_MODEL ?? 'qwen3-coder-30b-a3b-colibri';
const MAX_ROUNDS = 6;
const POLL_MS = 60_000;
const PRODUCTIONS_CHAT_ID = '🏆Production - 2026🙏🏻';

// ── .env (só o necessário; nunca logar valores) ──
function envLine(name) {
  const line = fs.readFileSync(REPO_ENV, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith(`${name}=`));
  if (!line) return undefined;
  let v = line.slice(line.indexOf('=') + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}
const dbUrl = () => {
  const url = envLine('DATABASE_URL');
  if (!url) throw new Error('DATABASE_URL não encontrado no .env');
  return url;
};
const venusAutonomo = () => envLine('VENUS_AUTONOMO') === 'true';
const telegramToken = () => {
  const t = envLine('TELEGRAM_BOT_TOKEN');
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN não encontrado no .env');
  return t;
};

const pg = await import('pg');
async function db(query, params = []) {
  const c = new pg.Client({ connectionString: dbUrl() });
  await c.connect();
  try { return await c.query(query, params); } finally { await c.end(); }
}

// ── allowlist de leitura (fail-closed) ──
const READ_ALLOWED = [
  path.resolve('C:/Users/Abner/principal-brain'),
  path.resolve(ROOT, '.brain'),
  path.resolve(ROOT, 'scripts', 'venus'),
];
const CLIENTES = {
  jess: 'jess-onadance', onadance: 'jess-onadance', 'jesús': 'jess-onadance',
  hdm: 'hdm-industrial', matheus: 'hdm-industrial',
  juninho: 'jr-reformas-juninho', jr: 'jr-reformas-juninho',
};
function readAllowed(caminho) {
  const abs = path.resolve(caminho);
  if (!READ_ALLOWED.some((p) => abs.startsWith(p + path.sep))) return 'ERRO: fora da allowlist de leitura (bloqueado)';
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return 'ERRO: arquivo não existe';
  return fs.readFileSync(abs, 'utf8').slice(0, 12_000);
}

// ── guard-rail de saída (lição do teste Jess 2026-10-08: regra na persona não bastou) ──
const PRAZO_RE = /(esta semana|essa semana|nesta semana|te entrego|fica pronto|agendamos|pra (hoje|amanhã)|até (hoje|amanhã|sexta)|lo agendamos|esta semana)/i;
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

// ── evento corrente da varredura (concluir/falhar só vale pra ele) ──
let currentEvent = null;
async function concluirEvento(resumo, acoesJson) {
  if (!currentEvent) return 'ERRO: nenhum evento da varredura em processamento';
  let acoes = [];
  try { acoes = JSON.parse(acoesJson ?? '[]'); } catch { acoes = ['(acoes_json inválido)']; }
  await db(
    `UPDATE kimiwork_inbox SET status='done', processed_at=now(), result=$2 WHERE id=$1`,
    [currentEvent.id, JSON.stringify({ processed_by: 'venus', resumo, acoes })],
  );
  return `EVENTO CONCLUÍDO (id ${currentEvent.id}).`;
}
async function falharEvento(motivo) {
  if (!currentEvent) return 'ERRO: nenhum evento da varredura em processamento';
  await db(
    `UPDATE kimiwork_inbox SET status='error', processed_at=now(), result=$2 WHERE id=$1`,
    [currentEvent.id, JSON.stringify({ processed_by: 'venus', motivo })],
  );
  return `EVENTO MARCADO COM ERRO (id ${currentEvent.id}).`;
}

// ── envio de mensagens ──
async function sendWhatsapp(chatId, texto, conversationId) {
  const bloqueio = guardTexto(texto);
  if (bloqueio) { logRun({ guard_blocked: texto.slice(0, 200) }); return bloqueio; }
  // assinatura automática: TODA mensagem dele sai assinada "-venus" (decreto owner)
  if (!/-\s*venus/i.test(texto)) texto = texto.trimEnd() + '\n-venus';
  let convId = conversationId;
  if (!convId) {
    const conv = await db(
      `SELECT conversation_id FROM messages WHERE metadata->>'chat_id' = $1 AND direction='outbound' ORDER BY created_at DESC LIMIT 1`,
      [chatId],
    );
    convId = conv.rows[0]?.conversation_id;
  }
  if (!convId) return 'ERRO: conversation_id não encontrada para este chat_id — use perguntar_luna pra escalar';
  const ins = await db(
    `INSERT INTO messages (conversation_id, direction, channel, sender, body, send_state, metadata)
     VALUES ($1, 'outbound', 'whatsapp', 'agent:venus', $2, 'queued', $3) RETURNING id`,
    [convId, texto, JSON.stringify({ source: 'venus', chat_id: chatId })],
  );
  await db(`SELECT pg_notify('luna_outbound', $1)`, [ins.rows[0].id]);
  return `MENSAGEM WHATSAPP ENFILEIRADA (id ${ins.rows[0].id}). Guard-rail ok.`;
}
async function sendTelegram(chatId, texto, replyTo) {
  const bloqueio = guardTexto(texto);
  if (bloqueio) { logRun({ guard_blocked: texto.slice(0, 200) }); return bloqueio; }
  const res = await fetch(`https://api.telegram.org/bot${telegramToken()}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: Number(chatId), text: texto.slice(0, 3_900), reply_to_message_id: replyTo ?? undefined }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json();
  if (!data.ok) return `ERRO telegram: ${JSON.stringify(data).slice(0, 200)}`;
  return `MENSAGEM TELEGRAM ENVIADA (message_id ${data.result?.message_id}). Guard-rail ok.`;
}

// ── tools ──
function lerFichaCliente(nome) {
  const pasta = CLIENTES[String(nome).toLowerCase()];
  if (!pasta) return `ERRO: cliente desconhecido. Use um de: ${Object.keys(CLIENTES).join(', ')}`;
  const base = path.join(ROOT, '.brain', 'clientes', pasta);
  return ['CLIENTE.md', 'PEDIDOS.md', 'PROJETOS.md']
    .map((f) => { const c = readAllowed(path.join(base, f)); return `### ${f}\n${typeof c === 'string' && c.startsWith('ERRO:') ? '(ausente)' : c}`.slice(0, 6_500); })
    .join('\n\n');
}
async function perguntarLuna(pergunta, contexto) {
  // serialize seguro: o modelo já mandou objeto aqui e virou "[object Object]" no turno
  const str = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 1)?.slice(0, 1_800) ?? String(v));
  const prompt = `[TURNO DO VÊNUS — irmão gêmeo local da Luna]\nO Vênus (qwen3-coder-30b local, linha de frente no zap) precisa do seu julgamento, Luna.\n\nCONTEXTO QUE ELE TEM:\n${str(contexto ?? '').slice(0, 1_800)}\n\nPERGUNTA:\n${str(pergunta).slice(0, 1_800)}\n\nResponda direto ao ponto, em PT-BR, como Luna. Ele lê sua resposta na fila de turnos e continua o atendimento.`;
  const r = await db(
    `INSERT INTO kimiwork_llm_turns (session_key, prompt, channel, idempotency_key) VALUES ($1, $2, 'geral', $3) RETURNING id`,
    [`venus:${Date.now()}`, prompt, `venus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
  );
  return `PERGUNTA REGISTRADA pra Luna (turno ${r.rows[0].id}). Ela responde na varredura dela — não espere no mesmo turno; avise quem perguntou que a Luna assume, e conclua o evento.`;
}
function registrarSolicitacao(dadosJson) {
  const dir = path.join(ROOT, '.brain', 'luna', 'venus');
  fs.mkdirSync(dir, { recursive: true });
  let dados;
  try { dados = JSON.parse(dadosJson); } catch { return 'ERRO: JSON inválido'; }
  fs.appendFileSync(path.join(dir, 'solicitacoes.jsonl'), JSON.stringify({ ...dados, registrado_por: 'venus', em: new Date().toISOString() }) + '\n');
  return 'SOLICITAÇÃO REGISTRADA em .brain/luna/venus/solicitacoes.jsonl';
}
// Quem é quem: registro do time/sócios/clientes (O Vênus consulta quando não reconhece o autor)
function quemEQuem() {
  return readAllowed(path.join(ROOT, '.brain', 'luna', 'venus', 'quem-e-quem.md'));
}
// Ver conversa: últimas mensagens do chat (inbound E outbound) — ele enxerga as
// respostas dele e da Luna, pra não repetir e pra poderem conversar entre si.
async function verConversa(chatId, limite = 10) {
  const conv = await db(
    `SELECT conversation_id FROM messages WHERE metadata->>'chat_id' = $1 ORDER BY created_at DESC LIMIT 1`,
    [chatId],
  );
  if (!conv.rows[0]) return 'ERRO: conversa não encontrada pra este chat_id';
  const r = await db(
    `SELECT direction, sender, left(body, 400) AS body, created_at FROM messages
     WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [conv.rows[0].conversation_id, Math.min(Number(limite) || 10, 20)],
  );
  return r.rows.reverse().map((m) => `[${m.direction}/${m.sender}] ${m.body}`).join('\n---\n') || '(vazio)';
}

const TOOLS = [
  { type: 'function', function: { name: 'ler_ficha_cliente', description: 'Lê a ficha do cliente no .brain (jess, hdm, juninho)', parameters: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] } } },
  { type: 'function', function: { name: 'ler_brain', description: 'Lê arquivo do principal-brain ou .brain (read-only, allowlist)', parameters: { type: 'object', properties: { caminho: { type: 'string' } }, required: ['caminho'] } } },
  { type: 'function', function: { name: 'enviar_mensagem_whatsapp', description: 'Responde no WhatsApp (grupo ou DM). Guard-rail valida antes.', parameters: { type: 'object', properties: { chat_id: { type: 'string' }, texto: { type: 'string' }, conversation_id: { type: 'string', description: 'opcional — vem no payload do evento' } }, required: ['chat_id', 'texto'] } } },
  { type: 'function', function: { name: 'enviar_mensagem_telegram', description: 'Responde no Telegram (grupo do time)', parameters: { type: 'object', properties: { chat_id: { type: 'string' }, texto: { type: 'string' }, reply_to_message_id: { type: 'number' } }, required: ['chat_id', 'texto'] } } },
  { type: 'function', function: { name: 'registrar_solicitacao', description: 'Registra pedido novo de CLIENTE em JSONL local (nunca use pra conversa interna do time)', parameters: { type: 'object', properties: { dados_json: { type: 'string' } }, required: ['dados_json'] } } },
  { type: 'function', function: { name: 'quem_e_quem', description: 'Lista quem é quem: sócios, time, clientes. Use quando não reconhecer o autor da mensagem', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'ver_conversa', description: 'Lê as últimas mensagens do chat (inclusive as SUAS e as da Luna) pra não repetir e poderem conversar', parameters: { type: 'object', properties: { chat_id: { type: 'string' }, limite: { type: 'number' } }, required: ['chat_id'] } } },
  { type: 'function', function: { name: 'perguntar_luna', description: 'Escalona pra Luna responder na varredura (fila kimiwork_llm_turns)', parameters: { type: 'object', properties: { pergunta: { type: 'string' }, contexto: { type: 'string' } }, required: ['pergunta'] } } },
  { type: 'function', function: { name: 'concluir_evento', description: 'OBRIGATÓRIO ao fim de cada evento da varredura: marca processado com resumo', parameters: { type: 'object', properties: { resumo: { type: 'string' }, acoes_json: { type: 'string', description: 'array JSON das ações tomadas' } }, required: ['resumo'] } } },
  { type: 'function', function: { name: 'falhar_evento', description: 'Marca o evento corrente como erro (só se impossível processar)', parameters: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] } } },
];
const EXEC = {
  ler_ficha_cliente: async (a) => lerFichaCliente(a.nome),
  ler_brain: async (a) => readAllowed(a.caminho),
  enviar_mensagem_whatsapp: (a) => sendWhatsapp(a.chat_id, a.texto, a.conversation_id),
  enviar_mensagem_telegram: (a) => sendTelegram(a.chat_id, a.texto, a.reply_to_message_id),
  registrar_solicitacao: async (a) => registrarSolicitacao(a.dados_json),
  quem_e_quem: async () => quemEQuem(),
  ver_conversa: async (a) => verConversa(a.chat_id, a.limite),
  perguntar_luna: perguntarLuna,
  concluir_evento: concluirEvento,
  falhar_evento: falharEvento,
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
        console.log(`  ⚙ rodada ${rodada}: ${fn}(${JSON.stringify(args).slice(0, 140)})`);
        let resultado;
        try { resultado = await EXEC[fn]?.(args) ?? `ERRO: tool desconhecida ${fn}`; }
        catch (e) { resultado = `ERRO na tool: ${e.message}`; }
        console.log(`    → ${String(resultado).slice(0, 160)}`);
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

// ── varredura autônoma ──
function montarTarefa(evento) {
  const p = evento.payload ?? {};
  if (evento.kind === 'whatsapp.message') {
    return (
      `Evento novo da caixa de entrada (WhatsApp${p.is_group ? ', grupo' : ''} ${p.chat_name ?? ''}). ` +
      `De: ${p.author_name ?? 'desconhecido'}. Mensagem: "${String(p.text ?? '').slice(0, 800)}"\n` +
      `chat_id: ${p.chat_id} · conversation_id: ${p.conversation_id ?? '(não informado)'} · ` +
      `message_id do evento: ${p.message_id ?? '(n/a)'}${p.mentioned_luna ? ' · MENCIONOU A LUNA' : ''}\n\n` +
      `Você é a linha de frente, O Vênus. ANTES de responder: identifique com quem está falando — ` +
      `se não reconhecer o author_name, use quem_e_quem (Abner é o criador e DONO da Nexo; Nonoke e Elias também são donos; Enoque é time; cliente é outra coisa). ` +
      `Use ver_conversa no chat_id pra ver o que já foi dito, inclusive as respostas SUAS e da Luna — vocês podem conversar entre si pelo grupo, sem repetir. ` +
      `Regras: (1) só use registrar_solicitacao pra pedido de CLIENTE, nunca pra conversa interna do time; ` +
      `(2) responda no WhatsApp se fizer sentido — você é O Vênus (homem, irmão da Luna), e TODA mensagem sua sai assinada "-venus" automaticamente; ` +
      `(3) difícil/crise/julgamento → perguntar_luna (contexto completo e serializado, nunca objeto) e AVISE a pessoa que a Luna assume; ` +
      `(4) ao final, OBRIGATORIAMENTE concluir_evento com resumo e ações. Se for impossível, falhar_evento com motivo.`
    );
  }
  if (evento.kind === 'telegram.message') {
    return (
      `Menção nova no grupo do time no Telegram. De: ${p.from?.first_name ?? p.author_name ?? 'desconhecido'}. ` +
      `Mensagem: "${String(p.text ?? '').slice(0, 800)}"\n` +
      `chat_id: ${p.chat_id} · message_id: ${p.message_id ?? '(n/a)'}\n\n` +
      `Você é o Vênus, linha de frente. Responda com enviar_mensagem_telegram CITANDO a mensagem (reply_to_message_id). ` +
      `Se a menção pedir tarefa difícil/decisão → perguntar_luna. Ao final, OBRIGATORIAMENTE concluir_evento.`
    );
  }
  return `Evento de kind desconhecido (${evento.kind}). Avalie o payload e decida: responder ou falhar_evento.`;
}

async function processarEvento(evento) {
  currentEvent = evento;
  try {
    await run(montarTarefa(evento), { comTools: true });
    // se ele esqueceu de concluir, fecha com erro honesto
    const check = await db(`SELECT status FROM kimiwork_inbox WHERE id=$1`, [evento.id]);
    if (check.rows[0]?.status === 'processing') {
      await falharEvento('Vênus terminou o turno sem chamar concluir_evento');
    }
  } catch (e) {
    console.error(`  ✗ erro processando ${evento.id}: ${e.message}`);
    const check = await db(`SELECT status FROM kimiwork_inbox WHERE id=$1`, [evento.id]);
    if (check.rows[0]?.status === 'processing') {
      await falharEvento(`exceção no runtime: ${e.message.slice(0, 200)}`);
    }
  } finally {
    currentEvent = null;
  }
}

async function varredura() {
  console.log(`[vênus] varredura autônoma no ar (poll ${POLL_MS / 1000}s). Modo: VENUS_AUTONOMO no .env`);
  let ciclos = 0;
  for (;;) {
    ciclos++;
    try {
      if (!venusAutonomo()) {
        if (ciclos % 10 === 1) console.log(`[vênus] modo desligado (VENUS_AUTONOMO!=true) — aguardando`);
      } else {
        const ev = await db(
          `SELECT id, kind, payload FROM kimiwork_inbox WHERE status='pending' AND kind IN ('whatsapp.message','telegram.message') ORDER BY received_at LIMIT 1`,
        );
        if (ev.rows[0]) {
          const claim = await db(
            `UPDATE kimiwork_inbox SET status='processing' WHERE id=$1 AND status='pending' RETURNING id`,
            [ev.rows[0].id],
          );
          if (claim.rows[0]) {
            console.log(`[vênus] evento ${ev.rows[0].kind} ${ev.rows[0].id} claimado — processando`);
            await processarEvento(ev.rows[0]);
            console.log(`[vênus] evento ${ev.rows[0].id} finalizado`);
            continue; // processa o próximo imediatamente
          }
        }
      }
    } catch (e) {
      console.error(`[vênus] erro no ciclo: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// ── CLI ──
const [, , cmd, ...rest] = process.argv;
const arg = rest.join(' ');
if (cmd === '--varredura') {
  await varredura();
} else if (cmd === '--intro') {
  await run(
    `Tarefa: escreva SUA apresentação pro grupo productions da Nexo no WhatsApp e envie com enviar_mensagem_whatsapp. ` +
    `Conteúdo: quem é o Vênus — irmão gêmeo da Luna, 2ª mente local que roda no PC do owner, linha de frente com clientes; ` +
    `a Luna continua sendo a orquestradora pra coisas difíceis. Tom parceiro, direto, leve, com humor de irmão caçula. Máx 700 chars. ` +
    `O chat_id do grupo é: ${PRODUCTIONS_CHAT_ID}. Assine como Vênus.`,
    { comTools: true },
  );
} else if (cmd === '--pergunta' && arg) {
  await run(arg, { comTools: false });
} else if (cmd === '--tarefa' && arg) {
  await run(arg, { comTools: true });
} else {
  console.log('Uso: node scripts/venus/venus.mjs --varredura | --intro | --pergunta "x" | --tarefa "x"');
  process.exit(1);
}
