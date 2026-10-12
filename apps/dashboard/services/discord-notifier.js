/**
 * Serviço de Notificações Discord para @mentions
 * Envia mensagens no Discord quando usuários são mencionados em comentários
 * 
 * Templates suportados:
 * - task: Tarefa mencionada
 * - finance: Transação/finança mencionada
 * - email: Email mencionado
 * - idea: Ideia mencionada
 * - lead: Lead mencionado
 */

const fs = require('fs');
const path = require('path');

// Webhook do Discord — será injetado pelo server.js
let DISCORD_MENTION_WEBHOOK = process.env.DISCORD_MENTION_WEBHOOK || process.env.DISCORD_SECURITY_WEBHOOK || '';

function setWebhookUrl(url) {
  DISCORD_MENTION_WEBHOOK = url;
}

// Cache de usuários (com discordId)
let usersCache = null;
let usersCacheTime = 0;
const USERS_CACHE_TTL = 30000; // 30s

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
    console.error('[DiscordNotifier] Erro ao carregar users:', e.message);
    return {};
  }
}

/**
 * Resolve menções de usuários para IDs do Discord
 * @param {string[]} mentions - Array de userIds (ex: ['nonoke', 'elias'])
 * @returns {string[]} Array de discord mentions formatados (<@id>)
 */
function resolveMentions(mentions) {
  const users = getUsers();
  const resolved = [];
  
  for (const userId of mentions) {
    const user = users[userId];
    if (user?.discordId) {
      resolved.push(`<@${user.discordId}>`);
    } else {
      // Fallback: usa o nome do usuário como texto
      resolved.push(`@${user?.name || userId}`);
    }
  }
  
  return resolved;
}

/**
 * Templates de notificação por tipo
 */
const templates = {
  task: {
    color: 0x6366f1, // Indigo
    emoji: '✅',
    title: 'Tarefa',
    getTitle: (entity) => entity.title || 'Sem título',
    getDescription: (entity, comment) => {
      const parts = [];
      if (entity.description) parts.push(`**Descrição:** ${entity.description.substring(0, 200)}${entity.description.length > 200 ? '...' : ''}`);
      if (entity.status) parts.push(`**Status:** ${entity.status}`);
      if (entity.priority) parts.push(`**Prioridade:** ${entity.priority}`);
      if (entity.assignedTo) parts.push(`**Responsável:** ${entity.assignedTo}`);
      return parts.join('\n') || '_Sem detalhes_';
    },
    getUrl: (entity, baseUrl) => `${baseUrl}/tarefas`,
  },
  
  finance: {
    color: 0x10b981, // Emerald
    emoji: '💰',
    title: 'Finança',
    getTitle: (entity) => entity.description || entity.title || 'Transação',
    getDescription: (entity, comment) => {
      const parts = [];
      if (entity.amount) parts.push(`**Valor:** €${entity.amount}`);
      if (entity.type) parts.push(`**Tipo:** ${entity.type}`);
      if (entity.category) parts.push(`**Categoria:** ${entity.category}`);
      if (entity.date) parts.push(`**Data:** ${entity.date}`);
      if (entity.paidBy) parts.push(`**Pago por:** ${entity.paidBy}`);
      return parts.join('\n') || '_Sem detalhes_';
    },
    getUrl: (entity, baseUrl) => `${baseUrl}/financeiro`,
  },
  
  email: {
    color: 0xf59e0b, // Amber
    emoji: '📧',
    title: 'Email',
    getTitle: (entity) => entity.subject || 'Sem assunto',
    getDescription: (entity, comment) => {
      const parts = [];
      if (entity.from) parts.push(`**De:** ${entity.from}`);
      if (entity.to) parts.push(`**Para:** ${entity.to}`);
      if (entity.snippet) parts.push(`**Preview:** ${entity.snippet.substring(0, 200)}${entity.snippet.length > 200 ? '...' : ''}`);
      return parts.join('\n') || '_Sem detalhes_';
    },
    getUrl: (entity, baseUrl) => `${baseUrl}/email`,
  },
  
  idea: {
    color: 0xec4899, // Pink
    emoji: '💡',
    title: 'Ideia',
    getTitle: (entity) => entity.title || 'Sem título',
    getDescription: (entity, comment) => {
      const parts = [];
      if (entity.description) parts.push(`**Descrição:** ${entity.description.substring(0, 200)}${entity.description.length > 200 ? '...' : ''}`);
      if (entity.category) parts.push(`**Categoria:** ${entity.category}`);
      if (entity.status) parts.push(`**Status:** ${entity.status}`);
      return parts.join('\n') || '_Sem detalhes_';
    },
    getUrl: (entity, baseUrl) => `${baseUrl}/ideias`,
  },
  
  lead: {
    color: 0x3b82f6, // Blue
    emoji: '🎯',
    title: 'Lead',
    getTitle: (entity) => entity.name || entity.title || 'Lead',
    getDescription: (entity, comment) => {
      const parts = [];
      if (entity.phone) parts.push(`**Telefone:** ${entity.phone}`);
      if (entity.email) parts.push(`**Email:** ${entity.email}`);
      if (entity.source) parts.push(`**Fonte:** ${entity.source}`);
      if (entity.status) parts.push(`**Status:** ${entity.status}`);
      if (entity.notes) parts.push(`**Notas:** ${entity.notes.substring(0, 200)}${entity.notes.length > 200 ? '...' : ''}`);
      return parts.join('\n') || '_Sem detalhes_';
    },
    getUrl: (entity, baseUrl) => `${baseUrl}/leads`,
  },
  
  // Fallback genérico
  default: {
    color: 0x6b7280, // Gray
    emoji: '📌',
    title: 'Item',
    getTitle: (entity) => entity.title || entity.name || entity.subject || 'Item',
    getDescription: (entity, comment) => '_Sem detalhes disponíveis_',
    getUrl: (entity, baseUrl) => baseUrl,
  }
};

/**
 * Envia notificação de menção para o Discord
 * 
 * @param {Object} options
 * @param {string} options.type - Tipo da entidade (task, finance, email, idea, lead)
 * @param {Object} options.entity - Dados da entidade (tarefa, transação, email, etc.)
 * @param {string} options.comment - Texto do comentário
 * @param {string} options.author - Nome do autor do comentário
 * @param {string[]} options.mentions - Array de userIds mencionados
 * @param {string} [options.baseUrl] - URL base do dashboard
 */
async function sendMentionNotification({ type, entity, comment, author, mentions, baseUrl }) {
  if (!DISCORD_MENTION_WEBHOOK) {
    console.warn('[DiscordNotifier] Webhook não configurado');
    return { sent: false, reason: 'webhook_not_configured' };
  }
  
  if (!mentions || mentions.length === 0) {
    return { sent: false, reason: 'no_mentions' };
  }
  
  const template = templates[type] || templates.default;
  const discordMentions = resolveMentions(mentions);
  const url = baseUrl || (process.env.NODE_ENV === 'production' 
    ? 'https://nexodashboard.onrender.com' 
    : 'http://localhost:3457');
  
  // Resolve nome do autor
  const users = getUsers();
  const authorName = users[author]?.name || author;
  const authorDiscordId = users[author]?.discordId;
  
  const entityTitle = template.getTitle(entity);
  const entityDesc = template.getDescription(entity, comment);
  const entityUrl = template.getUrl(entity, url);
  
  // Trunca comentário se for muito longo
  const truncatedComment = comment.length > 500 
    ? comment.substring(0, 500) + '...' 
    : comment;
  
  const embed = {
    title: `${template.emoji} ${template.title}: ${entityTitle}`,
    url: entityUrl,
    color: template.color,
    description: entityDesc,
    fields: [
      {
        name: '💬 Comentário',
        value: `> ${truncatedComment}`,
        inline: false
      },
      {
        name: '👤 Autor',
        value: authorDiscordId ? `<@${authorDiscordId}> (${authorName})` : authorName,
        inline: true
      },
      {
        name: '🕐 Data',
        value: `<t:${Math.floor(Date.now() / 1000)}:f>`,
        inline: true
      }
    ],
    footer: {
      text: 'NEXO Dashboard Pro — Notificação de Menção',
      icon_url: 'https://cdn-icons-png.flaticon.com/512/564/564419.png'
    },
    timestamp: new Date().toISOString()
  };
  
  const payload = {
    content: `${discordMentions.join(' ')} 🔔 Você foi mencionado em um comentário!`,
    embeds: [embed],
    allowed_mentions: {
      users: mentions.map(m => users[m]?.discordId).filter(Boolean)
    }
  };
  
  try {
    const response = await fetch(DISCORD_MENTION_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.error('[DiscordNotifier] Webhook falhou:', response.status, text);
      return { sent: false, reason: 'webhook_error', status: response.status, error: text };
    }
    
    console.log('[DiscordNotifier] Notificação enviada para', mentions.join(', '));
    return { sent: true, mentions: discordMentions };
  } catch (err) {
    console.error('[DiscordNotifier] Erro ao enviar:', err.message);
    return { sent: false, reason: 'network_error', error: err.message };
  }
}

/**
 * Envia notificação simples (sem embed, para uso rápido)
 */
async function sendSimpleMessage(content, options = {}) {
  if (!DISCORD_MENTION_WEBHOOK) {
    console.warn('[DiscordNotifier] Webhook não configurado');
    return { sent: false, reason: 'webhook_not_configured' };
  }
  
  const payload = {
    content,
    ...options
  };
  
  try {
    const response = await fetch(DISCORD_MENTION_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.error('[DiscordNotifier] Webhook falhou:', response.status, text);
      return { sent: false, reason: 'webhook_error', status: response.status, error: text };
    }
    
    return { sent: true };
  } catch (err) {
    console.error('[DiscordNotifier] Erro ao enviar:', err.message);
    return { sent: false, reason: 'network_error', error: err.message };
  }
}

/**
 * Envia uma mensagem genérica (embeds) para o webhook Discord configurado
 * @param {Object} payload - { content?, embeds?, username?, avatar_url? }
 */
async function sendWebhookMessage(payload) {
  if (!DISCORD_MENTION_WEBHOOK) {
    return { sent: false, reason: 'webhook_not_set' };
  }
  try {
    const res = await fetch(DISCORD_MENTION_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      return { sent: true, status: res.status };
    }
    const text = await res.text();
    return { sent: false, reason: 'discord_error', status: res.status, error: text };
  } catch (err) {
    return { sent: false, reason: 'network_error', error: err.message };
  }
}

module.exports = {
  sendMentionNotification,
  sendSimpleMessage,
  sendWebhookMessage,
  resolveMentions,
  templates,
  setWebhookUrl
};
