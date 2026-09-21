import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Email (§22) — SMTP via connection URL (config/SMTP_URL). Fail-closed:
 * sem credencial, o envio falha EXPLICITAMENTE (nunca silêncio) e a
 * delivery fica 'failed' com o motivo. Boot loga a capability (§9-style).
 */

export interface EmailConfig {
  smtpUrl?: string;
  from?: string;
}

export class EmailNotConfigured extends Error {
  constructor() {
    super('Email desligado: SMTP_URL ausente no .env (fail-closed, §22).');
    this.name = 'EmailNotConfigured';
  }
}

let cachedTransport: Transporter | null = null;

export function emailConfigured(config: EmailConfig): boolean {
  return !!config.smtpUrl;
}

function transport(config: EmailConfig): Transporter {
  if (!config.smtpUrl) throw new EmailNotConfigured();
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport(config.smtpUrl);
  }
  return cachedTransport;
}

/** Injetável para testes (transporter fake do nodemailer). */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  config: EmailConfig,
  transporterOverride?: Transporter,
): Promise<{ ok: boolean; messageId?: string }> {
  const t = transporterOverride ?? transport(config);
  const info = await t.sendMail({
    from: config.from ?? 'Luna <luna@nexo-digital.local>',
    to,
    subject,
    text,
  });
  return { ok: true, messageId: info.messageId };
}
