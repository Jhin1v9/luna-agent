# Wave 1 — Flow Quick Wins Implementation Plan

> **For agentic workers:** Execute fixes A → B → C sequentially (they touch different files but B/C change the same event pipeline). Each fix: implement → spec review → quality review → commit.

**Goal:** Fix the six highest-impact, lowest-risk flow bugs registered in `packages/kernel/.brain/bugs.md` (Wave 1): prompt without examples, persona path, text duplication (frontend), tool cards missing (transport), phantom tool execution, silent exits without `done`.

**Architecture:** Localized surgical fixes only — no refactors. Each fix pins behavior with a `node --test` test where feasible (seed for modularization Phase 0).

**Tech Stack:** Node 22 (.cjs), Svelte 4, native `node --test`.

**Source of truth for root causes:** `packages/kernel/.brain/bugs.md` (all file:line verified 2026-07-11).

---

## Fix A — Soul (`packages/kernel/luna-soul.cjs`)

**Files:**
- Modify: `packages/kernel/luna-soul.cjs` (4 spots)
- Modify: `packages/kernel/config/luna-prompt-config.json` (follow-up templates)
- Test: `packages/kernel/tests/wave1-soul.test.cjs`

- [ ] **A1. Master prompt + persona + memories are discarded (`luna-soul.cjs:310-325`)**

The `cfg.systemPrompt` branch interpolates only `{{WORKSPACE}}`; `{{masterPrompt}}`, `{{personaContent}}`, `{{memoryContext}}`, `{{agentsMd}}`, `{{BRAIN_CONTEXT}}` are computed in `vars` but never substituted because the template lacks the placeholders. Fix in `buildSystemPrompt`: after interpolating the config template, APPEND the master prompt (interpolated with `{{USER_ID}}`/`{{WORKSPACE}}`), persona (truncated 1000), memories, agentsMd, brain context — each only if non-empty — then apply the 20000-byte cap. The master prompt goes LAST so its `[JSON FORMAT — BOTTOM EXAMPLES]` section lands at the end of the prompt (owner requirement: exact JSON example at the end).

- [ ] **A2. Follow-up/toolLoop templates have no JSON examples (`:3766-3784` + config)**

In `config/luna-prompt-config.json`, extend the `followUp` and `toolLoop` templates with a compact exact-format reminder: one `{"response": "..."}` example, one `{"tool": "readFile", "params": {"path": "/abs/path"}}` example, one `{"script": "..."}` example, and the rules "ONE JSON per message, params always object, only ```json blocks". Keep it < 500 chars per template.

- [ ] **A3. Phantom tool execution — tools quoted inside a response get executed (`:2669-2712` + bridge `:7786-7799`)**

Owner symptom: pure `{"response"}` must stop the loop. Root: DOM-extracted actions (`domActionResults`) are honored even when the model's message parses as a pure CHAT response. Fix in `processMessageStream`: when `parsed.mode === 'CHAT'` (a valid `{"response": ...}` wrapper was parsed), IGNORE `domActionResults` entirely (log a skip line) and take the existing pure-chat stop path. Master prompt mandates ONE JSON per message, so a pure response never legitimately carries tools.

- [ ] **A4. Silent exits without `done` (`:2524`, `:2588`, `:2654-2658`)**

- `context_limit` path (`:2517-2525`): after the system event, also `yield { type: 'done', ... }` before `return` so the UI unblocks.
- `STREAM_CANCELLED` path (`:2586-2588`): same — emit `done` after the system event.
- Empty response (`:2654-2658`): when `fullResponse` is empty/whitespace after the stream, do NOT emit a CHAT `done` with empty string. Instead `yield { type: 'error', error: 'Empty response from provider', ... }` followed by `done` with a user-visible system message ("o provedor não respondeu — tente reenviar").

- [ ] **A5. Persona path broken (`:4991`)**

`_telegramPipeline` builds `PATHS.lunaKernel + 'packages/kernel/personas/...'` with duplicated segments. Verify `PATHS.lunaKernel` value (`config/luna-config.js`) and fix the concatenation so it resolves to the real `packages/kernel/personas/telegram-assistant.json`. Add a `console.warn` when the persona file is missing (today it fails silently).

- [ ] **A6. Test + commit**

Write `packages/kernel/tests/wave1-soul.test.cjs` (`node --test`): unit-test `buildSystemPrompt` output contains the master prompt's JSON example marker and persona text when config exists (call the exported function with a fake workspace); test the followUp template contains `"tool"`. Run: `node --test packages/kernel/tests/wave1-soul.test.cjs` — must pass. If `buildSystemPrompt` isn't exported, export it (additive change).

```bash
git add packages/kernel/luna-soul.cjs packages/kernel/config/luna-prompt-config.json packages/kernel/tests/wave1-soul.test.cjs
git commit -m "fix(soul): inject master prompt into system prompt, JSON examples in follow-ups, no phantom tools, done on silent exits, persona path"
```

---

## Fix B — Transport (`apps/dashboard/luna-chat-routes.js`)

**Files:**
- Modify: `apps/dashboard/luna-chat-routes.js` (3 spots)
- Test: `packages/kernel/tests/wave1-transport.test.cjs` (or `apps/dashboard/__tests__/wave1-transport.test.js` if jest fits better — implementer decides based on existing test setup)

- [ ] **B1. Dedup drops repeated `action_*` (`luna-chat-routes.js:498-503`)**

The dedup key `${ev.type}:${content.slice(0,200)}:${ev.tool || ''}` has empty content for `action_start`/`action_end` → the 2nd call of the same tool in a turn is dropped. Fix: for `action_start`/`action_end`/`action_progress` events, include `ev.toolInstanceId` (or `ev.id`) in the key; keep content-based dedup for text events.

- [ ] **B2. `toolInstanceId` dropped in transport (`:506-517`, `:611-631`, `:655-676`)**

Persist `toolInstanceId` in `addMessageToSession` and include it in `eventData` on BOTH SSE paths (live forward and ledger replay). The soul already emits it (`luna-soul.cjs:2467/2498/2881/2893/5047-5071`).

- [ ] **B3. `Date.now()` id collisions (`:507`)**

Change id generation to `ev-${Date.now()}-${++eventSeq}` with a module-level counter (same pattern as plan mode's `plan-ev-${Date.now()}-${seq}` at `:1194`).

- [ ] **B4. Test + commit**

Test the dedup function (extract it to a small exported helper if needed, additive): two `action_start` events with same tool but different `toolInstanceId` must both survive; two identical text events must still dedupe. Run and pass.

```bash
git add apps/dashboard/luna-chat-routes.js <test file>
git commit -m "fix(transport): keep repeated tool events, forward toolInstanceId, unique event ids"
```

---

## Fix C — Frontend (`packages/kernel/luna-web/src/components/ChatArea.svelte`)

**Files:**
- Modify: `packages/kernel/luna-web/src/components/ChatArea.svelte:117-136`

- [ ] **C1. Quadratic append bug**

`flushResponseBuffer()` without `forceText` appends the ENTIRE cumulative `responseBuffer` on every delta and never clears it → `d1 + (d1d2) + (d1d2d3)`. Fix: after a successful non-force flush, clear `responseBuffer = ''` (the buffer is re-accumulated by subsequent `response_delta` events at `:427`). Verify all other readers of `responseBuffer` before clearing: `stripToolBlocksFromBuffer` runs inside the flush itself (order preserved), and `response_detected`/`done` use the `forceText` replace path which already clears. Add the duplicate-content guard: if `cleanText` is empty after stripping, skip the append.

- [ ] **C2. Build + commit**

Run: `cd packages/kernel/luna-web && corepack pnpm build` — must succeed. Manual smoke (implementer): verify no syntax errors via build output.

```bash
git add packages/kernel/luna-web/src/components/ChatArea.svelte
git commit -m "fix(frontend): clear response buffer after flush - stop quadratic text duplication"
```

---

## Self-Review

**Coverage:** Wave 1 of bugs.md = A1+A2 (prompt), A3 (phantom/auto-continue), A4 (silent exits), A5 (persona), B1-B3 (tool cards transport), C1 (text duplication primary cause). ✅
**Out of scope (later waves):** bridge-side text duplication sources, guard/tools, frontend hygiene, modularization.
**Consistency:** toolInstanceId originates in soul, transported in B, consumed by existing frontend code (`ChatArea.svelte:471` already reads `event.toolInstanceId`).
