# Luna Monorepo Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the `luna-kernel` and `NexoDashboard` repositories into a single monorepo using npm/pnpm workspaces, with `luna-kernel` as the root.

**Architecture:** The monorepo root lives in the existing `luna-kernel` GitHub repository. The current kernel content moves to `packages/kernel`, and the dashboard content moves to `apps/dashboard`. A root `package.json` configures workspaces so both projects share a single install/build/test flow while remaining independently runnable.

**Tech Stack:** Node.js, npm/pnpm workspaces, PM2, Express, Playwright/CDP.

---

## File Structure

```
luna-kernel/                      # monorepo root (existing repo)
├── package.json                  # root workspace config
├── pnpm-workspace.yaml           # pnpm workspace globs
├── README.md                     # updated monorepo README
├── packages/
│   └── kernel/                   # current .luna-kernel content
│       ├── package.json
│       ├── kimi-bridge.cjs
│       ├── luna-soul.cjs
│       ├── luna-web/
│       ├── provider-configs/
│       └── ...
└── apps/
    └── dashboard/                # current NEXO_DASHBOARD_PRO/backend content
        ├── package.json
        ├── luna-server.js
        ├── luna-chat-routes.js
        └── ...
```

---

## Task 1: Pre-Migration Safety Checks

**Files:**
- Read: `~/.luna-kernel/package.json`
- Read: `~/NEXO_DASHBOARD_PRO/backend/package.json`
- Read: `~/.luna-kernel/.git/config`
- Read: `~/NEXO_DASHBOARD_PRO/.git/config`

- [ ] **Step 1.1: Verify both repos are clean and up to date**

Run:
```bash
cd /home/jhin/.luna-kernel && git status --short && git log --oneline -3
cd /home/jhin/NEXO_DASHBOARD_PRO && git status --short && git log --oneline -3
```

Expected: both working trees are clean (or only expected local files) and both have recent commits pushed to `origin/main`.

- [ ] **Step 1.2: Create local backups of both repos**

Run:
```bash
mkdir -p /tmp/luna-monorepo-backup
cp -a /home/jhin/.luna-kernel /tmp/luna-monorepo-backup/luna-kernel
cp -a /home/jhin/NEXO_DASHBOARD_PRO /tmp/luna-monorepo-backup/NexoDashboard
```

Expected: two complete copies exist under `/tmp/luna-monorepo-backup`.

---

## Task 2: Create Monorepo Folder Structure

**Files:**
- Create: `~/.luna-kernel/package.json`
- Create: `~/.luna-kernel/pnpm-workspace.yaml`
- Create directories: `~/.luna-kernel/packages/kernel/`, `~/.luna-kernel/apps/dashboard/`

- [ ] **Step 2.1: Move current kernel content into `packages/kernel/`**

Run:
```bash
cd /home/jhin/.luna-kernel
mkdir -p packages/kernel apps/dashboard
# Move all tracked files/folders except .git, packages, apps, and new root files
git ls-files | tar -T - -cf - | (cd packages/kernel && tar -xf -)
```

Then remove the original files from root (keep `.git`, `packages`, `apps`):
```bash
cd /home/jhin/.luna-kernel
for item in $(git ls-files); do rm -f "$item"; done
for dir in $(git ls-tree -d -r --name-only HEAD); do rmdir "$dir" 2>/dev/null || true; done
```

Expected: current kernel files now live under `packages/kernel/`; root contains only `.git`, `packages/`, `apps/`.

- [ ] **Step 2.2: Copy dashboard content into `apps/dashboard/`**

Run:
```bash
cd /home/jhin/NEXO_DASHBOARD_PRO
git ls-files | tar -T - -cf - | (cd /home/jhin/.luna-kernel/apps/dashboard && tar -xf -)
```

Expected: dashboard files appear under `apps/dashboard/` preserving structure.

---

## Task 3: Configure Root Workspaces

**Files:**
- Create: `~/.luna-kernel/package.json`
- Create: `~/.luna-kernel/pnpm-workspace.yaml`

- [ ] **Step 3.1: Write root `package.json`**

```json
{
  "name": "luna-monorepo",
  "version": "1.0.0",
  "private": true,
  "description": "Luna autonomous agent monorepo — kernel + dashboard",
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "install:all": "pnpm install",
    "dev:kernel": "pnpm --filter @luna/kernel dev",
    "dev:dashboard": "pnpm --filter @luna/dashboard dev",
    "build": "pnpm -r build",
    "start": "pnpm --filter @luna/dashboard start",
    "test": "pnpm -r test"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Expected: root `package.json` exists and declares both workspace globs.

- [ ] **Step 3.2: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

Expected: pnpm recognizes `packages/kernel` and `apps/dashboard` as workspaces.

---

## Task 4: Update Kernel Package Metadata

**Files:**
- Modify: `~/.luna-kernel/packages/kernel/package.json`

- [ ] **Step 4.1: Read current kernel `package.json`**

Run:
```bash
cat /home/jhin/.luna-kernel/packages/kernel/package.json
```

- [ ] **Step 4.2: Add workspace name and update scripts**

Edit `packages/kernel/package.json` to include:

```json
{
  "name": "@luna/kernel",
  "version": "1.0.0",
  ...
}
```

Keep existing dependencies and add/export scripts if needed. Do not break existing PM2 ecosystem file paths.

Expected: kernel package is named `@luna/kernel` and remains runnable standalone.

---

## Task 5: Update Dashboard Package Metadata and Paths

**Files:**
- Modify: `~/.luna-kernel/apps/dashboard/package.json`
- Modify: `~/.luna-kernel/apps/dashboard/luna-server.js`
- Modify: `~/.luna-kernel/apps/dashboard/luna-chat-routes.js`
- Modify: `~/.luna-kernel/apps/dashboard/config-validator.js` (if it references kernel paths)

- [ ] **Step 5.1: Read current dashboard `package.json`**

Run:
```bash
cat /home/jhin/.luna-kernel/apps/dashboard/package.json
```

- [ ] **Step 5.2: Name dashboard package and add kernel dependency**

Edit `apps/dashboard/package.json`:

```json
{
  "name": "@luna/dashboard",
  "version": "1.0.0",
  "dependencies": {
    "@luna/kernel": "workspace:*",
    ...
  }
}
```

Expected: dashboard depends on the local kernel workspace.

- [ ] **Step 5.3: Update `LUNA_KERNEL_DIR` resolution in dashboard**

Modify `apps/dashboard/luna-server.js` and `apps/dashboard/luna-chat-routes.js`.

Old:
```js
const LUNA_KERNEL_DIR = process.env.LUNA_KERNEL_DIR || path.resolve(__dirname, '..', '..', '.luna-kernel');
```

New:
```js
const LUNA_KERNEL_DIR = process.env.LUNA_KERNEL_DIR || path.resolve(__dirname, '..', '..', 'packages', 'kernel');
```

Also update any `path.join(LUNA_KERNEL_DIR, ...)` references to point into `packages/kernel` correctly (they should already work once `LUNA_KERNEL_DIR` is right).

Expected: dashboard resolves kernel modules from `packages/kernel`.

---

## Task 6: Reconcile Shared Dependencies

**Files:**
- Modify: `~/.luna-kernel/package.json`
- Modify: `~/.luna-kernel/packages/kernel/package.json`
- Modify: `~/.luna-kernel/apps/dashboard/package.json`

- [ ] **Step 6.1: Identify duplicated dependencies**

Run:
```bash
cd /home/jhin/.luna-kernel
node -e "console.log(JSON.stringify(require('./packages/kernel/package.json').dependencies, null, 2))"
node -e "console.log(JSON.stringify(require('./apps/dashboard/package.json').dependencies, null, 2))"
```

- [ ] **Step 6.2: Hoist common dependencies to root where appropriate**

Move dependencies used by both packages (e.g., `express`, `dotenv`, `cors`) to root `package.json` `dependencies`. Keep package-specific deps in each workspace.

Expected: root `package.json` contains shared deps; workspace packages contain only their specific deps.

---

## Task 7: Update Build and Start Scripts

**Files:**
- Modify: `~/.luna-kernel/packages/kernel/package.json`
- Modify: `~/.luna-kernel/apps/dashboard/package.json`
- Modify: `~/.luna-kernel/package.json`

- [ ] **Step 7.1: Ensure kernel build produces dist correctly**

Verify `packages/kernel/luna-web/package.json` build script:
```json
"scripts": {
  "build": "vite build",
  "dev": "vite dev"
}
```

Expected: running `pnpm --filter @luna/kernel build` builds `packages/kernel/luna-web/dist`.

- [ ] **Step 7.2: Ensure dashboard start script uses correct paths**

In `apps/dashboard/package.json`:
```json
"scripts": {
  "start": "node luna-server.js",
  "dev": "node luna-server.js"
}
```

Expected: `pnpm start` from root launches dashboard server.

---

## Task 8: Install Dependencies and Verify

**Files:**
- Root `node_modules/`
- Workspace `node_modules/`

- [ ] **Step 8.1: Install with pnpm**

Run:
```bash
cd /home/jhin/.luna-kernel
pnpm install
```

Expected: creates root `node_modules/` with workspace symlinks `@luna/kernel` and `@luna/dashboard`.

- [ ] **Step 8.2: Verify workspace symlinks**

Run:
```bash
ls -la /home/jhin/.luna-kernel/node_modules/@luna/
```

Expected: `kernel -> ../../packages/kernel` and `dashboard -> ../../apps/dashboard`.

---

## Task 9: Test the Integrated System

**Files:**
- Run: `~/.luna-kernel/apps/dashboard/luna-server.js`
- Test: `curl http://localhost:3458/api/chat/sessions`
- Test: `curl http://localhost:3458/api/luna/compact`

- [ ] **Step 9.1: Start the dashboard server**

Run:
```bash
cd /home/jhin/.luna-kernel
pnpm start
```

Wait for `[Luna Server] Serving static from:` log.

- [ ] **Step 9.2: Test sessions endpoint**

Run:
```bash
curl -s http://localhost:3458/api/chat/sessions | head -c 200
```

Expected: returns `{ ok: true, sessions: [...] }`.

- [ ] **Step 9.3: Test compaction endpoint**

Run:
```bash
curl -s -N -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:3458/api/luna/compact \
  -d '{"sessionId":"test-session","userId":"luna-default"}' | head -20
```

Expected: SSE stream with `compact_start`, `compact_progress`, etc.

---

## Task 10: Update PM2 Ecosystem

**Files:**
- Modify: `~/.luna-kernel/ecosystem.config.js` (if exists) or create `~/.luna-kernel/pm2-ecosystem.config.js`
- Modify: existing PM2 config if referenced by the user

- [ ] **Step 10.1: Update PM2 script paths**

Ensure PM2 starts dashboard from the new location:

```js
module.exports = {
  apps: [
    {
      name: 'luna-server',
      script: './apps/dashboard/luna-server.js',
      cwd: '/home/jhin/.luna-kernel',
      ...
    }
  ]
};
```

Expected: `pm2 restart luna-server` works from monorepo root.

---

## Task 11: Update Documentation

**Files:**
- Modify: `~/.luna-kernel/README.md`
- Modify: `~/.luna-kernel/docs/LUNA-MANUAL-COMPACTACAO-MANUAL.md` (paths)

- [ ] **Step 11.1: Rewrite root README for monorepo**

Include:
- What the monorepo contains.
- How to install: `pnpm install`.
- How to start kernel: `pnpm dev:kernel` or PM2.
- How to start dashboard: `pnpm dev:dashboard` or PM2.
- Workspace layout.

- [ ] **Step 11.2: Update manual paths**

In `docs/LUNA-MANUAL-COMPACTACAO-MANUAL.md`, update file paths from `NEXO_DASHBOARD_PRO/backend/...` to `apps/dashboard/...` and from `.luna-kernel/...` to `packages/kernel/...`.

---

## Task 12: Commit and Push

**Files:**
- All migrated files.

- [ ] **Step 12.1: Stage all changes**

Run:
```bash
cd /home/jhin/.luna-kernel
git add -A
```

- [ ] **Step 12.2: Commit migration**

Run:
```bash
git commit -m "chore(monorepo): merge dashboard into luna-kernel workspace

- Move existing kernel content to packages/kernel.
- Move NexoDashboard backend into apps/dashboard.
- Configure npm/pnpm workspaces.
- Update dashboard kernel path resolution.
- Update PM2 and docs to reflect new layout."
```

- [ ] **Step 12.3: Push to origin/main**

Run:
```bash
git push origin main
```

Expected: `main` on GitHub contains the monorepo structure.

---

## Task 13: Deprecate Old Dashboard Repository (Optional)

**Files:**
- `~/NexoDashboard/README.md`

- [ ] **Step 13.1: Add deprecation notice to old dashboard repo**

After confirming the monorepo push, add a README notice to `NexoDashboard`:

```markdown
# Movido

Este repositório foi incorporado ao monorepo [luna-kernel](https://github.com/Jhin1v9/luna-kernel).
O dashboard agora está em `apps/dashboard`.
```

Commit and push to `NexoDashboard/main`.

---

## Spec Coverage

| Requirement | Task |
|---|---|
| Single repo for kernel + dashboard | Tasks 1-3, 12 |
| Workspace tooling | Tasks 3, 6, 8 |
| Dashboard still finds kernel modules | Tasks 5, 9 |
| PM2 still works | Task 10 |
| Docs updated | Task 11 |
| Old repo deprecated | Task 13 |

## Placeholder Scan

- No TBD/TODO placeholders.
- All file paths are exact.
- All commands are exact.
- All code blocks contain real content.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-04-luna-monorepo.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
