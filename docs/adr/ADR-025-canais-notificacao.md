# ADR-025 — Canais de notificação: email via SMTP (nodemailer), push via Web Push (VAPID)

- **Status:** aceito (2026-09-21, F2 — Blocos 2/3)
- **Contexto:** §22 manda notificações nos canais que o CLIENTE escolher
  (um, dois ou os três: WhatsApp, email, push) com deliveries por canal e
  estado. E o contrato §9 do router exige validação de capability no boot.

## Decisão

1. **Email: nodemailer com SMTP_URL** (connection string, ex.
   `smtp://user:pass@host:587`) — simples, sem vendor lock-in; funciona com
   Gmail/Outlook/Resend-SMTP/etc. `SMTP_FROM` configurável.
2. **Push: web-push com VAPID** (Web Push padrão, gratuito) — o portal PWA
   do cliente assina e guarda a subscription em
   `channel_preferences.config.subscription` (schema existente, sem migração).
   Gerar par VAPID: `pnpm --filter @luna/channels vapid`.
3. **Fail-closed explícito**: sem credencial, o canal NÃO é silenciado — o
   boot loga a capability de cada canal e toda delivery para canal não
   configurado fica `failed` com o motivo em `notifications.error` + audit.
   Cliente sem preferências cadastradas → whatsapp como canal base (com
   nota de auditoria), nunca silêncio total.
4. **Dedupe**: `notifications.idempotency_key` UNIQUE (migração 006) —
   `notif:{evento}:{canal}`; republicar o mesmo evento não reenvia nada.
5. Deliveries: `pending → sent | failed`; `delivered` (confirmação do
   provider) entra quando houver webhook/recibo — hoje `sent_at`/`delivered_at`
   marcam o envio aceito.

## Pendência (fora do decreto, registrado)

- Telegram do time (@lunanexobot): token perdido, owner vai reemitir pelo
  @BotFather. Quando `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` aparecerem no
  `.env`, TODOS os alertas (escalação, watchdog, auto-reparo, self-test)
  passam a enviar **sem mudança de código** (config lida no boot; basta
  reiniciar os daemons via `pm2 restart all`).
