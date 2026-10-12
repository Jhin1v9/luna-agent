# Runbook: Telegram 409 Conflict

## Symptoms

- Adapter logs show `409 Conflict: terminated by other getUpdates request` (or similar).
- Bot stops responding or responds intermittently.

## Cause

More than one process is long-polling the same `TELEGRAM_BOT_TOKEN` — typically an
orphaned adapter left behind after a restart, or a second machine running the bot.
Telegram allows exactly one poller per token. The bot client
(`apps/dashboard/services/telegram-bot-client.cjs:28-32`) treats transient 409s right
after a restart as warnings; a persistent 409 means a real duplicate.

## Fix

```bash
# 1. Remove the PM2 process (exact name from pm2-ecosystem.config.js)
pm2 delete luna-telegram-adapter

# 2. Kill orphaned adapters NOT managed by PM2
pgrep -af telegram-luna-adapter        # inspect first
pkill -f telegram-luna-adapter.cjs     # then kill

# 3. Start it back under PM2
pm2 start pm2-ecosystem.config.js --only luna-telegram-adapter
# or: pm2 restart luna-telegram-adapter   (if you skipped step 1)

pm2 logs luna-telegram-adapter --lines 30   # confirm "Telegram polling ativo"
```

If 409 persists, check that no OTHER machine (or a stray `node` from a manual run,
a VPS deploy, or an old tmux/screen session) is polling the same token.

## Notes

- The bot runs **only on the owner's PC by design** (decision 2026-07-04, commit
  44ef35f): it is not part of end-user installs and requires `TELEGRAM_BOT_TOKEN` at
  install time.
- Reference group (this runbook is now the canonical copy; the old
  `packages/kernel/.telegram-group-ref.md` was deleted on 2026-07-11):
  - **CHAT_ID: `-1003915957914`** — group "Nexo Digital" (https://t.me/+MZRRqsApkFw0OTNk,
    4 CEOs). Used for dashboard voting notifications; bot: @lunanexobot.
  - Env var: `TELEGRAM_GROUP_CHAT_ID=-1003915957914`.
