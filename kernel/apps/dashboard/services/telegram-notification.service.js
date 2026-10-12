/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Telegram Notification Service — NEXO Dashboard PRO
 * Envio de notificações push via bot @lunanexobot
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * • Bot separado com polling: false (apenas envio, não interfere no agente principal)
 * • Mensagens em MarkdownV2 com fallback para texto plano
 * • Templates bonitos para cada tipo de notificação
 * ═══════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const getTelegramBot = require('./telegram-bot-client.cjs');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_NOTIFICATION_CHAT_ID;

function getBot() {
  if (!TOKEN) return null;
  try {
    return getTelegramBot(TOKEN, { polling: false });
  } catch (e) {
    console.error('[TelegramNotify] Falha ao obter bot:', e.message);
    return null;
  }
}

// v10.3: deduplication cache
const sentNotifications = new Map();
const NOTIFICATION_TTL_MS = 5 * 60 * 1000;

function dedupedSend(key, sendFn) {
  const now = Date.now();
  for (const [k, t] of sentNotifications) {
    if (now - t > NOTIFICATION_TTL_MS) sentNotifications.delete(k);
  }
  if (sentNotifications.has(key)) {
    console.log('[TelegramNotify] Dedup skipped:', key);
    return Promise.resolve({ skipped: true });
  }
  return sendFn().then((result) => {
    sentNotifications.set(key, now);
    return result;
  });
}

function escapeMarkdown(text) {
  return String(text || '').replace(/[_*\[\]()~`>#+=|{}.!-]/g, '\\$&');
}

function unescapeMarkdown(text) {
  return String(text || '').replace(/\\([_*\[\]()~`>#+=|{}.!-])/g, '$1');
}

/** Envia mensagem com MarkdownV2, fallback para texto plano se der erro de parse */
async function safeSend(chatId, text, extra = {}) {
  const client = getBot();
  if (!client) {
    return { sent: false, reason: 'bot_not_initialized' };
  }
  if (!CHAT_ID) {
    return { sent: false, reason: 'chat_id_not_configured' };
  }

  try {
    const res = await client.sendMessage(chatId, text, { ...extra, parse_mode: 'MarkdownV2' });
    return { sent: true, messageId: res.message_id };
  } catch (e) {
    if (e.message && e.message.includes("can't parse entities")) {
      console.warn('[TelegramNotify] MarkdownV2 falhou, enviando sem formatação:', e.message);
      try {
        const safeExtra = { ...extra };
        delete safeExtra.parse_mode;
        const plain = unescapeMarkdown(text);
        const res = await client.sendMessage(chatId, plain, safeExtra);
        return { sent: true, messageId: res.message_id, fallback: true };
      } catch (e2) {
        return { sent: false, reason: 'send_failed', error: e2.message };
      }
    }
    return { sent: false, reason: 'send_failed', error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

function formatLeadMessage(lead) {
  const lines = [
    '🎯 *Novo Lead — Demo Request*',
    '',
    `👤 *Nome:* ${escapeMarkdown(lead.displayName)}`,
    `📧 *Email:* ${escapeMarkdown(lead.email)}`,
  ];

  if (lead.companyName) {
    lines.push(`🏢 *Empresa:* ${escapeMarkdown(lead.companyName)}`);
  }
  if (lead.companySize) {
    lines.push(`👥 *Equipe:* ${escapeMarkdown(lead.companySize)}`);
  }
  if (lead.phone) {
    lines.push(`📱 *Telefone:* ${escapeMarkdown(lead.phone)}`);
  }
  if (lead.notes) {
    lines.push(`📝 *Mensagem:* ${escapeMarkdown(lead.notes.substring(0, 300))}`);
  }

  lines.push('');
  lines.push(`🕐 *Recebido:* ${escapeMarkdown(new Date().toLocaleString('pt-BR'))}`);
  lines.push(`🔗 *Dashboard:* [Abrir Leads](https://nexodashboard.onrender.com/dashboard/leads)`);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

async function notifyNewLead(lead) {
  if (!TOKEN || !CHAT_ID) {
    return { sent: false, reason: 'not_configured', hint: 'Configure TELEGRAM_BOT_TOKEN e TELEGRAM_NOTIFICATION_CHAT_ID no .env' };
  }

  const text = formatLeadMessage(lead);
  const key = `notifyNewLead:${lead.id || lead.email || Date.now()}:${CHAT_ID}`;
  return dedupedSend(key, () => safeSend(CHAT_ID, text, { disable_web_page_preview: true }));
}

async function sendCustomMessage(text, options = {}) {
  if (!TOKEN || !CHAT_ID) {
    return { sent: false, reason: 'not_configured' };
  }
  return await safeSend(CHAT_ID, escapeMarkdown(text), options);
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD CARD NOTIFICATIONS (v8.5)
// ═══════════════════════════════════════════════════════════════════════════

const USER_EMOJI = {
  luna: '🌙 Luna',
  abner: '👤 Abner',
  nonoke: '👤 Nonoke',
  elias: '👤 Elias',
  sistema: '🤖 Sistema',
};

function getUserLabel(user) {
  const key = String(user || '').toLowerCase().trim();
  return USER_EMOJI[key] || `👤 ${escapeMarkdown(user || 'Sistema')}`;
}

function formatDashboardCard(type, data, user) {
  const u = getUserLabel(user);
  const now = escapeMarkdown(new Date().toLocaleString('pt-BR'));

  switch (type) {
    case 'lead': {
      const action = data._action === 'convert' ? 'LEAD CONVERTIDO' : data._action === 'update' ? 'LEAD ATUALIZADO' : 'NOVO LEAD';
      const lines = [
        `🎯 *${action}*`,
        '━━━━━━━━━━━━━━',
        `👤 ${escapeMarkdown(data.name || data.displayName || '—')}`,
      ];
      if (data.email) lines.push(`📧 ${escapeMarkdown(data.email)}`);
      if (data.phone) lines.push(`📱 ${escapeMarkdown(data.phone)}`);
      if (data.value) lines.push(`💰 Valor: €${escapeMarkdown(String(data.value))}`);
      if (data.status) lines.push(`🏷️ Status: *${escapeMarkdown(data.status)}*`);
      lines.push('');
      lines.push(`🕐 ${data._action === 'convert' ? 'Convertido' : data._action === 'update' ? 'Atualizado' : 'Criado'} por ${u}`);
      return lines.join('\n');
    }

    case 'task': {
      const action = data._action === 'complete' ? 'TAREFA CONCLUÍDA' : data._action === 'update' ? 'TAREFA ATUALIZADA' : 'NOVA TAREFA';
      const lines = [
        `📋 *${action}*`,
        '━━━━━━━━━━━━━━',
        `✅ ${escapeMarkdown(data.title || '—')}`,
      ];
      if (data.description) lines.push(`📝 ${escapeMarkdown(data.description.substring(0, 200))}`);
      if (data.priority) {
        const p = data.priority.toLowerCase();
        const emoji = p === 'alta' || p === 'high' ? '🔴' : p === 'média' || p === 'medium' ? '🟡' : '🟢';
        lines.push(`${emoji} Prioridade: *${escapeMarkdown(data.priority)}*`);
      }
      if (data.status) lines.push(`📊 Status: *${escapeMarkdown(data.status)}*`);
      if (data.deadline || data.dueDate) lines.push(`📅 Deadline: ${escapeMarkdown(data.deadline || data.dueDate)}`);
      lines.push('');
      lines.push(`🕐 ${data._action === 'complete' ? 'Concluída' : data._action === 'update' ? 'Atualizada' : 'Criada'} por ${u}`);
      return lines.join('\n');
    }

    case 'payment': {
      const action = data._action === 'update' ? 'PAGAMENTO ATUALIZADO' : 'PAGAMENTO REGISTRADO';
      const lines = [
        `💰 *${action}*`,
        '━━━━━━━━━━━━━━',
        `💵 €${escapeMarkdown(String(data.amount || 0))}`,
      ];
      if (data.description) lines.push(`📝 ${escapeMarkdown(data.description)}`);
      if (data.clientName || data.client) lines.push(`👤 Cliente: ${escapeMarkdown(data.clientName || data.client)}`);
      if (data.dueDate) lines.push(`📅 Vencimento: ${escapeMarkdown(data.dueDate)}`);
      if (data.status) lines.push(`🏷️ Status: *${escapeMarkdown(data.status)}*`);
      lines.push('');
      lines.push(`🕐 ${data._action === 'update' ? 'Atualizado' : 'Registrado'} por ${u}`);
      return lines.join('\n');
    }

    case 'expense': {
      const action = data._action === 'pay' ? 'DESPESA PAGA' : data._action === 'update' ? 'DESPESA ATUALIZADA' : 'NOVA DESPESA';
      const lines = [
        `💸 *${action}*`,
        '━━━━━━━━━━━━━━',
        `💵 €${escapeMarkdown(String(data.amount || 0))}`,
      ];
      if (data.description) lines.push(`📝 ${escapeMarkdown(data.description)}`);
      if (data.category) lines.push(`🏷️ Categoria: ${escapeMarkdown(data.category)}`);
      if (data.dueDate) lines.push(`📅 Vencimento: ${escapeMarkdown(data.dueDate)}`);
      if (data.status) lines.push(`📊 Status: *${escapeMarkdown(data.status)}*`);
      lines.push('');
      lines.push(`🕐 ${data._action === 'pay' ? 'Paga' : data._action === 'update' ? 'Atualizada' : 'Criada'} por ${u}`);
      return lines.join('\n');
    }

    case 'idea': {
      const lines = [
        `💡 *NOVA IDEIA*`,
        '━━━━━━━━━━━━━━',
        `📝 ${escapeMarkdown(data.title || '—')}`,
      ];
      if (data.description) lines.push(`📄 ${escapeMarkdown(data.description.substring(0, 200))}`);
      if (data.type) lines.push(`🏷️ Tipo: ${escapeMarkdown(data.type)}`);
      if (data.priority) lines.push(`🔥 Prioridade: *${escapeMarkdown(data.priority)}*`);
      lines.push('');
      lines.push(`🕐 Criada por ${u}`);
      return lines.join('\n');
    }

    case 'quote': {
      const lines = [
        `📄 *ORÇAMENTO CRIADO*`,
        '━━━━━━━━━━━━━━',
        `📝 ${escapeMarkdown(data.title || data.clientName || '—')}`,
      ];
      if (data.description) lines.push(`📄 ${escapeMarkdown(data.description.substring(0, 200))}`);
      if (data.estimatedValue || data.value) lines.push(`💰 Valor: €${escapeMarkdown(String(data.estimatedValue || data.value || 0))}`);
      if (data.status) lines.push(`🏷️ Status: *${escapeMarkdown(data.status)}*`);
      lines.push('');
      lines.push(`🕐 Criado por ${u}`);
      return lines.join('\n');
    }

    case 'link': {
      const action = data._action === 'delete' ? 'LINK REMOVIDO' : 'LINK ADICIONADO';
      const lines = [
        `🔗 *${action}*`,
        '━━━━━━━━━━━━━━',
      ];
      if (data.title) lines.push(`📝 ${escapeMarkdown(data.title)}`);
      if (data.url) lines.push(`🌐 ${escapeMarkdown(data.url)}`);
      if (data.description) lines.push(`📄 ${escapeMarkdown(data.description.substring(0, 200))}`);
      lines.push('');
      lines.push(`🕐 ${data._action === 'delete' ? 'Removido' : 'Adicionado'} por ${u}`);
      return lines.join('\n');
    }

    case 'finance_summary': {
      const lines = [
        `📊 *RESUMO FINANCEIRO*`,
        '━━━━━━━━━━━━━━',
        `💰 Caixa: €${escapeMarkdown(String(data.cashBox || 0))}`,
        `📥 Receitas: €${escapeMarkdown(String(data.income || 0))}`,
        `📤 Despesas: €${escapeMarkdown(String(data.expenses || 0))}`,
        `📈 Saldo: €${escapeMarkdown(String(data.balance || 0))}`,
        '',
        `🕐 Atualizado por ${u}`,
      ];
      return lines.join('\n');
    }

    default: {
      const lines = [
        `📢 *${escapeMarkdown(type.toUpperCase())}*`,
        '━━━━━━━━━━━━━━',
        escapeMarkdown(JSON.stringify(data, null, 2).substring(0, 400)),
        '',
        `🕐 Por ${u}`,
      ];
      return lines.join('\n');
    }
  }
}

async function notifyDashboardChange(type, data, user = 'luna') {
  if (!TOKEN || !CHAT_ID) {
    return { sent: false, reason: 'not_configured' };
  }
  const text = formatDashboardCard(type, data, user);
  const key = `dashboard:${type}:${data?.id || data?._id || Date.now()}:${CHAT_ID}`;
  return dedupedSend(key, () => safeSend(CHAT_ID, text, { disable_web_page_preview: true }));
}

module.exports = {
  notifyNewLead,
  sendCustomMessage,
  notifyDashboardChange,
  formatDashboardCard,
  isConfigured: !!TOKEN && !!CHAT_ID,
};
