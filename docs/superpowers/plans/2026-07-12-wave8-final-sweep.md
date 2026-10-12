# Wave 8 — Final bug sweep (última wave de bugs)

> Created: 2026-07-12. Owner directive: "termina a wave 8, ela é a última".
> Scope: every code-fixable item in bugs.md Open + Wave 7 review follow-ups.
> Out of scope (Wave 9 = architecture, owner decides): parser unification into one
> real parser, heuristic validators→real parser (needs dependency decision),
> provider abstraction, ChatArea/ToolCard decomposition, soul→kernel rename,
> jsonrepair bundling, visible-mode toggle persistence + Telegram propagation.
>
> Baseline: 223/223 tests. HEAD at planning: 0bb436f.

## Task 1 — Soul: config wires, workspace isolation, dashboard success honesty

**Files:** `packages/kernel/luna-soul.cjs`, `packages/kernel/config/luna-config.js`.

- [x] (a) `invalidatePromptCache` never called (`:117-127`) — find the UI/API path that edits the master prompt (grep callers of the prompt-write route in `apps/dashboard/luna-chat-routes.js` / `luna-server.js`) and call `invalidatePromptCache()` after writes so edits take effect without restart.
- [x] (b) Workspace `'luna-cli'` hardcoded in follow-up context (`:3756-3757`) — derive the workspace from the session/userId (same derivation as the main flow uses) instead of the literal. Verify the tool guard (`luna-tool-guard.cjs`) receives the real workspace for web/Telegram sessions (the open item says the guard is null there — confirm and fix the wiring, not the guard itself).
- [x] (c) Config keys ignored — `miniReminder` and `toolResultPrompt` (`:2767-2782` hardcoded): read them from config with the current hardcoded text as fallback default. `loopRules` vs `MAX_AUTO_CONTINUES = 3` (`:2367`): reconcile — if `loopRules` in config sets a max, honor it (config wins, constant is the default).
- [x] (d) `dashboardCommandRouter` reports `success:true` on inner failure (`:2138` ff.) — propagate the inner failure so failed dashboard mutations are NOT marked processed (mark-on-success idempotency). Keep PT-BR error messages.
- [x] Tests (+3): prompt-edit route calls invalidatePromptCache (source-slice); follow-up context has no `'luna-cli'` literal (source-slice); config keys honored (unit: config with custom toolResultPrompt → used; absent → default).
- [x] Commit: `fix(soul): wire prompt-cache invalidation, per-session workspace, config keys, honest dashboard results`.

## Task 2 — Bridge/extension: tools lost in parsing

**Files:** `packages/kernel/kimi-bridge.cjs`, `packages/kernel/luna-extension/injected.js`.

- [x] (a) `_extractJsonToolCalls` counts braces inside strings — rewrite to walk with the string-aware logic of `extractFirstCompleteJsonObject` (exists at `:2483-2521` pre-W7): extract each top-level JSON object respecting string literals/escapes, then filter tool objects. Add a unit test with a writeFile whose content contains `{`/`}`/HTML/JS (the exact failing case) → tool parsed with full params.
- [x] (b) Extension fallback regex can't parse nested params (`injected.js:92-93`) — replace the non-greedy regex with a self-contained string-aware extractor (same algorithm, no dependencies — the extension cannot bundle jsonrepair in this wave). Keep the extension VERSION bump convention if the file has one (check manifest/injected version constant; the Wave 2 bump was 2.1.1-wave2 — bump patch and note owner must reload the extension).
- [x] (c) JSON wrapper accumulator misses mid-text wrappers (`:7556`) — currently only fires when delta starts with `{`. Extend: when a delta contains `{"tool"` / `{"script"` / `{"response"` mid-text, start buffering from that position (don't leak raw JSON to chat). Keep the existing start-with-`{` fast path.
- [x] (d) `language: extracted.language || 'bash'` at the three `json_buffer` script sites (bridge) instead of hardcoded `'bash'`.
- [x] Tests (+4): (a) unit nested-brace writeFile; (b) source-slice or unit of the extension extractor (nested params round-trip); (c) source-slice mid-text trigger; (d) source-slice language propagation.
- [x] Commit: `fix(bridge): string-aware tool-JSON extraction everywhere - no more tools lost to nested content`.

## Task 3 — Frontend: no empty cards, internal tools hidden, replay dedup

**Files:** `packages/kernel/luna-web/src/components/ToolCard.svelte`, `ChatArea.svelte`, `MessagesList.svelte`; `packages/kernel/lib/tool-registry.cjs`.

- [x] (a) ToolCard reads error/output from the inner level too (`result?.result?.error`, `result?.result?.friendlyMessage`, `result?.result?.stdout`) — the backend wraps results one level deeper than the card reads; and when neither command/path nor output exists, render `JSON.stringify(params, null, 2)` as body so a card is never blank.
- [x] (b) Internal tools never render cards: add `hidden: true` metadata in `lib/tool-registry.cjs` for `think`, `getVisibleMode`, `setVisibleMode`, `getCurrentDirectory` (verify exact names in the registry); regenerate the frontend meta (`scripts/gen-tool-meta.cjs` → `toolMeta.generated.js`); ChatArea `case 'action_start'` skips card creation for hidden tools (reads from generated meta, not a hardcoded list). Action still executes — only the card is suppressed.
- [x] (c) Chunk-replay dedup: dedup `action_progress` chunk events client-side by event id in ChatArea (the ack-trim path can replay already-rendered chunks on reconnect).
- [x] (d) Small plan-mode leftovers from Wave 7 review: `/api/plan` persists the user's plan-request message into the session (today it only lives in the DOM — reload loses it); server rejects duplicate approve (status must be `awaiting_approval`); after revise, the old card stops showing actions (status transitions) so two cards can't both offer buttons.
- [x] Rebuild dist + commit it. Tests (+3): generated meta contains hidden flags (byte-drift test may need updating — check wave5 T4); ChatArea skips hidden tools (source-slice); chunk dedup by id (source-slice/unit).
- [x] Commit: `fix(frontend): ToolCard inner-level errors, hidden internal tools, chunk replay dedup, plan-mode leftovers`.

## Task 4 — Tools/guard: atomic writes, real build detection, dead-code removal

**Files:** `packages/kernel/luna-soul.cjs`, `packages/kernel/luna-tools.cjs`, `packages/kernel/kimi-bridge.cjs`, `packages/kernel/bridge-libs/`.

- [x] (a) ~15 direct `fs.writeFileSync` sites in `luna-soul.cjs` (`:1043, :1074, :1115, :1144, :1174-1178, :1245-1334, :3050, :4749, :4847, :4904` pre-W7) → route through an atomic helper (write tmp in same dir + `fs.renameSync`), reusing the existing helper if the soul already has one from Fix B (check before creating). Characterization: writes still produce identical content; failure mid-write leaves no truncated target (unit with a mocked rename throw → original intact).
- [x] (b) Decouple timeout from visibility (`luna-tools.cjs:1037` `isBuildCommand = isVisibleCommand`): implement the real v10.1 promise — detect build/install/long commands by pattern (`npm/pnpm/yarn/bun install`, `npm run build`, `apt(-get)? install`, `pip3? install`, `docker build`, `cargo build`, `make`, `gradle`, `mvn`) → 300s; everything else → `opts.timeout || 60`. Visible flag no longer affects timeout.
- [x] (c) Dead code: delete `bridge-libs/message-sender.cjs` and `bridge-libs/input-validator.cjs` ONLY after grep proves zero importers (production + tests); remove `KIMI_MODE_URLS` and `getModeUrls()` similarly if orphan. `setMode` invalid-mode: log warn + treat as 'instant' (no silent Thinking click).
- [x] Tests (+3): atomic write characterization; build-command detection table (unit: 6+ patterns × timeout); source-slice no `isBuildCommand = isVisibleCommand`.
- [x] Commit: `fix(tools): atomic soul writes, real build-command timeouts, dead bridge-libs removed`.

## Task 5 — Close the wave: bugs.md bookkeeping

- [x] Move every fixed item to `### Wave 8 (2026-07-12)` in Resolved with commit SHAs. Keep Open ONLY the Wave 9 architecture items (rewrite the Open section header to say "Wave 9 — architecture decisions (owner)": parser unification, validators→real parser (dependency decision), provider abstraction, monolith decomposition, soul→kernel rename, jsonrepair bundling, visible-mode persistence/Telegram).
- [x] Commit: `docs(brain): close Wave 8 - final bug sweep; remaining work is architecture`.

## Final steps (after T5)

1. Full regression — report final count.
2. `git push origin main`.
3. `pm2 restart luna-server luna-telegram-adapter` (NO `--update-env`) + verify online + `curl :3458` 200 + `pm2 save`.
4. Final PT-BR report + live-validation checklist + the Wave 9 menu for the owner.

## Self-Review

- Every Open bug has a task: invalidatePromptCache→T1a, workspace→T1b, config keys→T1c, dashboardRouter→T1d, extractJsonToolCalls→T2a, extension regex→T2b, wrapper accumulator→T2c, chunk replay→T3c, dashboardRouter (dup)→T1d, writeFileSync→T4a. Wave 7 follow-ups: ToolCard inner errors→T3a, hidden tools→T3b, plan leftovers→T3d, isBuildCommand→T4b, dead code→T4c, setMode→T4c, language propagation→T2d. ✅
- Deferred with owner-visible rationale: parser unification (big refactor, T2 removes the symptoms), heuristic validators (dependency decision), provider abstraction/decomposition/rename (architecture), jsonrepair (extension bundle decision), visible-toggle persistence (product decision). ✅
- Extension version bump convention honored (Wave 2 precedent: 2.1.1-wave2). ✅
- No new runtime dependencies anywhere. ✅
