# Luna Decisions

> Why the system is the way it is. Update this file when a decision changes.

## 2026-08-03 — Branch and deployment model

### Decision
`Luna-Abner` is the primary development branch. All agent commits and pushes must target `Luna-Abner`, not `main`.

### Rationale
The owner asked for a dedicated branch named after the Luna instance. This isolates live fixes from `main` and makes it clear which branch other PCs (Pai, Nonoke) should pull from.

### Consequences
- Agents must run `git checkout Luna-Abner` before making changes.
- `git push` should push to `origin Luna-Abner`.
- `main` is frozen for direct agent work unless the owner explicitly asks to merge.

## 2026-08-03 — Remove auto-health monitor

### Decision
Deleted the `Auto-Health Monitor` from `apps/dashboard/luna-chat-routes.js`.

### Rationale
The monitor used a 30s interval to check if port 3458 was listening. During server startup, the port was not yet bound, so the monitor concluded the server was dead and triggered `runScript('restart')`. This produced an infinite restart loop (`EADDRINUSE`, zombie Node processes, broken SSE streams).

### Consequences
- `luna-server` now stays up until explicitly restarted.
- `luna-health-watchdog` is no longer started by default.
- If the server genuinely crashes, PM2's own `autorestart` policy still applies.

## 2026-08-03 — Wallpaper determinism

### Decision
The wallpaper must be pixel-identical after every hard refresh and must always show the "connected constellations" look.

### Rationale
The owner reported that after `Ctrl+F5` the wallpaper sometimes lost its constellation lines or changed appearance. Investigation showed that dynamic lines were computed before star positions were initialized, causing non-deterministic first-frame layouts.

### Consequences
- `projectStar()` and `projectBgStar()` now initialize `currentX/currentY` to the home position.
- Constellation/proximity line opacity was raised to keep lines visible in all modes.
- `Math.random()` is still used for transient effects (shooting stars); only the static layout is required to be deterministic.

## 2026-08-03 — Leave "JSON Copiar" in thinking bubble

### Decision
The text `JSON Copiar` sometimes appears at the end of the thinking bubble because Kimi's DOM extraction includes the code-block copy button. It is considered cosmetic and will not be filtered at this time.

### Rationale
The owner stated the system is working correctly and requested not to change functioning behavior.

### Consequences
- Users may see a stray "JSON Copiar" line in the thinking card.
- If it becomes annoying, the fix belongs in the Kimi DOM extraction layer (`kimi-bridge.cjs` / extension / DOM extractor), not the frontend.
