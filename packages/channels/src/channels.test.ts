import { describe, it, expect } from 'vitest';
import nodemailer from 'nodemailer';
import { sendEmail, EmailNotConfigured, emailConfigured } from './email.js';
import { sendPush, PushNotConfigured, pushConfigured, generateVapidKeys } from './push.js';

describe('email (§22, fail-closed)', () => {
  it('sem SMTP_URL: falha explícita, nunca silêncio', async () => {
    expect(emailConfigured({})).toBe(false);
    await expect(sendEmail('a@b.com', 't', 'b', {})).rejects.toThrow(EmailNotConfigured);
  });

  it('com transporter injetado: envia e devolve messageId', async () => {
    const stub = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: 'unix',
    });
    const r = await sendEmail('cliente@nexo.dev', 'Status do projeto', 'Corpo', { smtpUrl: 'smtp://x' }, stub);
    expect(r.ok).toBe(true);
    expect(r.messageId).toBeTruthy();
  });
});

describe('push PWA (§22, fail-closed)', () => {
  it('sem VAPID: falha explícita', async () => {
    expect(pushConfigured({})).toBe(false);
    await expect(
      sendPush({ endpoint: 'https://x', keys: { p256dh: 'p', auth: 'a' } }, { title: 't', body: 'b' }, {}),
    ).rejects.toThrow(PushNotConfigured);
  });

  it('com VAPID + sender injetado: envia', async () => {
    const keys = generateVapidKeys();
    expect(keys.publicKey.length).toBeGreaterThan(10);
    const sent: string[] = [];
    const r = await sendPush(
      { endpoint: 'https://push.example/sub', keys: { p256dh: 'p', auth: 'a' } },
      { title: 'Nexo', body: 'Seu site foi atualizado' },
      { publicKey: keys.publicKey, privateKey: keys.privateKey },
      async (_sub, data) => {
        sent.push(data);
      },
    );
    expect(r.ok).toBe(true);
    expect(JSON.parse(sent[0]!)).toEqual({ title: 'Nexo', body: 'Seu site foi atualizado' });
  });
});
