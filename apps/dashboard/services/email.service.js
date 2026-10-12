/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Email Service — NEXO Dashboard PRO
 * Envio de emails transacionais via Nodemailer (SMTP)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Fallback: se SMTP não configurado, notifica via Discord
 * ═══════════════════════════════════════════════════════════════════════════
 */

const nodemailer = require('nodemailer');

// Configuração SMTP via variáveis de ambiente
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const NEXO_NOTIFICATION_EMAIL = process.env.NEXO_NOTIFICATION_EMAIL || 'contacto@nexo-digital.app';

const isConfigured = SMTP_HOST && SMTP_USER && SMTP_PASS;

let transporter = null;

if (isConfigured) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
  console.log('[EmailService] SMTP configurado:', SMTP_HOST);
} else {
  console.warn('[EmailService] SMTP NÃO configurado. Emails não serão enviados. Use variáveis SMTP_HOST, SMTP_USER, SMTP_PASS');
}

/**
 * Envia email de notificação de novo lead
 */
async function sendLeadNotification(lead) {
  if (!isConfigured || !transporter) {
    return { success: false, error: 'SMTP não configurado' };
  }

  const subject = `🎯 Novo Lead — Demo Request | ${lead.companyName || 'Sem empresa'}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Inter', sans-serif; background: #08080c; color: #e0e0e0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #0f0f16; border-radius: 12px; padding: 32px; border: 1px solid #1a1a2e; }
    h1 { font-size: 20px; margin-bottom: 24px; color: #00f0ff; }
    .field { margin-bottom: 16px; }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #6c757d; margin-bottom: 4px; }
    .value { font-size: 14px; color: #e0e0e0; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; background: rgba(0,240,255,0.1); color: #00f0ff; border: 1px solid rgba(0,240,255,0.2); }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #1a1a2e; font-size: 12px; color: #6c757d; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎯 Novo Lead — Demo Request</h1>
    
    <div class="field">
      <div class="label">Nome</div>
      <div class="value">${escapeHtml(lead.displayName)}</div>
    </div>
    
    <div class="field">
      <div class="label">Email</div>
      <div class="value">${escapeHtml(lead.email)}</div>
    </div>
    
    <div class="field">
      <div class="label">Empresa</div>
      <div class="value">${escapeHtml(lead.companyName || 'Não informado')}</div>
    </div>
    
    <div class="field">
      <div class="label">Tamanho da equipe</div>
      <div class="value"><span class="badge">${escapeHtml(lead.companySize || 'Não informado')}</span></div>
    </div>
    
    <div class="field">
      <div class="label">Telefone</div>
      <div class="value">${escapeHtml(lead.phone || 'Não informado')}</div>
    </div>
    
    <div class="field">
      <div class="label">Mensagem</div>
      <div class="value">${escapeHtml(lead.notes || 'Nenhuma mensagem')}</div>
    </div>
    
    <div class="field">
      <div class="label">Data do envio</div>
      <div class="value">${new Date().toLocaleString('pt-BR')}</div>
    </div>
    
    <div class="footer">
      Enviado automaticamente pelo NEXO Dashboard PRO<br>
      <a href="https://nexodashboard.onrender.com/leads" style="color: #00f0ff;">Ver no dashboard →</a>
    </div>
  </div>
</body>
</html>
  `;

  const text = `
🎯 Novo Lead — Demo Request

Nome: ${lead.displayName}
Email: ${lead.email}
Empresa: ${lead.companyName || 'Não informado'}
Tamanho: ${lead.companySize || 'Não informado'}
Telefone: ${lead.phone || 'Não informado'}
Mensagem: ${lead.notes || 'Nenhuma'}
Data: ${new Date().toLocaleString('pt-BR')}

Ver no dashboard: https://nexodashboard.onrender.com/leads
  `.trim();

  try {
    const info = await transporter.sendMail({
      from: `"NEXO Dashboard" <${SMTP_USER}>`,
      to: NEXO_NOTIFICATION_EMAIL,
      subject,
      text,
      html
    });
    console.log('[EmailService] Lead notification enviado:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[EmailService] Erro ao enviar email:', err.message);
    return { success: false, error: err.message };
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Envia email genérico via SMTP (usado como fallback quando Gmail OAuth não está disponível)
 */
async function sendEmail({ to, subject, text, html, cc, bcc, attachments = [] }) {
  if (!isConfigured || !transporter) {
    throw new Error('SMTP não configurado. Configure SMTP_HOST, SMTP_USER e SMTP_PASS no .env');
  }

  const info = await transporter.sendMail({
    from: `"NEXO Digital" <${SMTP_USER}>`,
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    attachments: attachments.map(a => ({
      filename: a.filename || a.name,
      path: a.path || a.content,
      content: a.content
    })).filter(a => a.filename || a.content)
  });

  console.log('[EmailService] Email enviado:', info.messageId);
  return { success: true, messageId: info.messageId, to, subject };
}

module.exports = {
  sendLeadNotification,
  sendEmail,
  isConfigured
};
