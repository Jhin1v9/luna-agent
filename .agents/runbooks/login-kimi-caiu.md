# Runbook: Kimi login lost

## Symptoms

- kimi.com shows the login screen inside the isolated Chrome (CDP :9222).
- Bridge logs report login indicators / `login_required` events; requests stall.
- Root cause: Kimi uses short-lived JWT sessions; Chrome restarts or token refresh
  expiry invalidate them (previously documented in `packages/kernel/COOKIES_KIMI.md`,
  deleted on 2026-07-11 — no longer exists).

## Check first

```bash
curl -s http://localhost:9222/json/version | head -c 300   # is the isolated Chrome up?
curl -s http://localhost:9222/json | grep -i kimi          # is there a kimi.com tab?
```

Cookie files (all under `packages/kernel/`, from `kimi-bridge.cjs:85-86`):

- `kimi-cookies.json` — automatic backup, rewritten every ~5 minutes (kimi-bridge.cjs:1250)
- `kimi-cookies.manual.json` — drop manually exported cookies here
- `$LUNA_HOME/ARTIFACTS/kimi-cookies-backup.json` — secondary artifact backup (kimi-bridge.cjs:1876)
- Per-provider master files named in `provider-configs/kimi.json`:
  `kimi-master-cookies.json`, `kimi-master-localstorage.json`

## Fix (in order)

1. **Manual login in the isolated Chrome (preferred).** Open the Chrome instance that
   runs with `--remote-debugging-port=9222` (profile dir: `packages/kernel/chrome-profile`,
   kimi-bridge.cjs:4363), go to https://www.kimi.com, log in normally. The bridge saves
   the cookies automatically within ~5 minutes. Nothing else to do.
2. **Restore from backup.** The bridge tries this automatically from `kimi-cookies.json`;
   if the file is stale/corrupt, check it:
   ```bash
   node -e "console.log(JSON.parse(require('fs').readFileSync('packages/kernel/kimi-cookies.json','utf8')).length)"
   ```
3. **Export from your personal Chrome.** With a cookie-export extension, export the
   kimi.com cookies, save them as `packages/kernel/kimi-cookies.manual.json`, then
   restart the backend: `pm2 restart luna-server`.

## Warnings

- **NEVER hard-reload (Ctrl+Shift+R) the Kimi tab** — it can discard the session and
  force a fresh login (operational rule from `COOKIES_KIMI.md` maintenance history).
- **Keep the isolated Chrome always open.** Closing it invalidates the session; the
  persistent profile only helps if the browser stays running.
- Do not log into kimi.com from another browser with the same account while debugging —
  concurrent sessions accelerate token rotation.
