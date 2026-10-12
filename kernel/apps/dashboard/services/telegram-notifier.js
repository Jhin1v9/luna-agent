/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SERVIÇO DE NOTIFICAÇÕES TELEGRAM — NEXO DIGITAL v2.0 PREMIUM           ║
 * ║  Design: Espetacular • Visual • Impactante • Profissional               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Templates premium para votações com formatação Markdown avançada,
 * emojis estratégicos, separadores visuais e layout hierárquico.
 */

const fs = require('fs');
const path = require('path');
const getTelegramBot = require('./telegram-bot-client.cjs');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID || process.env.TELEGRAM_NOTIFICATION_CHAT_ID || '';

if (!GROUP_CHAT_ID) {
  console.warn('[TelegramNotifier] ⚠️ TELEGRAM_GROUP_CHAT_ID não configurado. Notificações de votação NÃO serão enviadas para o grupo. Configure no .env do backend.');
}

let bot = null;
function getBot() {
  if (bot) return bot;
  if (!TOKEN) {
    console.warn('[TelegramNotifier] TELEGRAM_BOT_TOKEN não configurado');
    return null;
  }
  try {
    // v10.11-fix: Notificações outbound NUNCA devem fazer polling.
    // Apenas o PM2 telegram-bot faz polling. Isso evita 409 Conflict.
    bot = getTelegramBot(TOKEN, { polling: false });
    return bot;
  } catch (e) {
    console.warn('[TelegramNotifier] Falha ao obter bot:', e.message);
    return null;
  }
}

// v10.3: deduplication cache for notifications
const sentNotifications = new Map();
const NOTIFICATION_TTL_MS = 5 * 60 * 1000;

function dedupedSend(key, sendFn) {
  const now = Date.now();
  for (const [k, t] of sentNotifications) {
    if (now - t > NOTIFICATION_TTL_MS) sentNotifications.delete(k);
  }
  if (sentNotifications.has(key)) {
    console.log('[TelegramNotifier] Dedup skipped:', key);
    return Promise.resolve({ skipped: true });
  }
  return sendFn().then((result) => {
    sentNotifications.set(key, now);
    return result;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE DE USUÁRIOS
// ═══════════════════════════════════════════════════════════════════════════
let usersCache = null;
let usersCacheTime = 0;
const USERS_CACHE_TTL = 30000;

function getUsers() {
  const now = Date.now();
  if (usersCache && now - usersCacheTime < USERS_CACHE_TTL) return usersCache;

  try {
    const usersFile = path.join(__dirname, '..', 'data', 'users.json');
    const data = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    usersCache = data.users || {};
    usersCacheTime = now;
    return usersCache;
  } catch (e) {
    console.error('[TelegramNotifier] Erro ao carregar users:', e.message);
    return {};
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EMOJIS & ASSETS VISUAIS
// ═══════════════════════════════════════════════════════════════════════════
const E = {
  header:    '╔══════════════════════╗',
  footer:    '╚══════════════════════╝',
  divider:   '━━━━━━━━━━━━━━━━━━━━━━',
  dot:       '◉',
  arrow:     '▸',
  check:     '✅',
  cross:     '❌',
  ballot:    '🗳️',
  crown:     '👑',
  sparkles:  '✨',
  rocket:    '🚀',
  lock:      '🔒',
  unlock:    '🔓',
  chart:     '📊',
  link:      '🔗',
  clock:     '⏱️',
  fire:      '🔥',
  star:      '⭐',
  warning:   '⚠️',
  party:     '🎉',
  skull:     '💀',
  brain:     '🧠',
  gear:      '⚙️',
  target:    '🎯',
  megaphone: '📢',
  shield:    '🛡️',
  zap:       '⚡',
};

const STATUS_EMOJI = {
  open:    '🟢 ABERTA',
  voting:  '🔵 EM VOTAÇÃO',
  approved:'🟢 APROVADA',
  rejected:'🔴 REJEITADA',
  closed:  '⚪ ENCERRADA',
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS VISUAIS
// ═══════════════════════════════════════════════════════════════════════════

function progressBar(yes, no, total = 3) {
  const y = '█'.repeat(yes);
  const n = '░'.repeat(total - yes - no);
  const x = '▒'.repeat(no);
  return `${E.chart} ${y}${x}${n}  ${E.check} ${yes}  ${E.cross} ${no}  / ${total}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function box(title, content) {
  return `${E.header}\n${E.crown} *${escapeMarkdown(title)}*\n${E.footer}\n\n${content}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATES PREMIUM
// ═══════════════════════════════════════════════════════════════════════════

function buildNewVoting(session, creator, url) {
  const desc = session.description
    ? `\n${E.arrow} _${escapeMarkdown(session.description.slice(0, 300))}_\n`
    : '';

  const quorumVisual = `${E.target} *Quórum necessário:* ${session.quorumRequired}/3 CEOs ${E.star}\n`;

  return box(
    'NOVA SESSÃO DE VOTAÇÃO',
    `${E.ballot} *Título:* \`${escapeMarkdown(session.title)}\`\n` +
    `${E.brain} *Criada por:* ${escapeMarkdown(creator)}\n` +
    `${E.clock} *Data:* ${formatDate(session.createdAt)}\n` +
    `${STATUS_EMOJI[session.status] || session.status}\n` +
    `${quorumVisual}` +
    `${desc}\n` +
    `${E.divider}\n\n` +
    `${E.megaphone} *CEOs, por favor votem:*\n` +
    `${E.arrow} Ação será executada *automaticamente* após aprovação\n\n` +
    `${E.link} [▸ ABRIR DASHBOARD](${url}/votacao)`
  );
}

function buildVoteUpdate(session, voterName, voteValue, url) {
  const voteEmoji = voteValue === 'yes' ? `${E.check} SIM` : `${E.cross} NÃO`;
  const yesCount = Object.values(session.votes).filter(v => v?.vote === 'yes').length;
  const noCount = Object.values(session.votes).filter(v => v?.vote === 'no').length;

  const progress = progressBar(yesCount, noCount, 3);
  const quorumText = yesCount >= session.quorumRequired
    ? `\n${E.fire} *QUÓROM ALCANÇADO!* Aguardando encerramento...\n`
    : `\n${E.clock} *Faltam:* ${session.quorumRequired - yesCount} voto(s) para aprovação\n`;

  const buttons = (session.status === 'open' || session.status === 'voting')
    ? `\n${E.megaphone} *Ainda não votaram — participem!*` : '';

  return box(
    'NOVO VOTO REGISTRADO',
    `${E.ballot} *Sessão:* \`${escapeMarkdown(session.title)}\`\n\n` +
    `${E.zap} *Votante:* ${escapeMarkdown(voterName)}\n` +
    `${voteEmoji}\n\n` +
    `${E.divider}\n` +
    `${progress}\n` +
    `${quorumText}` +
    `${buttons}\n\n` +
    `${E.link} [▸ VER NO DASHBOARD](${url}/votacao)`
  );
}

function buildApproved(session, url) {
  const execText = session.executionResult?.success
    ? `\n${E.rocket} *Ação executada automaticamente com sucesso!*\n`
    : `\n${E.warning} *Ação pendente de execução manual*\n`;

  return box(
    'VOTAÇÃO APROVADA',
    `${E.party} *PARABÉNS!* A proposta foi aprovada pela diretoria.\n\n` +
    `${E.ballot} *Título:* \`${escapeMarkdown(session.title)}\`\n` +
    `${E.check} *Votos SIM:* ${Object.values(session.votes).filter(v => v?.vote === 'yes').length}/3\n` +
    `${E.cross} *Votos NÃO:* ${Object.values(session.votes).filter(v => v?.vote === 'no').length}/3\n` +
    `${E.clock} *Encerrada em:* ${formatDate(new Date().toISOString())}\n\n` +
    `${E.divider}\n` +
    `${execText}\n` +
    `${E.link} [▸ VER DETALHES](${url}/votacao)`
  );
}

function buildRejected(session, url) {
  return box(
    'VOTAÇÃO REJEITADA',
    `${E.skull} *PROPOSTA VETADA* pela diretoria.\n\n` +
    `${E.ballot} *Título:* \`${escapeMarkdown(session.title)}\`\n` +
    `${E.check} *Votos SIM:* ${Object.values(session.votes).filter(v => v?.vote === 'yes').length}/3\n` +
    `${E.cross} *Votos NÃO:* ${Object.values(session.votes).filter(v => v?.vote === 'no').length}/3\n` +
    `${E.clock} *Encerrada em:* ${formatDate(new Date().toISOString())}\n\n` +
    `${E.divider}\n\n` +
    `${E.shield} A ação *NÃO será executada*.\n\n` +
    `${E.link} [▸ VER DETALHES](${url}/votacao)`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BOTÕES INLINE PREMIUM
// ═══════════════════════════════════════════════════════════════════════════

function votingButtons(sessionId, showButtons = true, baseUrl = '') {
  if (!showButtons) return null;
  const url = baseUrl || process.env.DASHBOARD_PUBLIC_URL || 'https://nexodashboard.onrender.com';
  return {
    inline_keyboard: [
      [
        { text: `${E.check} APROVAR`, callback_data: `vote:${sessionId}:yes` },
        { text: `${E.cross} REJEITAR`, callback_data: `vote:${sessionId}:no` }
      ],
      [
        { text: `${E.link} Abrir Dashboard`, url: `${url}/votacao` }
      ]
    ]
  };
}

function resultButtons(sessionId, url) {
  return {
    inline_keyboard: [[
      { text: `${E.link} Ver no Dashboard`, url: `${url}/votacao` }
    ]]
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

async function sendVotingNotification({ type, session, voter, voteValue, baseUrl }) {
  if (!getBot()) {
    console.warn('[TelegramNotifier] Bot não inicializado');
    return { sent: false, reason: 'bot_not_initialized' };
  }

  const url = baseUrl || (process.env.NODE_ENV === 'production'
    ? 'https://nexodashboard.onrender.com'
    : 'http://localhost:3457');

  const users = getUsers();
  const creator = users[session.createdBy]?.name || session.createdBy;

  let text = '';
  let inlineKeyboard = null;

  switch (type) {
    case 'new':
      text = buildNewVoting(session, creator, url);
      inlineKeyboard = votingButtons(session.id, true);
      break;

    case 'vote': {
      const voterName = users[voter]?.name || voter;
      text = buildVoteUpdate(session, voterName, voteValue, url);
      const stillOpen = session.status === 'open' || session.status === 'voting';
      inlineKeyboard = votingButtons(session.id, stillOpen);
      break;
    }

    case 'approved':
      text = buildApproved(session, url);
      inlineKeyboard = resultButtons(session.id, url);
      break;

    case 'rejected':
      text = buildRejected(session, url);
      inlineKeyboard = resultButtons(session.id, url);
      break;

    default:
      console.warn(`[TelegramNotifier] Tipo de notificação desconhecido: ${type}`);
      return { sent: false, reason: 'unknown_type' };
  }

  if (!GROUP_CHAT_ID) {
    console.warn('[TelegramNotifier] GROUP_CHAT_ID não configurado');
    return { sent: false, reason: 'group_chat_id_not_set' };
  }

  const key = `voting:${type}:${session.id}:${GROUP_CHAT_ID}`;
  return dedupedSend(key, async () => {
    try {
      const msg = await getBot()?.sendMessage(GROUP_CHAT_ID, text, {
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard,
        disable_web_page_preview: true
      });
      console.log(`[TelegramNotifier] ✅ Notificação ${type} enviada para o grupo`);
      return { sent: true, messageId: msg.message_id };
    } catch (err) {
      console.error('[TelegramNotifier] Erro ao enviar para grupo:', err.message);
      return { sent: false, error: err.message };
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÃO DE TAREFA — PREMIUM RICH DATA
// ═══════════════════════════════════════════════════════════════════════════

const PRIORITY_CONFIG = {
  high:   { emoji: '🔴', label: 'ALTA' },
  medium: { emoji: '🟡', label: 'MÉDIA' },
  low:    { emoji: '🟢', label: 'BAIXA' },
  urgent: { emoji: '🔥', label: 'URGENTE' },
};

const STATUS_CONFIG_TASK = {
  pending:     { emoji: '⏳', label: 'PENDENTE' },
  in_progress: { emoji: '⚙️', label: 'EM ANDAMENTO' },
  completed:   { emoji: '✅', label: 'CONCLUÍDA' },
  blocked:     { emoji: '🚫', label: 'BLOQUEADA' },
  cancelled:   { emoji: '❌', label: 'CANCELADA' },
};

function buildTaskNotification(task) {
  const p = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
  const s = STATUS_CONFIG_TASK[task.status] || STATUS_CONFIG_TASK.pending;
  
  const title = escapeMarkdown(task.title || 'Sem título');
  const desc = task.description 
    ? escapeMarkdown(task.description.slice(0, 400)) 
    : '_Sem descrição_';
  const assignee = task.assignedTo 
    ? escapeMarkdown(task.assignedTo) 
    : 'Não atribuído';
  const createdBy = escapeMarkdown(task.addedBy || 'Sistema');
  const dueDate = task.dueDate 
    ? formatDate(task.dueDate) 
    : 'Sem prazo';
  
  let tagsText = '';
  if (task.tags && task.tags.length > 0) {
    tagsText = '\n🏷️ *Tags:* ' + task.tags.map(t => '`' + escapeMarkdown(t) + '`').join('  ');
  }
  
  const commentsCount = task.comments?.length || 0;
  const commentsText = commentsCount > 0 
    ? '💬 ' + commentsCount + ' comentário(s)' 
    : '💬 Sem comentários';

  return (
    '╔══════════════════════════════════╗\n' +
    '📋 *NOVA TAREFA CRIADA*\n' +
    '╚══════════════════════════════════╝\n\n' +
    '🎯 *' + title + '*\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
    p.emoji + ' *Prioridade:* ' + p.label + '\n' +
    s.emoji + ' *Status:* ' + s.label + '\n' +
    '👤 *Responsável:* ' + assignee + '\n' +
    '✍️ *Criada por:* ' + createdBy + '\n' +
    '📅 *Prazo:* ' + dueDate + '\n' +
    '🆔 *ID:* `' + task.id + '`\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
    '📝 *Descrição:*\n' +
    '_' + desc + '_\n' +
    tagsText + '\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
    '📊 *Atividade:* ' + commentsText + '  |  🕐 Criada em ' + formatDate(task.createdAt) + '\n\n' +
    '🔗 [▸ ABRIR NO DASHBOARD](' + baseUrl + '/tarefas)'
  );
}

async function sendTaskNotification(task) {
  if (!getBot()) {
    console.warn('[TelegramNotifier] Bot não inicializado');
    return { sent: false, reason: 'bot_not_initialized' };
  }
  if (!GROUP_CHAT_ID) {
    console.warn('[TelegramNotifier] GROUP_CHAT_ID não configurado');
    return { sent: false, reason: 'group_chat_id_not_set' };
  }

  const baseUrl = process.env.DASHBOARD_PUBLIC_URL || 'https://nexodashboard.onrender.com';
  const key = `task:${task.id || JSON.stringify(task)}:${GROUP_CHAT_ID}`;

  return dedupedSend(key, async () => {
    try {
      const text = buildTaskNotification(task);
      const msg = await getBot()?.sendMessage(GROUP_CHAT_ID, text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Concluir', callback_data: 'task:' + task.id + ':complete' },
              { text: '👤 Assumir', callback_data: 'task:' + task.id + ':assign' }
            ],
            [
              { text: '🔗 Abrir Dashboard', url: baseUrl + '/tarefas' }
            ]
          ]
        }
      });
      console.log('[TelegramNotifier] ✅ Notificação de tarefa enviada: ' + task.id);
      return { sent: true, messageId: msg.message_id };
    } catch (err) {
      console.error('[TelegramNotifier] Erro ao enviar notificação de tarefa:', err.message);
      return { sent: false, error: err.message };
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MENSAGEM SIMPLES
// ═══════════════════════════════════════════════════════════════════════════

async function sendSimpleMessage(text, options = {}) {
  if (!getBot()) {
    return { sent: false, reason: 'bot_not_initialized' };
  }
  if (!GROUP_CHAT_ID) {
    return { sent: false, reason: 'group_chat_id_not_set' };
  }
  try {
    const msg = await getBot()?.sendMessage(GROUP_CHAT_ID, text, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...options
    });
    return { sent: true, messageId: msg.message_id };
  } catch (err) {
    console.error('[TelegramNotifier] Erro ao enviar mensagem:', err.message);
    return { sent: false, error: err.message };
  }
}

function resolveMentions(mentions) {
  const users = getUsers();
  const resolved = [];
  for (const userId of mentions) {
    const user = users[userId];
    if (user?.telegramUsername) {
      resolved.push(`@${user.telegramUsername}`);
    } else {
      resolved.push(`@${user?.name || userId}`);
    }
  }
  return resolved;
}

function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/([_\*\[\]\(\)~`>#+\-=|{}.!])/g, '\\$1');
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÕES VISUAIS — LEADS & ROADMAPS
// ═══════════════════════════════════════════════════════════════════════════

const PROJECT_TYPE_CONFIG = {
  website:  { emoji: '🌐', label: 'Website / Landing' },
  app:      { emoji: '📱', label: 'App Mobile' },
  ecommerce:{ emoji: '🛒', label: 'E-commerce' },
  sistema:  { emoji: '⚙️', label: 'Sistema / SaaS' },
  landing:  { emoji: '🎯', label: 'Landing Page' },
  outro:    { emoji: '📦', label: 'Outro' },
};

const LEAD_STATUS_CONFIG = {
  novo:        { emoji: '🆕', label: 'NOVO' },
  contatado:   { emoji: '📞', label: 'CONTATADO' },
  proposta:    { emoji: '📄', label: 'PROPOSTA ENVIADA' },
  negociacao:  { emoji: '🤝', label: 'NEGOCIAÇÃO' },
  ganho:       { emoji: '✅', label: 'GANHO' },
  perdido:     { emoji: '❌', label: 'PERDIDO' },
  potencial:   { emoji: '💡', label: 'POTENCIAL' },
  ativo:       { emoji: '🟢', label: 'ATIVO' },
};

const LEAD_SOURCE_CONFIG = {
  website:     { emoji: '🌐', label: 'Site' },
  'luna-agent':{ emoji: '🤖', label: 'Luna AI' },
  manual:      { emoji: '✍️', label: 'Manual' },
  demo:        { emoji: '🎯', label: 'Demo' },
  referral:    { emoji: '👥', label: 'Indicação' },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS — PROGRESS BARS & FORMATTING
// ═══════════════════════════════════════════════════════════════════════════

function roadmapProgressBar(currentIdx, totalPhases) {
  const filled = '█'.repeat(currentIdx + 1);
  const empty = '░'.repeat(Math.max(0, totalPhases - currentIdx - 1));
  return `${filled}${empty}`;
}

function formatCurrency(value, currency = 'EUR') {
  const num = parseFloat(value) || 0;
  const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'BRL' ? 'R$' : currency;
  return `${symbol} ${num.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Envia com HTML, fallback para texto plano */
async function safeSendHtml(chatId, text, extra = {}) {
  if (!getBot()) return { sent: false, reason: 'bot_not_initialized' };
  try {
    const msg = await getBot()?.sendMessage(chatId, text, { ...extra, parse_mode: 'HTML' });
    return { sent: true, messageId: msg.message_id };
  } catch (e) {
    console.warn('[TelegramNotifier] HTML falhou, enviando sem formatação:', e.message);
    try {
      const safeExtra = { ...extra };
      delete safeExtra.parse_mode;
      const plain = text.replace(/<[^>]+>/g, '');
      const msg = await getBot()?.sendMessage(chatId, plain, safeExtra);
      return { sent: true, messageId: msg.message_id, fallback: true };
    } catch (e2) {
      return { sent: false, error: e2.message };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILDER — ROADMAP / META NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════════

function buildRoadmapNotification(roadmap, creatorName, baseUrl) {
  const pt = PROJECT_TYPE_CONFIG[roadmap.project_type] || PROJECT_TYPE_CONFIG.outro;
  const title = escapeHtml(roadmap.title || 'Sem título');
  const creator = escapeHtml(creatorName || roadmap.created_by || 'Sistema');
  const value = formatCurrency(roadmap.total_value, roadmap.currency);
  const phases = roadmap.phases || [];
  const totalPhases = phases.length;
  const currentIdx = roadmap.current_phase_index || 0;
  const progressBar = roadmapProgressBar(currentIdx, totalPhases);

  // Fases list
  let phasesList = '';
  if (totalPhases > 0) {
    phasesList = '\n' + phases.map((p, i) => {
      const status = i < currentIdx ? '✅' : i === currentIdx ? '▶️' : '⏳';
      const name = escapeHtml(p.title || `Fase ${i + 1}`);
      return `   ${status} ${name}`;
    }).join('\n') + '\n';
  }

  // Payment schedule
  let paymentText = '';
  if (roadmap.payment_schedule && roadmap.payment_schedule.length > 0) {
    paymentText = '\n💳 <b>Pagamentos:</b>\n' + roadmap.payment_schedule.map(p => {
      const pct = p.percent || 0;
      const lbl = escapeHtml(p.label || 'Parcela');
      const paid = p.paid ? '✅' : '⏳';
      return `   ${paid} ${lbl} (${pct}%)`;
    }).join('\n') + '\n';
  }

  const text = (
    '<b>╔══════════════════════════════════╗</b>\n' +
    '🚀 <b>NOVO PROJETO CRIADO</b>\n' +
    '<b>╚══════════════════════════════════╝</b>\n\n' +
    '🎯 <b>' + title + '</b>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
    pt.emoji + ' <b>Tipo:</b> ' + escapeHtml(pt.label) + '\n' +
    '💰 <b>Valor:</b> ' + escapeHtml(value) + '\n' +
    '👤 <b>Criado por:</b> ' + creator + '\n' +
    '🆔 <b>ID:</b> <code>' + escapeHtml(roadmap.id) + '</code>\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
    '📊 <b>Progresso das Fases:</b>\n' +
    '<code>' + progressBar + '</code>  <b>' + (currentIdx + 1) + '/' + totalPhases + '</b>\n' +
    phasesList +
    paymentText +
    '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
    '🕐 Criado em ' + escapeHtml(formatDate(roadmap.createdAt || new Date().toISOString())) + '\n\n' +
    '🔗 <a href="' + (baseUrl + '/metas') + '">▸ ABRIR NO DASHBOARD</a>'
  );

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🚀 Ver Projeto', url: baseUrl + '/metas' },
        { text: '📊 Timeline', url: baseUrl + '/metas' }
      ],
      [
        { text: '💰 Finanças', url: baseUrl + '/financeiro' },
        { text: '✅ Tarefas', url: baseUrl + '/tarefas' }
      ]
    ]
  };

  return { text, inlineKeyboard };
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILDER — LEAD NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════════

function buildLeadNotification(lead, creatorName, baseUrl) {
  const statusCfg = LEAD_STATUS_CONFIG[lead.pipelineStatus || lead.status] || LEAD_STATUS_CONFIG.novo;
  const sourceCfg = LEAD_SOURCE_CONFIG[lead.source] || { emoji: '📌', label: lead.source || 'Desconhecida' };
  const name = escapeHtml(lead.displayName || lead.name || 'Sem nome');
  const email = escapeHtml(lead.email || 'N/A');
  const phone = escapeHtml(lead.phone || 'N/A');
  const company = escapeHtml(lead.companyName || lead.name || 'N/A');
  const notes = lead.notes
    ? escapeHtml(lead.notes.slice(0, 400))
    : '<i>Sem notas</i>';
  const creator = escapeHtml(creatorName || lead.addedBy || 'Sistema');
  const value = lead.estimatedValue
    ? formatCurrency(lead.estimatedValue, lead.currency || 'EUR')
    : 'N/A';

  let tagsText = '';
  if (lead.tags && lead.tags.length > 0) {
    tagsText = '\n🏷️ <b>Tags:</b> ' + lead.tags.map(t => '<code>' + escapeHtml(t) + '</code>').join('  ');
  }

  const text = (
    '<b>╔══════════════════════════════════╗</b>\n' +
    '🎯 <b>NOVO LEAD</b>\n' +
    '<b>╚══════════════════════════════════╝</b>\n\n' +
    '👤 <b>' + name + '</b>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
    '📧 <b>Email:</b> ' + email + '\n' +
    '📱 <b>Telefone:</b> ' + phone + '\n' +
    '🏢 <b>Empresa:</b> ' + company + '\n' +
    '💰 <b>Valor estimado:</b> ' + escapeHtml(value) + '\n' +
    '🌐 <b>Fonte:</b> ' + sourceCfg.emoji + ' ' + escapeHtml(sourceCfg.label) + '\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
    '📝 <b>Notas:</b>\n' +
    '<i>' + notes + '</i>' +
    tagsText + '\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
    statusCfg.emoji + ' <b>Status:</b> ' + escapeHtml(statusCfg.label) + '\n' +
    '👤 <b>Criado por:</b> ' + creator + '\n' +
    '🕐 ' + escapeHtml(formatDate(lead.createdAt || new Date().toISOString())) + '\n\n' +
    '🔗 <a href="' + (baseUrl + '/leads') + '">▸ ABRIR NO DASHBOARD</a>'
  );

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '👤 Ver Lead', url: baseUrl + '/leads' },
        { text: '✅ Contatado', callback_data: 'lead:' + lead.id + ':contacted' }
      ],
      [
        { text: '📄 Proposta', callback_data: 'lead:' + lead.id + ':proposal' },
        { text: '🔗 Dashboard', url: baseUrl + '/dashboard' }
      ]
    ]
  };

  return { text, inlineKeyboard };
}

// ═══════════════════════════════════════════════════════════════════════════
// SENDER — ROADMAP
// ═══════════════════════════════════════════════════════════════════════════

async function sendRoadmapNotification(roadmap) {
  if (!getBot()) {
    console.warn('[TelegramNotifier] Bot não inicializado');
    return { sent: false, reason: 'bot_not_initialized' };
  }
  if (!GROUP_CHAT_ID) {
    console.warn('[TelegramNotifier] GROUP_CHAT_ID não configurado');
    return { sent: false, reason: 'group_chat_id_not_set' };
  }

  const baseUrl = process.env.DASHBOARD_PUBLIC_URL || 'https://nexodashboard.onrender.com';

  const users = getUsers();
  const creator = users[roadmap.created_by]?.name || roadmap.created_by || 'Sistema';

  const { text, inlineKeyboard } = buildRoadmapNotification(roadmap, creator, baseUrl);
  const key = `roadmap:${roadmap.id}:${GROUP_CHAT_ID}`;

  return dedupedSend(key, async () => {
    try {
      const res = await safeSendHtml(GROUP_CHAT_ID, text, {
        reply_markup: inlineKeyboard,
        disable_web_page_preview: true
      });
      if (res.sent) console.log('[TelegramNotifier] ✅ Notificação de projeto enviada para o grupo');
      return res;
    } catch (err) {
      return { sent: false, error: err.message };
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SENDER — LEAD
// ═══════════════════════════════════════════════════════════════════════════

async function sendLeadNotification(lead) {
  if (!getBot()) {
    console.warn('[TelegramNotifier] Bot não inicializado');
    return { sent: false, reason: 'bot_not_initialized' };
  }
  if (!GROUP_CHAT_ID) {
    console.warn('[TelegramNotifier] GROUP_CHAT_ID não configurado');
    return { sent: false, reason: 'group_chat_id_not_set' };
  }

  const baseUrl = process.env.DASHBOARD_PUBLIC_URL || 'https://nexodashboard.onrender.com';

  const users = getUsers();
  const creator = users[lead.addedBy]?.name || lead.addedBy || lead.createdBy || 'Sistema';

  const { text, inlineKeyboard } = buildLeadNotification(lead, creator, baseUrl);
  const key = `lead:${lead.id}:${GROUP_CHAT_ID}`;

  return dedupedSend(key, async () => {
    try {
      const res = await safeSendHtml(GROUP_CHAT_ID, text, {
        reply_markup: inlineKeyboard,
        disable_web_page_preview: true
      });
      if (res.sent) console.log('[TelegramNotifier] ✅ Notificação de lead enviada para o grupo');
      return res;
    } catch (err) {
      return { sent: false, error: err.message };
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  sendVotingNotification,
  sendTaskNotification,
  sendRoadmapNotification,
  sendLeadNotification,
  buildRoadmapNotification,
  buildLeadNotification,
  buildTaskNotification,
  sendSimpleMessage,
  resolveMentions,
  escapeMarkdown,
  getBot,
};
