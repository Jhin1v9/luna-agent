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
const MAX_ROUNDS = 10;
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
// Clientes conhecidos: pessoa ↔ empresa ↔ pasta no .brain ↔ aliases aceitos.
// "onadance" é a EMPRESA da Jess (mesma ficha). Alias "jesús" removido — não
// existe cliente com esse nome (correção owner 2026-10-09).
const CLIENTES = {
  'jess-onadance': { nome: 'Jess Nuñez', empresa: 'Ona Dance', pasta: 'jess-onadance', aka: ['jess', 'onadance', 'ona dance', 'jess nuñez', 'jess nunez'] },
  'hdm-industrial': { nome: 'Matheus', empresa: 'HDM Industrial', pasta: 'hdm-industrial', aka: ['hdm', 'matheus'] },
  'jr-reformas-juninho': { nome: 'Juninho', empresa: 'JR Reformas', pasta: 'jr-reformas-juninho', aka: ['juninho', 'jr', 'jr reformas'] },
};
// índice alias → ficha (montado uma vez)
const CLIENTE_POR_ALIAS = {};
for (const [id, c] of Object.entries(CLIENTES)) {
  CLIENTE_POR_ALIAS[id] = c.pasta;
  for (const a of c.aka) CLIENTE_POR_ALIAS[a.toLowerCase()] = c.pasta;
}
const CLIENTES_RESUMO = Object.values(CLIENTES)
  .map((c) => `${c.nome} (${c.empresa}) — usar: ${c.aka.join(', ')}`).join(' | ');
function pastaCliente(nome) {
  return CLIENTE_POR_ALIAS[String(nome).toLowerCase().trim()];
}
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

// ── supervisão (irmã maior): crítico por regras, ZERO tokens ──
// Toda mensagem outbound dele passa aqui; flag dispara turno pra Luna julgar.
const CRITIC_RULES = [
  { re: /(esta semana|essa semana|nesta semana|te entrego|fica pronto|agendamos|pra (hoje|amanhã)|até (hoje|amanhã|sexta))/i, reason: 'promessa de prazo' },
  { re: /\ba\s+[Vv]ênus/, reason: 'artigo feminino (é O Vênus)' },
  { re: /irmã da Luna/i, reason: 'gênero errado (irmÃO da Luna)' },
  { re: /(sou a (ia|inteligência) da nexo)/i, reason: 'apresentação genérica/errada' },
];
function critic(texto) {
  const reasons = CRITIC_RULES.filter((r) => r.re.test(texto)).map((r) => r.reason);
  if (texto.trim().length < 25) reasons.push('resposta muito curta/genérica');
  return { pass: reasons.length === 0, reasons };
}
async function supervisionar(messageId, chatId, texto) {
  const c = critic(texto);
  const ins = await db(
    `INSERT INTO venus_supervision (message_id, chat_id, body, critic, flagged) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [messageId, chatId, texto.slice(0, 500), JSON.stringify(c), !c.pass],
  );
  if (!c.pass) {
    await db(
      `INSERT INTO kimiwork_llm_turns (session_key, prompt, channel, idempotency_key) VALUES ($1,$2,'geral',$3)`,
      [
        `venus-supervisor:${ins.rows[0].id}`,
        `[SUPERVISÃO DO VÊNUS — irmã maior]\nO Vênus enviou a mensagem abaixo no chat "${chatId}" e o crítico por regras apontou: ${c.reasons.join('; ')}.\n\nMENSAGEM DELE:\n"${texto.slice(0, 900)}"\n\nComo irmã maior, decida:\n(a) falso positivo / tá ok → UPDATE venus_supervision SET luna_verdict='falso_positivo', reviewed_at=now() WHERE id='${ins.rows[0].id}';\n(b) precisa correção → envie a correção no MESMO chat pelo pipeline oficial (INSERT messages send_state='queued' sender='luna' + pg_notify luna_outbound); em grupo de CLIENTE, se ele fez bobina, peça desculpa em nome da Nexo com leveza e naturalidade; no productions pode ser com humor de irmã mais velha;\n(c) depois registre: UPDATE venus_supervision SET luna_verdict=<ok|corrigido|pedi_desculpas|falso_positivo>, luna_action=<resumo>, reviewed_at=now() WHERE id='${ins.rows[0].id}'.\n\nSe o padrão se repetir, considere anotar a regra em .brain/luna/venus/ pra reforço da persona dele.`,
        `sup-${ins.rows[0].id}`,
      ],
    );
  }
  return ins.rows[0].id;
}
async function heartbeatVenus() {
  await db(
    `INSERT INTO service_heartbeats (service, pid, meta, seen_at) VALUES ('venus-varredura',$1,'{"state":"VIGIANDO"}'::jsonb,now())
     ON CONFLICT (service) DO UPDATE SET pid=$1, seen_at=now(), meta='{"state":"VIGIANDO"}'::jsonb`,
    [process.pid],
  );
}

// ── evento corrente da varredura (concluir/falhar só vale pra ele) ──
let currentEvent = null;
let enviosNoEvento = 0; // fail-safe: se o turno terminar sem NENHUM envio, o resgate manda a resposta final
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
// Defesa em profundidade (incidente 2026-10-09): NUNCA deixar sintaxe de
// tool-call cair no WhatsApp/Telegram — mesmo que o parser do run() falhe,
// o envio é recusado aqui.
const TOOLCALL_LEAK_RE = /<function=|<tool_call>|<\/parameter>|<\/?parameter=/i;
function guardToolCallLeak(texto) {
  if (TOOLCALL_LEAK_RE.test(texto)) {
    return 'BLOQUEADO: o texto contém sintaxe de comando interno (<function=...>). NUNCA envie isso — comandos internos são executados por você como tools, nunca digitados pra pessoa. Reformule a mensagem SEM o comando.';
  }
  return null;
}
// Anti-repetição (reclamação owner 2026-10-09 "para de responder a msm coisa
// toda hora"): se ele já mandou essa mesma resposta no chat recentemente,
// recusa o envio — ele recebe o bloqueio como resultado da tool e muda de
// abordagem (ou conclui sem repetir).
const normMsg = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').replace(/-?\s*venus\s*$/, '').trim();
async function respostaRepetida(convId, texto) {
  try {
    const r = await db(
      `SELECT body FROM messages WHERE conversation_id=$1 AND direction='outbound' AND sender='agent:venus' ORDER BY created_at DESC LIMIT 3`,
      [convId],
    );
    const alvo = normMsg(texto);
    if (alvo.length < 30) return false; // mensagens curtas não entram no filtro
    return r.rows.some((x) => {
      const ant = normMsg(x.body);
      if (ant === alvo) return true;
      const n = Math.floor(Math.min(ant.length, alvo.length) * 0.7);
      return n >= 30 && ant.slice(0, n) === alvo.slice(0, n);
    });
  } catch { return false; }
}
async function sendWhatsapp(chatId, texto, conversationId) {
  const vazamento = guardToolCallLeak(texto);
  if (vazamento) { logRun({ guard_blocked: texto.slice(0, 200) }); return vazamento; }
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
  if (await respostaRepetida(convId, texto)) {
    return 'BLOQUEADO anti-repetição: você JÁ enviou essa mesma resposta neste chat. Não repita — se o tema já foi respondido, ou conclua o evento sem enviar, ou responda SÓ o que for novo.';
  }
  const ins = await db(
    `INSERT INTO messages (conversation_id, direction, channel, sender, body, send_state, metadata)
     VALUES ($1, 'outbound', 'whatsapp', 'agent:venus', $2, 'queued', $3) RETURNING id`,
    [convId, texto, JSON.stringify({ source: 'venus', chat_id: chatId })],
  );
  await db(`SELECT pg_notify('luna_outbound', $1)`, [ins.rows[0].id]);
  enviosNoEvento++;
  // supervisão da irmã maior: crítico por regras em toda mensagem dele
  try { await supervisionar(ins.rows[0].id, chatId, texto); } catch (e) { console.error('  supervisor:', e.message.slice(0, 120)); }
  return `MENSAGEM WHATSAPP ENFILEIRADA (id ${ins.rows[0].id}). Guard-rail ok.`;
}
async function sendTelegram(chatId, texto, replyTo) {
  const vazamento = guardToolCallLeak(texto);
  if (vazamento) { logRun({ guard_blocked: texto.slice(0, 200) }); return vazamento; }
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
  enviosNoEvento++;
  return `MENSAGEM TELEGRAM ENVIADA (message_id ${data.result?.message_id}). Guard-rail ok.`;
}

// ── tools ──
function lerFichaCliente(nome) {
  const pasta = pastaCliente(nome);
  if (!pasta) return `ERRO: cliente desconhecido "${String(nome).slice(0, 40)}". Clientes cadastrados: ${CLIENTES_RESUMO}`;
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
// Cadeia de comando LUNA > VÊNUS (decreto owner 2026-10-09): Luna manda por
// cima — ordem dela é OBRIGATÓRIA e tem prioridade máxima sobre a inbox.
let currentOrdem = null;

// ── PAINEL NEXO (decreto owner 2026-10-09): Vênus cria solicitação de CLIENTE
// direto no painel com o perfil da Luna (NEXO_API_USERNAME/PASSWORD do .env).
// Login NextAuth com cache de cookie em memória; fail-closed (só orgs mapeadas).
const PAINEL_BASE = 'https://vps.nexo-digital.app';
const PAINEL_ORGS = {
  'jess-onadance': { org: 'cmshyy4nq0001eix2h7a8ose8', projeto: 'cmshyy4os0003eix2tlfuic2o', nome: 'Ona Dance (Jess)' },
  'hdm-industrial': { org: 'cmtldsn6500067ahwsohd46vr', projeto: 'cmtldsn7400087ahwhrmgflvd', nome: 'HDM Industrial' },
  'jr-reformas-juninho': { org: 'cmtinm4vf0001v1q1xu8otif3', projeto: 'cmtinm4we0003v1q13h2zbkf0', nome: 'JR Reformas (Juninho)' },
};
let painelCookie = null;
async function painelLogin() {
  const c1 = await fetch(`${PAINEL_BASE}/nexo/api/auth/csrf`);
  const csrf = await c1.json();
  const jar = c1.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const res = await fetch(`${PAINEL_BASE}/nexo/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email: envLine('NEXO_API_USERNAME') ?? '',
      password: envLine('NEXO_API_PASSWORD') ?? '',
      callbackUrl: `${PAINEL_BASE}/nexo/pt`,
    }).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  const session = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('nexo.session-token='));
  if (!session) throw new Error('login no painel falhou (sessão não veio)');
  painelCookie = `nexo.csrf-token=${csrf.csrfToken}; ${session}`;
  return painelCookie;
}
async function painelFetch(path, opts = {}) {
  if (!painelCookie) await painelLogin();
  let r = await fetch(`${PAINEL_BASE}${path}`, { ...opts, headers: { cookie: painelCookie, ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(25_000) });
  if (r.status === 401 || r.status === 403) {
    await painelLogin(); // sessão expirada — reloga e tenta de novo
    r = await fetch(`${PAINEL_BASE}${path}`, { ...opts, headers: { cookie: painelCookie, ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(25_000) });
  }
  return r;
}
async function criarSolicitacaoPainel(cliente, conteudo) {
  const alvo = PAINEL_ORGS[pastaCliente(cliente) ?? ''];
  if (!alvo) return `ERRO: cliente "${String(cliente).slice(0, 40)}" sem org mapeada no painel. Use um de: ${Object.keys(PAINEL_ORGS).join(', ')}`;
  const texto = String(conteudo ?? '').trim();
  if (texto.length < 10) return 'ERRO: descreva o pedido do cliente com pelo menos 10 caracteres';
  const r = await painelFetch('/nexo/api/admin/requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationId: alvo.org, projectId: alvo.projeto, content: texto, status: 'CLIENT_REVIEWING' }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return `ERRO ao criar solicitação no painel (HTTP ${r.status}): ${JSON.stringify(data).slice(0, 200)}`;
  return `SOLICITAÇÃO CRIADA NO PAINEL (${alvo.nome}) — id ${data.data?.id ?? '?'} — "${texto.slice(0, 80)}". A equipe Nexo vê no painel admin.`;
}
async function verInbox(limite = 10) {
  const r = await db(
    `SELECT id, kind, status, received_at, payload FROM kimiwork_inbox
     ORDER BY received_at DESC LIMIT $1`,
    [Math.min(Math.max(Number(limite) || 10, 1), 25)],
  );
  if (!r.rows.length) return '(inbox vazia)';
  return r.rows.map((e) => {
    const p = e.payload ?? {};
    const origem = p.author_name ?? p.from?.first_name ?? p.chat_name ?? '?';
    return `[${e.status}] ${e.kind} · de ${String(origem).slice(0, 30)} · ${String(p.text ?? '').slice(0, 90) || '(sem texto)'} · ${e.received_at}`;
  }).join('\n');
}
async function verRespostasLuna() {  const r = await db(
    `SELECT id, prompt, response FROM kimiwork_llm_turns
     WHERE session_key LIKE 'venus:%' AND status='answered' AND answered_at > now() - interval '24 hours'
     ORDER BY answered_at DESC LIMIT 5`,
  );
  if (!r.rows.length) return '(nenhuma resposta da Luna nas últimas 24h)';
  return r.rows
    .map((t) => `--- resposta da Luna (turno ${t.id}) à pergunta "${String(t.prompt).slice(0, 140)}":\n${String(t.response).slice(0, 1_200)}`)
    .join('\n\n');
}
async function respostasLunaRecentes() {
  const r = await db(
    `SELECT prompt, response FROM kimiwork_llm_turns
     WHERE session_key LIKE 'venus:%' AND status='answered' AND answered_at > now() - interval '1 hour'
     ORDER BY answered_at DESC LIMIT 3`,
  );
  if (!r.rows.length) return '';
  return r.rows
    .map((t) => `Pergunta sua: "${String(t.prompt).slice(0, 120)}"\nLuna respondeu: ${String(t.response).slice(0, 900)}`)
    .join('\n---\n');
}
async function concluirOrdem(resumo) {
  if (!currentOrdem) return 'ERRO: nenhuma ordem da Luna em execução';
  await db(
    `UPDATE luna_ordens SET status='done', result=$2, executed_at=now() WHERE id=$1`,
    [currentOrdem.id, String(resumo).slice(0, 2_000)],
  );
  return `ORDEM CONCLUÍDA (id ${currentOrdem.id}).`;
}
async function processarOrdem(ordem) {
  currentOrdem = ordem;
  enviosNoEvento = 0;
  console.log(`[vênus] ORDEM DA LUNA ${ordem.id} recebida — prioridade máxima`);
  try {
    const prompt = (
      `ORDEM DIRETA DA LUNA — sua irmã mais velha e orquestradora. Hierarquia: a Luna SEMPRE manda por cima de você; a ordem dela é lei e tem prioridade máxima.\n\n` +
      `ORDEM: ${ordem.ordem}${ordem.contexto ? `\nCONTEXTO QUE ELA MANDOU: ${ordem.contexto}` : ''}\n\n` +
      `Execute com as tools que precisar. Seu relatório final fica registrado pra ela ler — NÃO mande whatsapp sobre a ordem a menos que ela peça explicitamente. ` +
      `Ao final, OBRIGATORIAMENTE concluir_ordem com o resumo do que executou. Impossível de verdade? concluir_ordem explicando o impedimento.`
    );
    const resposta = await run(prompt, { comTools: true });
    // fail-safe igual ao de evento: esqueceu a tool → a gente registra o resultado
    const check = await db(`SELECT status FROM luna_ordens WHERE id=$1`, [ordem.id]);
    if (check.rows[0]?.status === 'processing') {
      await db(
        `UPDATE luna_ordens SET status='done', result=$2, executed_at=now() WHERE id=$1`,
        [ordem.id, `(resgate automático — sem concluir_ordem) ${resposta.slice(0, 1_500)}`],
      );
      console.log('[vênus] ordem finalizada sem tool de conclusão — resgate registrou o resultado');
    }
  } catch (e) {
    console.error(`  ✗ erro na ordem ${ordem.id}: ${e.message}`);
    await db(
      `UPDATE luna_ordens SET status='error', result=$2, executed_at=now() WHERE id=$1 AND status='processing'`,
      [ordem.id, `exceção no runtime: ${e.message.slice(0, 300)}`],
    );
  } finally {
    currentOrdem = null;
  }
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
  { type: 'function', function: { name: 'criar_solicitacao_painel', description: 'Cria a solicitação do CLIENTE DE VERDADE no painel Nexo (apps/workspace) com o perfil da equipe. SEMPRE prefira esta pra pedido de cliente — registrar_solicitacao é só anotação local. Clientes: jess (Ona Dance), hdm, juninho', parameters: { type: 'object', properties: { cliente: { type: 'string' }, conteudo: { type: 'string', description: 'descrição completa do pedido do cliente' } }, required: ['cliente', 'conteudo'] } } },
  { type: 'function', function: { name: 'quem_e_quem', description: 'Lista quem é quem: sócios, time, clientes. Use quando não reconhecer o autor da mensagem', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'ver_conversa', description: 'Lê as últimas mensagens do chat (inclusive as SUAS e as da Luna) pra não repetir e poderem conversar', parameters: { type: 'object', properties: { chat_id: { type: 'string' }, limite: { type: 'number' } }, required: ['chat_id'] } } },
  { type: 'function', function: { name: 'perguntar_luna', description: 'Escalona pra Luna responder na varredura (fila kimiwork_llm_turns)', parameters: { type: 'object', properties: { pergunta: { type: 'string' }, contexto: { type: 'string' } }, required: ['pergunta'] } } },
  { type: 'function', function: { name: 'ver_inbox', description: 'Lista os eventos recentes da caixa de entrada (kimiwork_inbox) com status e payload resumido', parameters: { type: 'object', properties: { limite: { type: 'number' } } } } },
  { type: 'function', function: { name: 'ver_respostas_luna', description: 'Lê as respostas mais recentes da Luna às suas perguntas (turnos venus:*)', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'concluir_ordem', description: 'OBRIGATÓRIO ao fim de uma ORDEM DA LUNA: marca executada com resumo do que foi feito', parameters: { type: 'object', properties: { resumo: { type: 'string' } }, required: ['resumo'] } } },
  { type: 'function', function: { name: 'concluir_evento', description: 'OBRIGATÓRIO ao fim de cada evento da varredura: marca processado com resumo', parameters: { type: 'object', properties: { resumo: { type: 'string' }, acoes_json: { type: 'string', description: 'array JSON das ações tomadas' } }, required: ['resumo'] } } },
  { type: 'function', function: { name: 'falhar_evento', description: 'Marca o evento corrente como erro (só se impossível processar)', parameters: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] } } },
];
const EXEC = {
  ler_ficha_cliente: async (a) => lerFichaCliente(a.nome),
  ler_brain: async (a) => readAllowed(a.caminho),
  enviar_mensagem_whatsapp: (a) => sendWhatsapp(a.chat_id, a.texto, a.conversation_id),
  enviar_mensagem_telegram: (a) => sendTelegram(a.chat_id, a.texto, a.reply_to_message_id),
  registrar_solicitacao: async (a) => registrarSolicitacao(a.dados_json),
  criar_solicitacao_painel: (a) => criarSolicitacaoPainel(a.cliente, a.conteudo),
  quem_e_quem: async () => quemEQuem(),
  ver_conversa: async (a) => verConversa(a.chat_id, a.limite),
  perguntar_luna: perguntarLuna,
  ver_inbox: async (a) => verInbox(a.limite),
  ver_respostas_luna: () => verRespostasLuna(),
  concluir_ordem: async (a) => concluirOrdem(a.resumo),
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
    // TOOL-CALL EMULADO NO TEXTO — incidente 2026-10-09: o qwen3-coder às
    // vezes ESCREVE a chamada no content ("<function=ver_conversa>…") em vez
    // de usar o canal nativo, e o texto cru foi parar no grupo do WhatsApp.
    // Aqui a emulação vira execução REAL: executamos as tools extraídas e o
    // texto-ensaio (pensamento alto) é descartado, nunca enviado.
    const emuladas = extrairToolCallsEmuladas(msg.content);
    if (emuladas.length) {
      messages.push({ role: 'assistant', content: msg.content });
      console.log(`  ⚙ rodada ${rodada}: ${emuladas.length} tool-call(s) EMULADA(S) no texto — convertendo em execução real`);
      for (const tc of emuladas) {
        console.log(`    → ${tc.name}(${JSON.stringify(tc.args).slice(0, 140)})`);
        let resultado;
        try { resultado = await EXEC[tc.name]?.(tc.args) ?? `ERRO: tool desconhecida ${tc.name}`; }
        catch (e) { resultado = `ERRO na tool: ${e.message}`; }
        console.log(`      → ${String(resultado).slice(0, 160)}`);
        messages.push({ role: 'user', content: `[resultado da tool ${tc.name}]: ${String(resultado).slice(0, 2_000)}` });
      }
      continue;
    }
    console.log('\n=== RESPOSTA VÊNUS ===\n' + (msg.content ?? '(vazio)'));
    logRun({ tarefa: tarefa.slice(0, 200), resposta: (msg.content ?? '').slice(0, 2_000), tokens: resp.usage });
    return msg.content ?? '';
  }
  throw new Error(`estourou ${MAX_ROUNDS} rodadas de tool-call`);
}

/** Extrai chamadas de tool escritas no texto (formato <function=N>…</function>
 *  com <parameter=K>V</parameter>, ou <tool_call>{"name":…}</tool_call>).
 *  Retorna [] quando o texto é resposta normal. */
function extrairToolCallsEmuladas(content) {
  if (!content || typeof content !== 'string') return [];
  if (!/<function=|<tool_call>/i.test(content)) return [];
  const out = [];
  const reFn = /<function=([\w]+)>([\s\S]*?)<\/function>/g;
  let m;
  while ((m = reFn.exec(content)) !== null) {
    const args = {};
    const reP = /<parameter=([\w]+)>([\s\S]*?)<\/parameter>/g;
    let pm;
    while ((pm = reP.exec(m[2])) !== null) args[pm[1]] = pm[2].trim();
    out.push({ name: m[1], args });
  }
  const reTc = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  while ((m = reTc.exec(content)) !== null) {
    try {
      const j = JSON.parse(m[1].trim());
      if (j && typeof j === 'object' && j.name) out.push({ name: j.name, args: j.arguments ?? {} });
    } catch { /* JSON inválido — ignora */ }
  }
  return out;
}

// ── varredura autônoma ──
// contextoFila: { pendentes, mais_antigo } — pra ele saber se tá demorando
// (decreto owner 2026-10-09: "fila e hora pra ele saber se está demorando")
function contextoFilaTxt(evento, fila) {
  if (!evento.received_at) return '';
  const chegou = new Date(evento.received_at);
  const esperaMin = Math.max(0, Math.round((Date.now() - chegou.getTime()) / 60_000));
  const pendentes = fila?.pendentes ?? 1;
  const atrasado = esperaMin >= 15;
  return (
    `⏱️ CONTEXTO DE FILA: esta mensagem chegou às ${chegou.toLocaleTimeString('pt-BR')} (há ~${esperaMin} min). ` +
    `Agora na fila: ${pendentes} evento(s) aguardando/rodando, o mais antigo de ${fila?.mais_antigo ? new Date(fila.mais_antigo).toLocaleTimeString('pt-BR') : '—'}. ` +
    (atrasado
      ? `VOCÊ ESTÁ ATRASADO (+${esperaMin} min) — reconheça o atraso com naturalidade ("fui ver umas coisas aqui", sem drama), responda o essencial e entregue. `
      : `Você está no prazo. `) +
    `QUALIDADE > VELOCIDADE: não corra — pense, consulte quem_e_quem/ver_conversa se precisar, e responda certo. Uma resposta boa em 5 min vale mais que 3 ruins em 1.\n\n`
  );
}

function montarTarefa(evento, fila) {
  const p = evento.payload ?? {};
  if (evento.kind === 'whatsapp.message') {
    return (
      `Evento novo da caixa de entrada (WhatsApp${p.is_group ? ', grupo' : ''} ${p.chat_name ?? ''}). ` +
      `De: ${p.author_name ?? 'desconhecido'}. Mensagem: "${String(p.text ?? '').slice(0, 800)}"\n` +
      `chat_id: ${p.chat_id} · conversation_id: ${p.conversation_id ?? '(não informado)'} · ` +
      `message_id do evento: ${p.message_id ?? '(n/a)'}${p.mentioned_luna ? ' · MENCIONOU A LUNA' : ''}\n\n` +
      contextoFilaTxt(evento, fila) +
      `Você é a linha de frente, O Vênus. ANTES de responder: identifique com quem está falando — ` +
      `se não reconhecer o author_name, use quem_e_quem (Abner é o criador e DONO da Nexo; Nonoke e Elias também são donos; Enoque é time; cliente é outra coisa). ` +
      `Use ver_conversa no chat_id pra ver o que já foi dito, inclusive as respostas SUAS e da Luna — vocês podem conversar entre si pelo grupo, sem repetir. ` +
      `Regras: (1) pedido novo de CLIENTE (mudança no site, loja, conteúdo, foto, bug) → CRIE a solicitação de verdade com criar_solicitacao_painel (cliente: jess, hdm ou juninho + descrição completa do pedido) — confirme pra pessoa que entrou no painel da Nexo; registrar_solicitacao só pra rascunho local; ` +
      `(2) responda no WhatsApp se fizer sentido — você é O Vênus (homem, irmão da Luna), e TODA mensagem sua sai assinada "-venus" automaticamente. ` +
      `ATENÇÃO: sua resposta final em texto NÃO é enviada sozinha — você PRECISA chamar enviar_mensagem_whatsapp com o texto, senão a pessoa nunca recebe; ` +
      `(3) difícil/crise/julgamento → perguntar_luna (contexto completo e serializado, nunca objeto) e AVISE a pessoa que a Luna assume. IMPORTANTE: a Luna pode estar INDISPONÍVEL (quota) — se ela não responder a tempo, DECIDA SOZINHO com bom senso, anote o que decidiu em registrar_solicitacao (dados_json com tema "decisao_sem_luna") e siga; nunca deixe a pessoa sem resposta por esperar a Luna; ` +
      `(4) ao final, OBRIGATORIAMENTE concluir_evento com resumo e ações. Se for impossível, falhar_evento com motivo.`
    );
  }
  if (evento.kind === 'telegram.message') {
    return (
      `Menção nova no grupo do time no Telegram. De: ${p.from?.first_name ?? p.author_name ?? 'desconhecido'}. ` +
      `Mensagem: "${String(p.text ?? '').slice(0, 800)}"\n` +
      `chat_id: ${p.chat_id} · message_id: ${p.message_id ?? '(n/a)'}\n\n` +
      contextoFilaTxt(evento, fila) +
      `Você é o Vênus, linha de frente. Responda com enviar_mensagem_telegram CITANDO a mensagem (reply_to_message_id). ` +
      `Se a menção pedir tarefa difícil/decisão → perguntar_luna. Ao final, OBRIGATORIAMENTE concluir_evento.`
    );
  }
  return `Evento de kind desconhecido (${evento.kind}). Avalie o payload e decida: responder ou falhar_evento.`;
}

async function processarEvento(evento, fila) {
  currentEvent = evento;
  enviosNoEvento = 0;
  try {
    // entrega as respostas recentes da Luna às perguntas dele (a fila sozinha não fala)
    const respostas = await respostasLunaRecentes();
    const tarefa = (respostas
      ? `RESPOSTAS RECENTES DA LUNA às suas perguntas (considere antes de agir; se já viu, ignore):\n${respostas}\n\n=== EVENTO NOVO ===\n`
      : '') + montarTarefa(evento, fila);
    const resposta = await run(tarefa, { comTools: true });
    // FAIL-SAFE (bug raiz-quadrada 2026-10-09): texto final NÃO chega ao
    // WhatsApp/Telegram sozinho — só chega se a tool de envio for chamada.
    // Se o turno terminou sem nenhum envio mas gerou resposta, enviamos nós.
    if (enviosNoEvento === 0 && resposta && resposta.trim().length >= 2) {
      const p = evento.payload ?? {};
      try {
        if (evento.kind === 'whatsapp.message' && p.chat_id) {
          console.log('[vênus] resgate: turno terminou sem chamar envio — mandando a resposta final pelo pipeline');
          await sendWhatsapp(String(p.chat_id), resposta.trim());
        } else if (evento.kind === 'telegram.message' && p.chat_id) {
          console.log('[vênus] resgate: turno terminou sem chamar envio — mandando a resposta final pelo telegram');
          await sendTelegram(String(p.chat_id), resposta.trim(), p.message_id ? Number(p.message_id) : undefined);
        }
      } catch (e) {
        console.error(`  ✗ resgate falhou: ${e.message}`);
      }
    }
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
  // TRAVA ANTI-DUPLICATA (decreto owner 2026-10-09: "não pode ter 2 vênus
  // rodando, mata meu pc"): se o PID registrado no heartbeat ainda existe,
  // outro Vênus está vivo — aborta. pm2 restart mata o antes de subir o novo,
  // então o PID antigo nunca existe quando o novo boota legítimo.
  {
    const r = await db(`SELECT pid, seen_at FROM service_heartbeats WHERE service='venus-varredura'`);
    if (r.rows[0] && r.rows[0].pid !== process.pid) {
      const beatFresco = Date.now() - new Date(r.rows[0].seen_at).getTime() < 90_000;
      let pidVivo = false;
      if (beatFresco) { try { process.kill(Number(r.rows[0].pid), 0); pidVivo = true; } catch { /* morto */ } }
      if (pidVivo) {
        console.log(`[vênus] JÁ EXISTE UM VÊNUS VIVO (pid ${r.rows[0].pid}, beat fresco) — abortando pra não ter 2 rodando e matar o PC do owner`);
        process.exit(1);
      }
    }
  }
  console.log(`[vênus] varredura autônoma no ar (poll ${POLL_MS / 1000}s). Modo: VENUS_AUTONOMO no .env`);
  // Heartbeat contínuo — NÃO só no loop principal: durante o processamento de
  // um evento (fetch longo pro colibri, minutos) o loop fica await-ed e o beat
  // parava de bater; o watchdog então achava que o Vênus morreu e dava pm2
  // restart (crash loop de verdade, 2026-10-09). Com setInterval o beat reflete
  // "processo vivo"; só fica velho se o event loop travar de verdade.
  const hb = setInterval(() => { heartbeatVenus().catch(() => {}); }, 25_000);
  await heartbeatVenus().catch(() => {});
  let ciclos = 0;
  for (;;) {
    ciclos++;
    try {
      if (!venusAutonomo()) {
        if (ciclos % 10 === 1) console.log(`[vênus] modo desligado (VENUS_AUTONOMO!=true) — aguardando`);
      } else {
        // ORDEM DA LUNA tem prioridade máxima sobre a inbox (cadeia de comando)
        const ord = await db(
          `SELECT id, ordem, contexto FROM luna_ordens WHERE status='pending' ORDER BY created_at LIMIT 1`,
        );
        if (ord.rows[0]) {
          const claim = await db(
            `UPDATE luna_ordens SET status='processing' WHERE id=$1 AND status='pending' RETURNING id`,
            [ord.rows[0].id],
          );
          if (claim.rows[0]) {
            await processarOrdem(ord.rows[0]);
            continue; // próxima ordem ou evento imediatamente
          }
        }
        const ev = await db(
          `SELECT id, kind, payload, received_at FROM kimiwork_inbox WHERE status='pending' AND kind IN ('whatsapp.message','telegram.message') ORDER BY received_at LIMIT 1`,
        );
        if (ev.rows[0]) {
          const claim = await db(
            `UPDATE kimiwork_inbox SET status='processing' WHERE id=$1 AND status='pending' RETURNING id`,
            [ev.rows[0].id],
          );
          if (claim.rows[0]) {
            // contexto de fila pro Vênus saber se tá demorando (decreto owner:
            // msg chegam com fila e hora; qualidade > velocidade)
            const fila = await db(
              `SELECT count(*)::int AS pendentes, min(received_at) AS mais_antigo
               FROM kimiwork_inbox WHERE status IN ('pending','processing') AND kind IN ('whatsapp.message','telegram.message')`,
            );
            console.log(`[vênus] evento ${ev.rows[0].kind} ${ev.rows[0].id} claimado — processando`);
            await processarEvento(ev.rows[0], fila.rows[0]);
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
