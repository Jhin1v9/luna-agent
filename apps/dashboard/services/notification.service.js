/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Notification Service — NEXO Dashboard PRO
 * Orquestra notificações: Email (primário) → Discord → Telegram
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const { sendLeadNotification, isConfigured: emailConfigured } = require('./email.service');
const { sendWebhookMessage } = require('./discord-notifier');
const telegramNotifier = require('./telegram-notifier');

/**
 * Notifica a equipe NEXO sobre um novo lead
 * 1. Tenta enviar email (SMTP)
 * 2. Se falhar, notifica no Discord (webhook)
 * 3. Sempre retorna status para o caller
 */
async function notifyNewLead(lead) {
  const results = {
    email: null,
    discord: null,
    telegram: null
  };

  // 1. Tentar email
  if (emailConfigured) {
    try {
      results.email = await sendLeadNotification(lead);
    } catch (err) {
      results.email = { success: false, error: err.message };
    }
  }

  // 2. Fallback Discord (sempre tenta, independente do email)
  try {
    const discordMessage = {
      content: null,
      embeds: [{
        title: '🎯 Novo Lead — Demo Request',
        description: `**${lead.displayName}** solicitou uma demo personalizada.`,
        color: 0x00f0ff,
        fields: [
          { name: '📧 Email', value: lead.email || 'N/A', inline: true },
          { name: '🏢 Empresa', value: lead.companyName || 'N/A', inline: true },
          { name: '👥 Equipe', value: lead.companySize || 'N/A', inline: true },
          { name: '📱 Telefone', value: lead.phone || 'N/A', inline: true },
          { name: '📝 Mensagem', value: lead.notes ? lead.notes.substring(0, 500) : 'Nenhuma', inline: false }
        ],
        footer: {
          text: `NEXO Dashboard • ${new Date().toLocaleString('pt-BR')}`
        }
      }]
    };

    // Envia via discord-notifier (webhook já configurado no server.js)
    const discordRes = await sendWebhookMessage(discordMessage);
    results.discord = { success: discordRes.sent, status: discordRes.status, error: discordRes.error };
  } catch (err) {
    results.discord = { success: false, error: err.message };
  }

  // 3. Telegram (sempre tenta, é o canal mais rápido para a equipe)
  try {
    results.telegram = await telegramNotifier.sendLeadNotification({
      displayName: lead.displayName,
      email: lead.email,
      companyName: lead.companyName,
      companySize: lead.companySize,
      phone: lead.phone,
      notes: lead.notes,
      source: lead.source || 'website',
      status: 'potencial',
      pipelineStatus: 'novo',
      estimatedValue: 0,
      currency: 'EUR',
      tags: [],
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    results.telegram = { sent: false, error: err.message };
  }

  // Log resumo
  const emailOk = results.email?.success;
  const discordOk = results.discord?.success;
  const telegramOk = results.telegram?.sent;
  if (emailOk || discordOk || telegramOk) {
    console.log('[NotificationService] Lead notificado:', { email: emailOk, discord: discordOk, telegram: telegramOk });
  } else {
    console.warn('[NotificationService] Nenhuma notificação entregue:', results);
  }

  return results;
}

module.exports = {
  notifyNewLead
};
