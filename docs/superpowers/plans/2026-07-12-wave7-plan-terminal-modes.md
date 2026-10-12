# Wave 7 — Plan mode de verdade, terminal visível correto, remoção de agent/swarm

> Created: 2026-07-12. Owner directives: (1) deletar modos agent/swarm da Luna;
> (2) plan mode não pode mudar a URL da Kimi — só o prompt; aprovar executa o plano
> na mesma conversa; (3) plano sempre aparece "(plano vazio)" e botões parecem
> decorativos; (4) prompt do plan mode induz a Kimi a achar que tem ipython e negar
> ("não posso acessar seu pc"); (5) janelas de terminal nativas vazias abrem do nada.
>
> Evidence gathered 2026-07-12 (investigations agent-126..129 + live terminal tests):
> - `x-terminal-emulator --wait -- bash script` on this host (perl gnome-terminal.wrapper)
>   DROPS the command → empty `--wait` window hangs forever, no log; invisible fallback
>   runs the command → chat gets result + orphan window stays. `-e 'bash script'` works
>   end-to-end (window opens, runs, closes, wrapper exits 0). Verified live.
> - W6-T10's enrichSessionEnv inside detectHeadless made `visibleMode = !detectHeadless()`
>   default TRUE under PM2 → every executeShell opened a window uninvited.
> - Plan mode uses `userId 'web-plan-<id>'` → separate Kimi chat (navigation) → approve
>   returns to old chat without context. Guard read-only is call-scoped
>   (`options.planMode`, luna-soul.cjs:4244) → survives userId unification.
> - SSE serializers whitelist (`luna-chat-routes.js:645-668` replay, `:692-714` live)
>   never copy `msg.plan`/`msg.planPath` → `plan_display` reaches the browser without
>   `event.plan` → ChatArea.svelte:866 falls back to `'(plano vazio)'`.
> - Approve/reject/revise endpoints exist but only flip status; approve never continues
>   the conversation; `planModeSessions` is an in-memory Map (lost on restart → 404 the
>   frontend only logs to console).
> - `_buildPlanModePrompt` (luna-soul.cjs:3166-3215) advertises `ipython`/`python` —
>   collides with Kimi's internal IPython tool → refusals.
> - Agent/swarm: UI selector already gone (ChatHeader only instant/thinking); remaining:
>   bridge navigation, URL configs, validator/route whitelists, frontend texts/animations.

## Task 1 — Remove agent/swarm modes everywhere

**Files (exact anchors from investigation):**

- [x] `packages/kernel/bridge-libs/input-validator.cjs:50-55` — mode whitelist → `['instant','thinking']`.
- [x] `apps/dashboard/luna-chat-routes.js:481` — POST /api/chat mode whitelist → `['instant','thinking']`.
- [x] `packages/kernel/kimi-bridge.cjs`: `getModeUrls()` fallback (~:65-77) remove agent/swarm keys; `_detectActualMode` (~:2730-2742) remove agent/swarm URL ifs; `setMode()` (~:2883-2923) delete the agent/swarm `page.goto` block; `sendMessage()` (~:3915-3979) delete `isAgentOrSwarm` navigation + simplify the 3 guards to unconditional; `sendMessageNoWait()` (~:4119-4121) delete the agent/swarm throw guard.
- [x] `packages/kernel/bridge-libs/message-sender.cjs` — `KIMI_MODE_URLS` (:15-20) remove 2 keys; same `isAgentOrSwarm` cleanup (:137-171).
- [x] `packages/kernel/config/luna-config.js:99-104` + `packages/kernel/provider-configs/kimi.json:5-10` — remove agent/swarm from modeUrls.
- [x] Frontend: `stores.js` MODE_COLORS (:51-56); `ChatArea.svelte:1304-1319` `/modo` whitelist + help text; `lib/slashCommands.js:22` desc; `WelcomeScreen.svelte:150-156` delete agent tip card; `ConfigDrawer.svelte:492-493` delete 2 tutorial lines; `lib/starAnimations.js` agent/swarm entries + cluster system; `ParticleBackground.svelte` cluster init/cases/update. Rebuild dist.
- [x] Docs: `.agents/architecture.md` Modes section → instant/thinking only; `packages/kernel/AGENTS.md:141`; `.brain/bugs.md` cross-user agent/swarm item → resolved-obsolete; `.brain/status.md`/`decisions.md` mentions updated.
- [x] Tests: none cover these modes (verified); suite stays 205. Regression must pass.
- [x] Commit: `refactor: remove agent/swarm modes - instant/thinking only, no dedicated Kimi URLs`.

## Task 2 — Plan mode: same Kimi chat, visible plan, real buttons, honest prompt

- [x] (a) Same chat: `luna-chat-routes.js:1211` `userId: 'web-plan-' + session.id` → `'web-' + session.id` (+ log :1205); `luna-soul.cjs:2970` fallback `'web-plan'` → `'web'` neutral. Guard read-only unchanged (call-scoped, :4244/:3060). Side benefit: cancel button now works for plan mode (cancel targets `'web-'+id`).
- [x] (b) SSE fix: both serializers (`luna-chat-routes.js:645-668` and `:692-714`) add `if (msg.plan) eventData.plan = msg.plan; if (msg.planPath) eventData.planPath = msg.planPath;`.
- [x] (c) Buttons: `ChatArea.svelte` `handleApprovePlan` (:1425-1433) — after successful approve, call `sendMessage('✅ Plano aprovado. Execute agora o plano acima, passo a passo, nesta mesma conversa.', sessionId, $currentMode, files, …, sessionProvider)` + `connectSSE()` (same pattern as :1400-1404); on 404/error show a visible PT-BR system message instead of console-only. `handleRevisePlan` — after submitRevision, send the revised text to the model as a normal message ('Plano revisado pelo usuário: …') so the model sees it. Rebuild dist.
- [x] (d) Prompt: rewrite `_buildPlanModePrompt` (luna-soul.cjs:3166-3215): remove `ipython`/`python` from the advertised tools; state the mechanism in 2-3 lines ("Você NÃO tem ferramentas próprias, nem ipython, nem terminal. Para agir, emita APENAS um bloco ```json```; a Luna executa no PC Linux real do usuário e o resultado volta para você nesta conversa. Dizer 'não posso acessar' é falso."); end with EXACT ```json``` examples for tool and response (owner's standing rule). Short version of the same mechanism in `_buildPlanFollowUpPrompt` baseReminder (:3380).
- [x] (d2) Master prompt "two worlds" section (owner directive 2026-07-12, screenshot evidence: the model wrote the user's CV via her OWN sandbox tool "Execute Python code" into `/mnt/agents/...` believing it was the user's PC): in `LUNA_MASTER_PROMPT.md` (and wherever the master prompt is injected — `luna-soul.cjs` `_buildSystemPrompt`), add a short explicit section: **DOIS MUNDOS** — (1) O SEU mundo: sandbox interno da Kimi (ipython/"Execute Python code", `/mnt/...`) — só você vê, NADA do que você fizer lá chega ao PC do usuário; use-o só para rascunho/raciocínio. (2) O mundo DO USUÁRIO: o PC Linux real — você só o alcança emitindo blocos ```json``` de tool NO CHAT (`{"tool": ...}`, `{"script": ...}`); a Luna executa e o resultado volta na conversa. REGRA: qualquer ação no PC do usuário (ler/escrever arquivo, rodar comando) DEVE ser um TOOL JSON no chat — nunca via ipython. Terminar com os exemplos JSON exatos (já existentes no master prompt).
- [x] (e) Hygiene: `/api/plan` refuses to start when `activeStreams.has(session.id)` (and logs why); mark `planModeSessions` entry `'cancelled'`/error when the plan stream dies (cancel/error paths :1216-1221); TTL cleanup for `planModeSessions` (30min sweep or lazy expiry on access).
- [x] Tests (+3 → 208): wave1-chat-routes — SSE serializer copies plan/planPath (source-slice both sites); wave1-soul — plan prompt has no `ipython`/`python`, contains the mechanism sentence, ends with json examples; wave1-chat-routes — `/api/plan` no longer builds `'web-plan-'` userId (source-slice).
- [x] Commit: `fix(plan): same-chat plan mode with visible plan, working approve/revise, honest JSON-only prompt`.

## Task 3 — Terminal: correct argv style + invisible by default

- [x] (a) `packages/kernel/lib/terminal-resolver.cjs` — realpath basename `gnome-terminal.wrapper` → new style `'xterm'`: `_argvFor('xterm', bin, scriptFile)` = `[bin, '-e', \`bash ${scriptFile}\`]` (single string arg, xterm convention; wrapper adds `--wait` itself). Keep dashdash for direct `kgx`/`gnome-console` binaries; konsole keeps `--nofork`. Verified live on this host 2026-07-12: `-e` style opens→runs→closes, wrapper exits 0, log written.
- [x] (b) `luna-tools.cjs:971` — `let visibleMode = false;` (opt-in via setVisibleMode tool/UI toggle; update comment: default invisible, visible only on explicit request).
- [ ] (c) Fecho: kill orphan `--wait` wrappers from the bug (pids 216953/216966 and any other empty Luna-spawned terminals) and report.
- [x] Tests (+3 → 217): resolver maps gnome-terminal.wrapper realpath → style 'xterm' (unit with a stubbed symlink tree); `_argvFor('xterm', …)` returns `[bin,'-e','bash <file>']`; source-slice: `visibleMode = false` default in luna-tools.
- [x] Commit: `fix(tools): visible terminal uses xterm-style -e argv + invisible by default - no more orphan empty windows`.

## Task 4 — Bridge: typed message not submitted (Enter never fires)

> Owner report 2026-07-12: "às vezes a luna escreve no chat o output mas nao envia no enter —
> fica la e eu tenho q apertar enter manualmente no chat da kimi." The bridge types the
> prompt into the Kimi input but the submit (Enter/click) silently doesn't happen.

- [x] Investigate the send path in `packages/kernel/kimi-bridge.cjs` (`sendMessage`/`_typeAndSubmit`/Enter dispatch, ~:3915-4050) and `bridge-libs/message-sender.cjs`: find why the message can remain typed-but-unsent (selector drift on the send button, Enter dispatched before the editor registers the text, contenteditable needing an input event, send-button disabled state, CDP key event not trusted). Identify ALL submit strategies and their fallback order.
- [x] Fix with defense in depth: after typing, verify the input actually contains the text before submitting; submit via the strategy chain (Enter → send-button click → form requestSubmit if applicable); after submit, VERIFY the input was cleared / a new assistant turn started within a bounded window; if not, retry submit once; if still stuck, fail the turn with a visible error (never hang silently — Wave 6 contract).
- [x] Tests (+4 → 221): unit/source-slice for the verify-after-submit logic in wave2-bridge.test.cjs.
- [x] Commit: `fix(bridge): verify-and-retry submit - typed messages can no longer sit unsent in the Kimi input`.
- [x] Review follow-up: verification hardened to TRANSITIONS vs a pre-submit baseline (stop-button/disabled-button leftovers no longer false-confirm; input clear only counts after the text was observed in the box), whitespace-normalized prefix compare, dead non-Kimi best-effort branch removed, `injectSteer` moved to `_fillContentEditable`, `sendMessageNoWait` delivery poll accepts the same transition signals (no false 30s timeout after a confirmed send). Tests +2 → 223 (W7-T4e/f). Residual accepted: pathological "sent but input retained" + >10s generation start could re-submit (duplicate user message) — no echo-based dedup guard yet.

## Task 5 — Close the wave: bugs.md bookkeeping

- [x] Append `### Wave 7 (2026-07-12)` to Resolved: orphan empty terminal windows (argv + default), plan "(plano vazio)" (SSE whitelist), plan buttons no-op (approve/revise wired), plan mode URL switch (same chat), plan prompt refusals (ipython removed + mechanism), master prompt two-worlds (sandbox vs user PC), typed-but-unsent messages (submit verify+retry), agent/swarm removed (cross-user agent/swarm open item → obsolete).
- [x] Commit: `docs(brain): close Wave 7 - plan mode works end-to-end, terminal fixed, agent/swarm removed`.

## Final steps (after T4)

1. Full regression — report final count (expect 210).
2. `git push origin main`.
3. `pm2 restart luna-server luna-telegram-adapter` (NO `--update-env`) + verify online + `curl :3458` 200 + `pm2 save`.
4. Kill orphan terminal windows; final PT-BR report with live-validation checklist (shift+tab → plan appears in card; approve → executes in same chat; no uninvited windows; `/modo` shows only instant/thinking).

## Out of scope (deferred)

- `plan_delta` dead code removal; `/api/plan` not persisting the user's plan request message; second PLAN auto-detect path (`_handlePlanStream`) unification.
- ToolCard internal-level error reading + internal-tools card filter (from agent-129 investigation — separate frontend hygiene task).
- `language: extracted.language` propagation in bridge json_buffer sites (minor).
- Remaining Wave 7-candidate bugs from bugs.md Open (parser duplication, extension regex, validators, etc.).
