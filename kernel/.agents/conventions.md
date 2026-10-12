# Conventions

> Verified against the code on 2026-07-11. Paths are relative to the repo root.

## Monorepo layout

pnpm workspaces (`pnpm-workspace.yaml`): `packages/*`, `apps/*`, `packages/kernel/luna-web`.

- `packages/kernel` — **@luna/kernel**: agent brain, Kimi/DeepSeek bridge, Telegram adapter.
- `packages/kernel/luna-web` — **luna-web**: Svelte 4 + Vite frontend; `dist/` is committed
  on purpose (production serves the static build).
- `apps/dashboard` — **@luna/dashboard**: web backend, REST/SSE APIs, dashboard UI.
  `luna-server.js` = main Luna server (:3458); `server.js` = legacy dashboard API (:3456).

## Prerequisites

- Node.js **≥ 22** (root `package.json` engines)
- pnpm **11.9.x** via corepack (`packageManager: pnpm@11.9.0`)
- Google Chrome/Chromium (the isolated CDP instance on :9222)
- PM2 (production)

## Commands

```bash
corepack pnpm install        # install all workspaces
corepack pnpm build          # builds luna-web (corepack pnpm -r build)
corepack pnpm --filter luna-web dev  # Vite dev server (:5173)
corepack pnpm dev:dashboard          # Luna backend (:3458)

pm2 start pm2-ecosystem.config.js   # production
pm2 save
```

## Code style

- Kernel scripts are CommonJS `.cjs` files (luna-soul.cjs, kimi-bridge.cjs, …).
- Frontend: Svelte 4 + Vite (`packages/kernel/luna-web`), Tailwind + PostCSS configs live
  in `packages/kernel/`.
- Dashboard backend: plain CommonJS `.js` Express modules.
- Comments/log messages in kernel code are mostly Portuguese (BR) — match the surrounding
  file; user-facing strings stay in pt-BR. Docs in `.agents/` and `.brain/` are English.

## Environment variables

`.env` files exist at the repo root, `apps/dashboard/.env` (loaded by `luna-server.js`
via dotenv) and `packages/kernel/.env`. `config/luna-config.js` also points
`PATHS.env` at `$LUNA_HOME/.env`.

- `TELEGRAM_BOT_TOKEN` — required by `luna-telegram-adapter` (owner's PC only).
- `TELEGRAM_GROUP_CHAT_ID` — NEXO Digital group (see `.agents/runbooks/telegram-409-conflict.md`).
- `INTERNAL_API_TOKEN` — service token (`AUTH.serviceToken` in luna-config).
- `JWT_SECRET` — dashboard auth (`AUTH.jwtSecret`, default `nexo-test-secret-2026`, 8h expiry).
- `LUNA_PORT` — Luna web server port (default 3458). Also `DASHBOARD_PORT` (3456).
- `LUNA_KERNEL_DIR`, `LUNA_DIR`, `NEXO_DIR`, `LUNA_HOME` — path overrides; PM2 sets the
  first three to the monorepo locations automatically.

## Tests

- `packages/kernel/tests/url-landing.test.cjs` — plain Node script, no framework:
  `node packages/kernel/tests/url-landing.test.cjs` (covers `normalizeBaseUrl` /
  landing-URL comparison). All tests pass as of 2026-07-11.
- `apps/dashboard/__tests__/*.test.js` — Jest suite (`apps/dashboard/jest.config.js`;
  18 files: users, leads, tasks, payments, …). Run from `apps/dashboard` with
  `npx jest` (no `test` script is declared in `apps/dashboard/package.json`; the root
  `corepack pnpm test` maps to `pnpm -r test` and currently has nothing to run).

## Git

- **Active development branch: `Luna-Abner`.** All agent commits and pushes must target
  `Luna-Abner`; do not push directly to `main` unless the owner explicitly requests it.
- Run `git checkout Luna-Abner` before making changes.
- Push with `git push origin Luna-Abner`.
- Other PCs (Pai, Nonoke) should pull from `origin/Luna-Abner` and run the rebuild/restart
  routine — see `docs/guia-humano.md`, section 6 ("Sincronización entre los 3 PCs"). Note:
  the legacy `luna-sync.sh` script still references pre-monorepo paths and the old `main`
  branch; it needs to be updated to pull `Luna-Abner` and use the monorepo layout.
- Do not commit secrets; `.env` files are local-only.

## PM2 processes (`pm2-ecosystem.config.js` at repo root)

| Name | Script | Notes |
|---|---|---|
| `luna-server` | `apps/dashboard/luna-server.js` | Luna chat + API, :3458, serves `luna-web/dist` |
| `nexo-dashboard` | `apps/dashboard/server.js` | Legacy dashboard API, :3456 |
| `luna-vite` | `packages/kernel/luna-web` vite | Dev server, :5173 (not started by default in production) |
| `luna-health-watchdog` | `packages/kernel/luna-health-watchdog.js` | Health monitor — **disabled** as of 2026-08-03 because it caused restart loops |
| `luna-telegram-adapter` | `packages/kernel/telegram-luna-adapter.cjs` | Telegram bot — **exact name is `luna-telegram-adapter`, not `telegram-bot`** |

Current minimal production set: `luna-server` + `nexo-dashboard`.
Full optional set adds `luna-vite` (dev) and `luna-telegram-adapter` (Telegram).
Logs: `pm2 logs <name>`.
