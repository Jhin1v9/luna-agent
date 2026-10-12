# Wave 5 — Tool Registry (Modularization Phase 0+1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to execute this plan task-by-task. Execute Tasks 1 → 6 sequentially, in this order (Phase 0 characterization net FIRST; pure-additive registry next; mechanical guard migration; behavior-neutral frontend codegen; the three intentional behavior changes isolated in Task 5; bookkeeping last). Each task: write failing test → run it (fail) → implement → run it (pass) → `corepack pnpm build` if a luna-web source was touched (Task 4 only) → run ALL regression suites → commit.

**Goal:** Collapse the four desynced sources of truth for tool definitions into one backend registry. Phase 0: pin the guard's CURRENT validation behavior with a `node --test` characterization net (zero behavior change allowed during migration, except three explicitly-listed reconciliations). Phase 1: create `packages/kernel/lib/tool-registry.cjs` as THE source of truth (canonical names + guard schemas + frontend metadata), make `luna-tool-guard.cjs` consume schemas from it, and GENERATE the frontend's `TOOL_COLORS`/`TOOL_ICONS` maps from it (checked-in codegen + byte-drift test), then reconcile the three deferred schema bugs from `.brain/bugs.md`.

**Architecture:** One additive kernel module (`packages/kernel/lib/tool-registry.cjs`, kebab-case `.cjs` — matches `lib/` conventions: `atomic-write.cjs`, `exec-timeout.cjs`, `path-guard.cjs`, …). The guard derives its `TOOL_SCHEMAS` map from the registry (mechanical move — the pre-migration inline literal is deleted; the `TOOL_SCHEMAS` export is kept). Frontend derivation uses **mechanism (a) — checked-in codegen**: `scripts/gen-tool-meta.cjs` renders `packages/kernel/luna-web/src/lib/toolMeta.generated.js` (ESM, committed) from the registry; a drift test re-renders in memory and asserts byte-identity with the committed file. **Why (a) over (b) runtime fetch:** deterministic, testable offline (the drift test runs in every regression with no server), adds zero runtime dependencies/endpoints, and matches the repo's existing tracked-artifact convention (`luna-web/dist/` is committed). Blocker check for (a): none found — Vite imports the ESM file normally, and the `.cjs` test suite loads it via Node 24 `require(ESM)` (precedent: `wave4-frontend.test.cjs` requires `luna-web/src/lib/evictSet.js` and `api.js`; verified on this box, Node v24.15.0). Mechanism (b) would need a new API endpoint + frontend fetch + cache fallback — strictly more machinery for zero benefit at this stage; the registry can grow an endpoint later without throwing the generated file away.

**Tech Stack:** Node 24 (.cjs kernel + tests, ESM frontend module via `require(ESM)`), native `node --test`, Svelte 4 / Vite 5 (Task 4 only), no new npm deps. NEVER touch PM2 or any service — verification is `node --test` + `vite build` only; runtime smoke is left to the owner.

**Verified counts at HEAD `64982a4` (2026-07-12):**
- **132 dispatched tool names** = 129 `luna-tools.cjs` export keys (incl. aliases `web_search`/`webSearch` → `searchWeb`) + 3 soul-only dispatches (`dashboardCommandRouter` at `luna-soul.cjs:4579-4586`, `ipython` at `:4526-4550`, `computer` at `:4565-4578`; `browser` is both an export AND a native branch at `:4552-4564`).
- **12 tools have guard schemas today** (`luna-tool-guard.cjs:151-207`): readFile, writeFile, replaceInFile, appendFile, deleteFile, executeShell, ipython, browser, computer, glob, grep, validateProject. 10 apply to exports; `ipython`/`computer` are soul-only.
- **18 frontend metadata entries** in `ToolCard.svelte:11-29` (`TOOL_COLORS` and `TOOL_ICONS`, same keys), fallbacks `#6b7280` / `🔧` at `:32-33`. No label map exists anywhere in `luna-web` (grep-verified) — registry `meta.label` is `null` for every entry this wave (reserved for the accepted UX-labels phase in decisions.md).

**Line-number verification notes (drift corrections, confirmed at `64982a4`):**
- bugs.md cites the checksum-drift bug at `luna-tool-guard.cjs:475,518` — actual sites are **`:500`** (`this.checksums.verify(params.path)` inside `ToolGuard.execute`) and **`:526`** (`this.checksums.record(params.path)`).
- The Wave 3 guard comment (`luna-tool-guard.cjs:209-212`) references `docs/luna-tools-registry.json` as the future schema source — **that file does not exist**; Task 3 rewrites the comment to point at `lib/tool-registry.cjs`.
- `validateToolCall` (`luna-tool-guard.cjs:215-271`) does NOT enforce `pathMustExist` (readFile declares it — decorative today). The Phase 0 net pins this as current behavior.
- `ipython`'s schema is unreachable via the soul: the soul validates ipython calls as `executeShell` (`luna-soul.cjs:4545`). The schema is still moved verbatim (it is callable directly and must not change behavior).
- Soul dispatch shape: `FILE_TOOLS = Object.keys(lunaTools)` (`luna-soul.cjs:4149`) gates the big `switch (tool)` (`:4287-4402`); desktop tools (`DESKTOP_TOOLS` const `:4150`) go through `this.engine.executeSingle` with NO guard and NO frontend metadata — **excluded from the registry** (separate subsystem; accepted residual).
- Pre-existing desync NOT fixed this wave (registry includes them anyway — completeness contract = exports): `validateProject`, `getVisibleMode`, `setVisibleMode`, `lunaSelfUpdate` are exported but have no `case` in the soul switch (they hit `default: Ferramenta desconhecida`).
- `TOOL_SCHEMAS` is consumed ONLY inside `luna-tool-guard.cjs` (grep-verified: definition, lookup at `:216`, export at `:568`) — the migration is contained to that file.
- Wave 3 already pins (do NOT duplicate — the net EXTENDS): fail-open default + warn-once (H1), writeFile alias required/absolute/`pathMustNotContain` (H1), idempotency scoping (H3), executeShell timeout clamp + circuit (H4/H5). The net references these and covers everything else.
- One existing test WILL be intentionally flipped in Task 5a: `wave3-guard-tools.test.cjs` H1 `'pathMustNotContain also applies to the resolved alias value'` (`:955-960`) pins behavior Task 5a removes. Exact replacement given in Task 5 — no other existing test is touched.

**Task ↔ deliverable map:**
- Task 1 → Phase 0 characterization net (green at HEAD, 3 carve-outs) · Task 2 → registry module + completeness/shape tests · Task 3 → guard consumes registry (zero behavior change) · Task 4 → frontend codegen + ToolCard switch (luna-web, dist rebuild) · Task 5 → the three schema reconciliations (grouped; sub-fixes 5a/5b/5c) · Task 6 → `.brain/bugs.md` bookkeeping.

**Tasks that touch luna-web sources (MUST rebuild `dist/` and include it in the commit):** Task 4 ONLY. Tasks 1, 2, 3, 5, 6 do NOT touch luna-web (no rebuild).

**Standard commands (used in every task below):**
```bash
# New wave tests only
node --test packages/kernel/tests/wave5-tool-registry.test.cjs
# FULL regression (run from repo root — 155 tests green at 64982a4; wave5 suite is added in Task 1 and MUST stay in this list)
node --test packages/kernel/tests/wave1-soul.test.cjs packages/kernel/tests/wave2-bridge.test.cjs packages/kernel/tests/wave3-guard-tools.test.cjs packages/kernel/tests/url-landing.test.cjs apps/dashboard/tests/wave1-chat-routes.test.cjs packages/kernel/tests/wave4-frontend.test.cjs packages/kernel/tests/wave5-tool-registry.test.cjs
# Frontend rebuild (Task 4 only; ~25s; dist/ is tracked — commit it)
cd /home/jhin/.luna-kernel/packages/kernel/luna-web && corepack pnpm build
# Regenerate frontend tool metadata (Task 4; re-run whenever registry meta changes)
node scripts/gen-tool-meta.cjs
```

---

## Task 1 — Phase 0: characterization net for current guard behavior

**Files:**
- New: `packages/kernel/tests/wave5-tool-registry.test.cjs`

The net pins, for each of the 12 current schemas, representative valid + invalid payloads derived from the CURRENT schema definitions (no invented stricter rules), plus the unenforced `pathMustExist`, the path-alias normalization, fail-open for unlisted tools, and checksum-drift behavior. Three blocks are marked **CARVE-OUT** — they pin the CURRENT (buggy) behavior and are flipped to the new behavior in Task 5. After the Task 3 migration, this net (minus the flipped carve-outs) must produce IDENTICAL results.

- [ ] **T1.1. Write the characterization net**

Create `packages/kernel/tests/wave5-tool-registry.test.cjs`:

```js
// wave5-tool-registry.test.cjs — Wave 5 regression tests (tool registry, modularization Phase 0+1)
// T1/P0: characterization net — pins CURRENT guard schema behavior (accept/reject matrix for all 12
//        schemas + alias normalization + fail-open + checksum drift). Three CARVE-OUT blocks pin
//        current buggy behavior and are flipped in Task 5 (P0-2 → 5a, P0-3 → 5c, P0-11 → 5b).
// T2: tool registry completeness + schema-shape validity (lib/tool-registry.cjs)
// T3: guard consumes schemas from the registry (zero behavior change — this net is the proof)
// T4: frontend metadata codegen — drift test + behavior-equivalence + ToolCard switch
// T5: three reconciled schema bugs (writeFile pathMustNotContain, checksum filePath alias,
//     replaceInFile oldStr/newStr)
// Run: node --test packages/kernel/tests/wave5-tool-registry.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO, 'packages/kernel/luna-tool-guard.cjs');
const TOOL_CARD = path.join(REPO, 'packages/kernel/luna-web/src/components/ToolCard.svelte');

const { ToolGuard, validateToolCall } = require('../luna-tool-guard.cjs');

function rejects(tool, params, re) {
  assert.throws(() => validateToolCall(tool, params), re, `${tool} must reject ${JSON.stringify(params)}`);
}

// ── P0: per-schema accept/reject matrix (12 schemas, current definitions) ────
// Wave 3 H1 already pins: fail-open warn-once, writeFile filePath/file aliases
// (required + absolute + pathMustNotContain on the alias value). Not repeated here.

test('P0-1: readFile — path required (string), numeric offsets, pathMustExist NOT enforced', () => {
  assert.strictEqual(validateToolCall('readFile', { path: '/etc/hostname' }), true);
  assert.strictEqual(validateToolCall('readFile', { path: '/definitely/not/there-luna-p0' }), true,
    'pathMustExist is declared in the schema but NOT enforced by validateToolCall — pin it');
  assert.strictEqual(validateToolCall('readFile', { path: '/etc/hostname', line_offset: 10, n_lines: 5 }), true);
  rejects('readFile', {}, /campo obrigatório "path"/);
  rejects('readFile', { path: 42 }, /"path" deve ser string/);
  rejects('readFile', { path: '/etc/hostname', line_offset: '10' }, /"line_offset" deve ser number/);
});

test('P0-2: writeFile — path+content required, absolute enforced, .. and ~ rejected [CARVE-OUT 5a]', () => {
  assert.strictEqual(validateToolCall('writeFile', { path: '/abs/x', content: 'c' }), true);
  rejects('writeFile', { path: '/abs/x' }, /campo obrigatório "content"/);
  rejects('writeFile', { path: 'rel/x', content: 'c' }, /deve ser absoluto/);
  rejects('writeFile', { path: '/abs/x', content: 42 }, /"content" deve ser string/);
  // CARVE-OUT (Task 5a): CURRENT behavior — pathMustNotContain: ['..','~'] rejects the raw
  // strings even though the soul realpath guard handles them correctly. Task 5a flips these
  // two rejects to strictEqual(..., true).
  rejects('writeFile', { path: '/abs/../sibling', content: 'c' }, /contém padrão proibido/);
  rejects('writeFile', { path: '/abs/~user/x', content: 'c' }, /contém padrão proibido/);
});

test('P0-3: replaceInFile — path/old/new required + absolute; oldStr/newStr rejected [CARVE-OUT 5c]', () => {
  assert.strictEqual(validateToolCall('replaceInFile', { path: '/abs/x', old: 'a', new: 'b' }), true);
  rejects('replaceInFile', { path: '/abs/x', new: 'b' }, /campo obrigatório "old"/);
  rejects('replaceInFile', { path: 'rel', old: 'a', new: 'b' }, /deve ser absoluto/);
  // CARVE-OUT (Task 5c): CURRENT behavior — the dispatch accepts p.old||p.oldStr /
  // p.new||p.newStr (luna-soul.cjs:4291) but the schema requires old/new literally.
  rejects('replaceInFile', { path: '/abs/x', oldStr: 'a', newStr: 'b' }, /campo obrigatório "old"/);
});

test('P0-4: appendFile/deleteFile — required fields only; relative paths ALLOWED (no absolute constraint)', () => {
  assert.strictEqual(validateToolCall('appendFile', { path: 'rel/x', content: 'c' }), true,
    'appendFile schema has no pathMustBeAbsolute');
  rejects('appendFile', { path: '/abs/x' }, /campo obrigatório "content"/);
  assert.strictEqual(validateToolCall('deleteFile', { path: 'rel/x' }), true,
    'deleteFile schema has no pathMustBeAbsolute');
  rejects('deleteFile', {}, /campo obrigatório "path"/);
});

test('P0-5: executeShell — command required (string), the four forbidden patterns enforced', () => {
  assert.strictEqual(validateToolCall('executeShell', { command: 'npm test' }), true);
  assert.strictEqual(validateToolCall('executeShell', { command: 'rm -rf ./build' }), true,
    'the forbidden pattern requires an absolute target (/…) — relative rm -rf passes today');
  rejects('executeShell', {}, /campo obrigatório "command"/);
  rejects('executeShell', { command: 42 }, /"command" deve ser string/);
  rejects('executeShell', { command: 'rm -rf /' }, /comando proibido/);
  rejects('executeShell', { command: '  rm -rf /tmp/x' }, /comando proibido/);
  rejects('executeShell', { command: 'mkfs.ext4 /dev/sda1' }, /comando proibido/);
  rejects('executeShell', { command: 'dd if=/dev/zero of=/dev/sda' }, /comando proibido/);
  rejects('executeShell', { command: ':(){ :|:& };:' }, /comando proibido/);
});

test('P0-6: ipython/browser/computer — Kimi-native schemas (soul validates ipython AS executeShell)', () => {
  assert.strictEqual(validateToolCall('ipython', { code: 'print(1)' }), true);
  rejects('ipython', {}, /campo obrigatório "code"/);
  assert.strictEqual(validateToolCall('browser', { url: 'https://example.com' }), true);
  rejects('browser', {}, /campo obrigatório "url"/);
  assert.strictEqual(validateToolCall('computer', { action: 'click', x: 10, y: 20, text: 'hi' }), true);
  rejects('computer', {}, /campo obrigatório "action"/);
  rejects('computer', { action: 'click', x: '10' }, /"x" deve ser number/);
});

test('P0-7: glob/grep/validateProject — required fields, grep optional string types, validateProject absolute', () => {
  assert.strictEqual(validateToolCall('glob', { pattern: '**/*.cjs' }), true);
  rejects('glob', {}, /campo obrigatório "pattern"/);
  assert.strictEqual(validateToolCall('grep', { pattern: 'foo', path: '/abs', type: 'ts' }), true);
  rejects('grep', {}, /campo obrigatório "pattern"/);
  rejects('grep', { pattern: 'foo', path: 42 }, /"path" deve ser string/);
  assert.strictEqual(validateToolCall('validateProject', { path: '/abs/proj' }), true);
  rejects('validateProject', { path: 'rel/proj' }, /deve ser absoluto/);
  rejects('validateProject', {}, /campo obrigatório "path"/);
});

test('P0-8: path alias normalization extends to every schema with required path (appendFile filePath/file)', () => {
  assert.strictEqual(validateToolCall('appendFile', { filePath: '/abs/x', content: 'c' }), true);
  assert.strictEqual(validateToolCall('appendFile', { file: '/abs/x', content: 'c' }), true);
});

test('P0-9: fail-open default — unlisted tools accept arbitrary params (warn-once itself is wave3 H1)', () => {
  validateToolCall._warned.delete('dashboardListTasks');
  assert.strictEqual(validateToolCall('dashboardListTasks', { anything: 42, goes: null }), true);
  validateToolCall._warned.delete('dashboardListTasks');
});

test('P0-10: checksum drift IS detected when params.path is used (positive control)', async () => {
  const guard = new ToolGuard(os.tmpdir());
  const target = path.join(os.tmpdir(), `luna-p0-drift-ok-${process.pid}.txt`);
  fs.writeFileSync(target, 'v1');
  try {
    const toolFn = async () => ({ success: true }); // stubbed: no real write
    await guard.execute('writeFile', { path: target, content: 'a' }, toolFn);
    fs.writeFileSync(target, 'v2-external'); // simulate external modification
    // different content → different idempotency key → no skip → drift check runs
    await assert.rejects(() => guard.execute('writeFile', { path: target, content: 'b' }, toolFn), /Drift detectado/);
  } finally {
    try { fs.unlinkSync(target); } catch {}
  }
});

test('P0-11: checksum drift verify/record reads params.path ONLY — filePath alias bypasses it TODAY [CARVE-OUT 5b]', async () => {
  const guard = new ToolGuard(os.tmpdir());
  const target = path.join(os.tmpdir(), `luna-p0-drift-alias-${process.pid}.txt`);
  fs.writeFileSync(target, 'v1');
  try {
    const toolFn = async () => ({ success: true });
    await guard.execute('writeFile', { filePath: target, content: 'a' }, toolFn);
    fs.writeFileSync(target, 'v2-external');
    // CURRENT (buggy): verify(params.path === undefined) finds no entry → ok:true → no FILE_DRIFT.
    // Task 5b flips this to assert.rejects(..., /Drift detectado/).
    const res = await guard.execute('writeFile', { filePath: target, content: 'b' }, toolFn);
    assert.strictEqual(res.success, true, 'current behavior: drift via the filePath alias is NOT detected');
  } finally {
    try { fs.unlinkSync(target); } catch {}
  }
});
```

- [ ] **T1.2. Verify the net is GREEN at HEAD, then prove it has teeth (negative control)**

```bash
node --test packages/kernel/tests/wave5-tool-registry.test.cjs   # ALL PASS at HEAD — this is a characterization net
```

Negative control (proves the assertions aren't vacuous): temporarily edit `P0-1`'s first assertion to `assert.strictEqual(validateToolCall('readFile', { path: '/etc/hostname' }), false)`, run the suite → must FAIL → revert the edit → run again → green. Check off only after observing both.

- [ ] **T1.3. Full regression + commit**

```bash
# full regression (see header command — now includes the wave5 suite) — all green
cd /home/jhin/.luna-kernel && git add packages/kernel/tests/wave5-tool-registry.test.cjs
git commit -m "test(guard): Wave 5 Phase 0 - characterization net pinning current schema-guard behavior (12 schemas, fail-open, checksum drift; 3 carve-outs for Task 5)"
```

---

## Task 2 — Registry module + completeness and schema-shape tests

**Files:**
- New: `packages/kernel/lib/tool-registry.cjs` (132 entries, generated once by the bootstrap below, then hand-maintained)
- Test: `packages/kernel/tests/wave5-tool-registry.test.cjs` (append T2 block)

Registry entry shape: `{ aliasOf?, schema?, meta: { icon, color, label } }` — `schema` present only for the 12 tools that have one today (moved VERBATIM from the guard); `meta.icon`/`meta.color` present only for the 18 harvested frontend entries (`null` otherwise); `meta.label` is `null` everywhere (no label map existed to harvest — reserved for the UX-labels phase); `aliasOf` only on `web_search`/`webSearch`.

- [ ] **T2.1. Write the failing tests**

Append to `wave5-tool-registry.test.cjs` (lazy requires — the module doesn't exist yet):

```js
// ── T2: registry completeness + schema-shape validity ────────────────────────

test('T2: registry covers every luna-tools export + the 3 soul-only dispatched tools', () => {
  const { TOOL_REGISTRY } = require('../lib/tool-registry.cjs');
  const toolNames = Object.keys(require('../luna-tools.cjs'));
  // Dispatched by luna-soul.cjs outside the export map (:4579-4586, :4526-4578):
  const SOUL_ONLY = ['dashboardCommandRouter', 'ipython', 'computer'];
  for (const name of [...toolNames, ...SOUL_ONLY]) {
    assert.ok(TOOL_REGISTRY[name], `registry entry missing for dispatched tool "${name}"`);
  }
  assert.strictEqual(
    Object.keys(TOOL_REGISTRY).length,
    toolNames.length + SOUL_ONLY.length,
    'registry must contain EXACTLY the dispatched tools — adding a tool means adding a registry entry'
  );
});

test('T2: every registry entry has a valid shape (schema vocabulary + meta slots)', () => {
  const { TOOL_REGISTRY } = require('../lib/tool-registry.cjs');
  const SCHEMA_KEYS = new Set(['required', 'types', 'pathMustExist', 'pathMustBeAbsolute', 'pathMustNotContain', 'forbiddenPatterns']);
  const TYPE_VALUES = new Set(['string', 'number', 'boolean', 'object']);
  for (const [name, entry] of Object.entries(TOOL_REGISTRY)) {
    assert.ok(entry.meta && 'icon' in entry.meta && 'color' in entry.meta && 'label' in entry.meta,
      `${name}: meta must carry the icon/color/label slots`);
    if (entry.aliasOf) assert.strictEqual(typeof entry.aliasOf, 'string', `${name}: aliasOf must be a string`);
    if (!entry.schema) continue;
    for (const key of Object.keys(entry.schema)) {
      assert.ok(SCHEMA_KEYS.has(key), `${name}: unknown schema key "${key}" (validateToolCall would ignore it)`);
    }
    assert.ok(Array.isArray(entry.schema.required), `${name}: schema.required must be an array`);
    for (const [field, type] of Object.entries(entry.schema.types || {})) {
      assert.ok(TYPE_VALUES.has(type), `${name}: bad type "${type}" for field "${field}"`);
    }
    for (const re of entry.schema.forbiddenPatterns || []) {
      assert.ok(re instanceof RegExp, `${name}: forbiddenPatterns entries must be RegExp (got ${typeof re})`);
    }
  }
});

test('T2: registry schemas are identical to the pre-migration guard TOOL_SCHEMAS (verbatim move)', () => {
  const { buildToolSchemas } = require('../lib/tool-registry.cjs');
  const { TOOL_SCHEMAS } = require('../luna-tool-guard.cjs');
  const fromRegistry = buildToolSchemas();
  assert.deepStrictEqual(Object.keys(fromRegistry).sort(), Object.keys(TOOL_SCHEMAS).sort(),
    'registry must carry exactly the 12 current schemas');
  for (const name of Object.keys(TOOL_SCHEMAS)) {
    assert.deepStrictEqual(fromRegistry[name], TOOL_SCHEMAS[name], `${name}: schema must be a verbatim move`);
  }
});

test('T2: registry meta is a superset of the 18 harvested ToolCard entries', () => {
  const { TOOL_REGISTRY } = require('../lib/tool-registry.cjs');
  const HARVESTED = {
    writeFile: ['📄', '#3b82f6'], readFile: ['👁', '#22c55e'], executeShell: ['⚡', '#a855f7'],
    searchWeb: ['🌐', '#f97316'], searchFiles: ['🔍', '#f97316'], gitStatus: ['🌿', '#6b7280'],
    gitDiff: ['📊', '#6b7280'], gitLog: ['📜', '#6b7280'], gitCommit: ['💾', '#6b7280'],
    dashboardCreateTask: ['📋', '#ec4899'], dashboardListTasks: ['📋', '#ec4899'],
    dashboardCreateLead: ['👤', '#ec4899'], dashboardListLeads: ['👥', '#ec4899'],
    dashboardGetFinanceSummary: ['💰', '#ec4899'], replaceInFile: ['✏️', '#06b6d4'],
    ipython: ['🐍', '#f59e0b'], web_search: ['🌐', '#f97316'], browser: ['🌍', '#3b82f6'],
  };
  for (const [name, [icon, color]] of Object.entries(HARVESTED)) {
    assert.strictEqual(TOOL_REGISTRY[name]?.meta?.icon, icon, `${name}: icon must match ToolCard`);
    assert.strictEqual(TOOL_REGISTRY[name]?.meta?.color, color, `${name}: color must match ToolCard`);
  }
});
```

Run `node --test packages/kernel/tests/wave5-tool-registry.test.cjs` → FAILS (`Cannot find module '../lib/tool-registry.cjs'`).

- [ ] **T2.2. Bootstrap the registry from the three current sources, then review it**

The registry is GENERATED ONCE from the current ground truths (guard `TOOL_SCHEMAS`, `luna-tools.cjs` exports, harvested ToolCard maps) so the 132 entries can never be mistyped, then committed and hand-maintained. Create `scripts/.bootstrap-tool-registry.cjs` (dotfile = one-shot, deleted after):

```js
'use strict';
// One-shot Wave 5 bootstrap: writes packages/kernel/lib/tool-registry.cjs from
// the three CURRENT sources of truth. Run once, review the output, delete this file.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const lunaTools = require(path.join(REPO, 'packages/kernel/luna-tools.cjs'));
const { TOOL_SCHEMAS } = require(path.join(REPO, 'packages/kernel/luna-tool-guard.cjs'));

// Harvested VERBATIM from packages/kernel/luna-web/src/components/ToolCard.svelte
// (TOOL_COLORS + TOOL_ICONS @ 64982a4). label: no label map existed — null.
const HARVESTED_META = {
  writeFile: { icon: '📄', color: '#3b82f6' },
  readFile: { icon: '👁', color: '#22c55e' },
  executeShell: { icon: '⚡', color: '#a855f7' },
  searchWeb: { icon: '🌐', color: '#f97316' },
  searchFiles: { icon: '🔍', color: '#f97316' },
  gitStatus: { icon: '🌿', color: '#6b7280' },
  gitDiff: { icon: '📊', color: '#6b7280' },
  gitLog: { icon: '📜', color: '#6b7280' },
  gitCommit: { icon: '💾', color: '#6b7280' },
  dashboardCreateTask: { icon: '📋', color: '#ec4899' },
  dashboardListTasks: { icon: '📋', color: '#ec4899' },
  dashboardCreateLead: { icon: '👤', color: '#ec4899' },
  dashboardListLeads: { icon: '👥', color: '#ec4899' },
  dashboardGetFinanceSummary: { icon: '💰', color: '#ec4899' },
  replaceInFile: { icon: '✏️', color: '#06b6d4' },
  ipython: { icon: '🐍', color: '#f59e0b' },
  web_search: { icon: '🌐', color: '#f97316' },
  browser: { icon: '🌍', color: '#3b82f6' },
};

const ALIASES = { web_search: 'searchWeb', webSearch: 'searchWeb' };
// Dispatched by luna-soul.cjs outside the export map (:4579-4586, :4526-4578).
const SOUL_ONLY = ['dashboardCommandRouter', 'ipython', 'computer'];

function renderValue(v, indent) {
  if (v instanceof RegExp) return v.toString();
  if (Array.isArray(v)) return '[' + v.map((x) => renderValue(x, indent)).join(', ') + ']';
  if (v && typeof v === 'object') {
    const pad = '  '.repeat(indent);
    const inner = Object.entries(v).map(([k, x]) => `${pad}  ${k}: ${renderValue(x, indent + 1)},`).join('\n');
    return `{\n${inner}\n${pad}}`;
  }
  return JSON.stringify(v);
}

const names = [...Object.keys(lunaTools), ...SOUL_ONLY];
const body = names.map((name) => {
  const lines = [`  ${JSON.stringify(name)}: {`];
  if (ALIASES[name]) lines.push(`    aliasOf: ${JSON.stringify(ALIASES[name])},`);
  if (TOOL_SCHEMAS[name]) lines.push(`    schema: ${renderValue(TOOL_SCHEMAS[name], 2)},`);
  const meta = HARVESTED_META[name] || { icon: null, color: null };
  lines.push(`    meta: { icon: ${JSON.stringify(meta.icon)}, color: ${JSON.stringify(meta.color)}, label: null },`);
  lines.push('  },');
  return lines.join('\n');
}).join('\n');

const out = `'use strict';
/**
 * lib/tool-registry.cjs — Wave 5: THE single source of truth for Luna tools.
 *
 * One entry per dispatched tool name (129 luna-tools.cjs exports + 3 soul-only
 * dispatches: dashboardCommandRouter, ipython, computer = 132 entries):
 *   aliasOf — set when this name aliases another entry (web_search → searchWeb)
 *   schema  — guard input schema (moved VERBATIM from luna-tool-guard.cjs in Wave 5)
 *   meta    — frontend metadata { icon, color, label } harvested from ToolCard.svelte.
 *             label is null until the accepted UX-labels phase populates it.
 *
 * Consumers: luna-tool-guard.cjs derives TOOL_SCHEMAS via buildToolSchemas();
 * the frontend derives its icon/color maps via scripts/gen-tool-meta.cjs
 * (checked-in codegen — never hand-edit the generated file).
 * Desktop tools (luna-soul.cjs DESKTOP_TOOLS) are a separate dispatch subsystem
 * and intentionally NOT in this registry.
 */

const TOOL_REGISTRY = {
${body}
};

function buildToolSchemas() {
  const schemas = {};
  for (const [name, entry] of Object.entries(TOOL_REGISTRY)) {
    if (entry.schema) schemas[name] = entry.schema;
  }
  return schemas;
}

module.exports = { TOOL_REGISTRY, buildToolSchemas };
`;

const target = path.join(REPO, 'packages/kernel/lib/tool-registry.cjs');
fs.writeFileSync(target, out);
console.log(`[bootstrap] wrote ${target} with ${names.length} entries (${Object.keys(TOOL_SCHEMAS).length} schemas, ${Object.keys(HARVESTED_META).length} meta)`);
```

Run it, review, clean up:

```bash
cd /home/jhin/.luna-kernel && node scripts/.bootstrap-tool-registry.cjs
# expected: "[bootstrap] wrote ... with 132 entries (12 schemas, 18 meta)"
node -e "const r=require('./packages/kernel/lib/tool-registry.cjs'); console.log(Object.keys(r.TOOL_REGISTRY).length, Object.keys(r.buildToolSchemas()).length)"   # → 132 12
```

Manual review checklist before proceeding: (a) spot-check the `writeFile` entry — `pathMustNotContain: ['..', '~']` present as a real array (Task 5a will remove it); (b) spot-check `executeShell` — the four `forbiddenPatterns` are real `/.../ ` RegExp literals, not strings; (c) spot-check `web_search` — has `aliasOf: "searchWeb"` AND its harvested meta; (d) spot-check any dashboard tool — `meta: { icon: null, color: null, label: null }`; (e) quote style in the generated file is JSON double-quotes — acceptable (checked-in generated-then-maintained file; no formatter is configured in this repo).

```bash
rm scripts/.bootstrap-tool-registry.cjs
```

- [ ] **T2.3. Verify + regression + commit**

```bash
node --test packages/kernel/tests/wave5-tool-registry.test.cjs   # P0 + T2 green
# full regression — all green
cd /home/jhin/.luna-kernel && git add packages/kernel/lib/tool-registry.cjs packages/kernel/tests/wave5-tool-registry.test.cjs
git commit -m "feat(tools): single tool registry (lib/tool-registry.cjs) - 132 entries with verbatim guard schemas + harvested frontend metadata"
```

---

## Task 3 — Guard consumes schemas from the registry (zero behavior change)

**Files:**
- Modify: `packages/kernel/luna-tool-guard.cjs` (`:17` require block, `:150-207` inline `TOOL_SCHEMAS` literal, `:209-212` stale comment)
- Test: `packages/kernel/tests/wave5-tool-registry.test.cjs` (append T3 block)

The Phase 0 net (Task 1) is the behavioral proof: it passed against the inline map and must pass IDENTICALLY after this task. The `TOOL_SCHEMAS` export is kept (derived) so nothing downstream breaks.

- [ ] **T3.1. Write the failing test**

Append to `wave5-tool-registry.test.cjs`:

```js
// ── T3: guard consumes schemas from the registry ─────────────────────────────

test('T3: guard derives TOOL_SCHEMAS from the registry (inline literal deleted)', () => {
  const src = fs.readFileSync(GUARD, 'utf8');
  assert.ok(src.includes("require('./lib/tool-registry.cjs')"), 'guard must require the registry');
  assert.ok(!src.includes('const TOOL_SCHEMAS = {'), 'the inline schema literal must be gone');
  assert.ok(src.includes('const TOOL_SCHEMAS = buildToolSchemas();'), 'schemas must be derived from the registry');
  const { TOOL_SCHEMAS } = require('../luna-tool-guard.cjs');
  const { buildToolSchemas } = require('../lib/tool-registry.cjs');
  assert.deepStrictEqual(TOOL_SCHEMAS, buildToolSchemas(), 'exported TOOL_SCHEMAS must be the registry-derived map');
});
```

Run → FAILS (guard still has the inline literal).

- [ ] **T3.2. Migrate the guard**

1. In the require block at the top of `luna-tool-guard.cjs` (after `:16` `const { clampExecTimeout } = require('./lib/exec-timeout.cjs');`), add:
   ```js
   const { buildToolSchemas } = require('./lib/tool-registry.cjs');
   ```
2. Replace the ENTIRE inline literal (`:150-207`, from `// ── 4. Schema Validation ──` through the closing `};` after `validateProject`) with:
   ```js
   // ── 4. Schema Validation ──
   // Wave 5: schemas live in the single tool registry (lib/tool-registry.cjs).
   // TOOL_SCHEMAS is DERIVED from it — identical content to the pre-Wave-5 inline
   // map, proven by the Phase 0 characterization net (wave5-tool-registry.test.cjs).
   const TOOL_SCHEMAS = buildToolSchemas();
   ```
3. Rewrite the stale Wave 3 comment (`:209-212`, references the nonexistent `docs/luna-tools-registry.json`) to:
   ```js
   // Wave 3 (Fix H): tools sem schema estrito validam contra um default permissivo
   // (fail-open, warn-once) em vez de derrubar a tool call. Wave 5: os schemas
   // migraram para lib/tool-registry.cjs (fonte única); tools sem entry de schema
   // seguem no fail-open até ganharem schemas no registry.
   ```

**What NOT to touch:** `validateToolCall` itself, the `_warned` set, `DEFAULT_SCHEMA`, the `TOOL_SCHEMAS` line in `module.exports` (`:568`), anything else in the file.

- [ ] **T3.3. Verify + regression + commit (NO dist rebuild — no luna-web source changed)**

```bash
node --test packages/kernel/tests/wave5-tool-registry.test.cjs   # P0 net STILL green (behavior proof) + T2/T3 green
# full regression — all green (wave3 H tests are the second behavior proof)
cd /home/jhin/.luna-kernel && git add packages/kernel/luna-tool-guard.cjs packages/kernel/tests/wave5-tool-registry.test.cjs
git commit -m "refactor(guard): consume tool schemas from lib/tool-registry.cjs - zero behavior change (Phase 0 net green)"
```

---

## Task 4 — Frontend metadata generated from the registry (luna-web — dist rebuild required)

**Files:**
- New: `scripts/gen-tool-meta.cjs` (repo root; the `scripts/` dir already exists)
- New (generated, committed): `packages/kernel/luna-web/src/lib/toolMeta.generated.js`
- Modify: `packages/kernel/luna-web/src/components/ToolCard.svelte` (`:11-29` — replace the two inline maps with the generated import)
- Modify: `packages/kernel/luna-web/dist/**` (rebuilt, tracked)
- Test: `packages/kernel/tests/wave5-tool-registry.test.cjs` (append T4 block)

Behavior-neutral by construction: the generated maps contain EXACTLY the 18 harvested entries, so `TOOL_COLORS[tool] || '#6b7280'` and `TOOL_ICONS[tool] || '🔧'` resolve identically for every tool.

- [ ] **T4.1. Write the failing tests**

Append to `wave5-tool-registry.test.cjs` (lazy requires — the script and generated file don't exist yet):

```js
// ── T4: frontend metadata codegen ────────────────────────────────────────────

test('T4: committed toolMeta.generated.js is byte-identical to a fresh render (no drift)', () => {
  const { render } = require(path.join(REPO, 'scripts/gen-tool-meta.cjs'));
  const committed = fs.readFileSync(
    path.join(REPO, 'packages/kernel/luna-web/src/lib/toolMeta.generated.js'), 'utf8');
  assert.strictEqual(committed, render(),
    'generated file is stale — regenerate with: node scripts/gen-tool-meta.cjs');
});

test('T4: generated maps match the pre-Wave-5 ToolCard maps exactly (behavior-neutral)', () => {
  const { TOOL_COLORS, TOOL_ICONS } = require('../luna-web/src/lib/toolMeta.generated.js');
  assert.deepStrictEqual(TOOL_COLORS, {
    writeFile: '#3b82f6', readFile: '#22c55e', executeShell: '#a855f7',
    searchWeb: '#f97316', searchFiles: '#f97316', gitStatus: '#6b7280',
    gitDiff: '#6b7280', gitLog: '#6b7280', gitCommit: '#6b7280',
    dashboardCreateTask: '#ec4899', dashboardListTasks: '#ec4899',
    dashboardCreateLead: '#ec4899', dashboardListLeads: '#ec4899',
    dashboardGetFinanceSummary: '#ec4899', replaceInFile: '#06b6d4',
    ipython: '#f59e0b', web_search: '#f97316', browser: '#3b82f6',
  });
  assert.deepStrictEqual(TOOL_ICONS, {
    writeFile: '📄', readFile: '👁', executeShell: '⚡',
    searchWeb: '🌐', searchFiles: '🔍', gitStatus: '🌿',
    gitDiff: '📊', gitLog: '📜', gitCommit: '💾',
    dashboardCreateTask: '📋', dashboardListTasks: '📋',
    dashboardCreateLead: '👤', dashboardListLeads: '👥',
    dashboardGetFinanceSummary: '💰', replaceInFile: '✏️',
    ipython: '🐍', web_search: '🌐', browser: '🌍',
  });
});

test('T4: ToolCard imports the generated module (hand-maintained maps deleted)', () => {
  const src = fs.readFileSync(TOOL_CARD, 'utf8');
  assert.ok(src.includes("from '../lib/toolMeta.generated.js'"), 'ToolCard must import the generated module');
  assert.ok(!src.includes('const TOOL_COLORS = {'), 'inline TOOL_COLORS map must be gone');
  assert.ok(!src.includes('const TOOL_ICONS = {'), 'inline TOOL_ICONS map must be gone');
  assert.ok(src.includes("TOOL_COLORS[tool] || '#6b7280'"), 'color fallback must be preserved');
  assert.ok(src.includes("TOOL_ICONS[tool] || '🔧'"), 'icon fallback must be preserved');
});
```

Run → FAILS (script and generated file missing).

- [ ] **T4.2. Create the generator `scripts/gen-tool-meta.cjs`**

```js
#!/usr/bin/env node
'use strict';
// Wave 5: generate the frontend tool-metadata module from the single registry.
// Usage: node scripts/gen-tool-meta.cjs
//   writes packages/kernel/luna-web/src/lib/toolMeta.generated.js
// The drift test (wave5-tool-registry.test.cjs T4) re-renders in memory and
// asserts the committed file is byte-identical — never hand-edit the output.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const OUT = path.join(REPO, 'packages/kernel/luna-web/src/lib/toolMeta.generated.js');

function render() {
  const { TOOL_REGISTRY } = require(path.join(REPO, 'packages/kernel/lib/tool-registry.cjs'));
  const colors = {};
  const icons = {};
  for (const [name, entry] of Object.entries(TOOL_REGISTRY)) {
    if (entry.meta && entry.meta.color) colors[name] = entry.meta.color;
    if (entry.meta && entry.meta.icon) icons[name] = entry.meta.icon;
  }
  const fmt = (obj) => Object.entries(obj).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join('\n');
  return `// GENERATED by scripts/gen-tool-meta.cjs from packages/kernel/lib/tool-registry.cjs — DO NOT EDIT.
// Update the registry (meta.icon / meta.color), then run: node scripts/gen-tool-meta.cjs
export const TOOL_COLORS = {
${fmt(colors)}
};

export const TOOL_ICONS = {
${fmt(icons)}
};
`;
}

if (require.main === module) {
  fs.writeFileSync(OUT, render());
  console.log(`[gen-tool-meta] wrote ${path.relative(process.cwd(), OUT)}`);
}

module.exports = { render };
```

- [ ] **T4.3. Generate the file and inspect it**

```bash
cd /home/jhin/.luna-kernel && node scripts/gen-tool-meta.cjs
cat packages/kernel/luna-web/src/lib/toolMeta.generated.js
```

Checklist: exactly 18 entries in each map; keys/values identical to the maps still in `ToolCard.svelte`; file starts with the DO NOT EDIT header; valid ESM (`export const`).

- [ ] **T4.4. Switch ToolCard to the generated module**

In `packages/kernel/luna-web/src/components/ToolCard.svelte`, replace the two inline map declarations (`:11-29`, i.e. `const TOOL_COLORS = { ... };` and `const TOOL_ICONS = { ... };`) with:

```js
  // Wave 5: icon/color maps are GENERATED from the backend tool registry
  // (packages/kernel/lib/tool-registry.cjs → scripts/gen-tool-meta.cjs).
  // Never hand-edit toolMeta.generated.js — update the registry and regenerate.
  import { TOOL_COLORS, TOOL_ICONS } from '../lib/toolMeta.generated.js';
```

**What NOT to touch:** the `$:` reactive lines (`:31-51`), the fallbacks `'#6b7280'`/`'🔧'`, markup, styles, the `formatDuration` import (`:2`).

- [ ] **T4.5. Verify + build + regression + commit (dist rebuild REQUIRED — luna-web source changed)**

```bash
node --test packages/kernel/tests/wave5-tool-registry.test.cjs   # T4 green
cd /home/jhin/.luna-kernel/packages/kernel/luna-web && corepack pnpm build   # ~25s; must succeed with no new warnings
# full regression — all green
cd /home/jhin/.luna-kernel && git add scripts/gen-tool-meta.cjs packages/kernel/luna-web/src/lib/toolMeta.generated.js packages/kernel/luna-web/src/components/ToolCard.svelte packages/kernel/luna-web/dist packages/kernel/tests/wave5-tool-registry.test.cjs
git commit -m "feat(frontend): generate ToolCard icon/color maps from the tool registry - 4 sources of truth become 3"
```

Manual review checklist: (a) build output contains no import errors for `toolMeta.generated.js`; (b) `grep -rn "TOOL_COLORS" packages/kernel/luna-web/src` shows ONLY the ToolCard import line (ToolCard is the sole consumer — grep-verified at plan time); (c) the drift test passing proves committed file == registry render.

---

## Task 5 — Reconcile the three deferred schema bugs (grouped: three small sub-fixes)

**Files:**
- Modify: `packages/kernel/lib/tool-registry.cjs` (5a: writeFile entry)
- Modify: `packages/kernel/luna-tool-guard.cjs` (5b: `execute()` checksum blocks at `:499-506` and `:525-527`; 5c: `validateToolCall` alias block at `:226-232`)
- Modify: `packages/kernel/tests/wave5-tool-registry.test.cjs` (flip the three carve-outs: P0-2, P0-3, P0-11)
- Modify: `packages/kernel/tests/wave3-guard-tools.test.cjs` (5a: flip the H1 `pathMustNotContain` test at `:955-960` — INTENTIONAL, this test pins the behavior 5a removes; no other existing test is touched)

These are behavior CHANGES, each with a failing test first. The Phase 0 net's carve-out comments mark exactly which assertions flip.

- [ ] **T5.1. Flip the three carve-out tests to the NEW behavior (they must fail now)**

1. In `wave5-tool-registry.test.cjs`, in test `P0-2`, replace the two carve-out `rejects(...)` lines AND the carve-out comment with:
   ```js
   // 5a RESOLVED: writeFile schema no longer rejects '..' or '~' — the soul's
   // realpath path-guard (lib/path-guard.cjs) is the traversal authority.
   assert.strictEqual(validateToolCall('writeFile', { path: '/abs/../sibling', content: 'c' }), true);
   assert.strictEqual(validateToolCall('writeFile', { path: '/abs/~user/x', content: 'c' }), true);
   // The absolute-path check is untouched: '~'-prefixed paths were always rejected
   // by pathMustBeAbsolute BEFORE pathMustNotContain ever fired.
   rejects('writeFile', { path: '~/notes.md', content: 'c' }, /deve ser absoluto/);
   ```
   Also rename the test to `'P0-2: writeFile — path+content required, absolute enforced, .. and ~ ACCEPTED (5a resolved)'`.
2. In test `P0-3`, replace the carve-out comment + `rejects('replaceInFile', { path: '/abs/x', oldStr: 'a', newStr: 'b' }, ...)` line with:
   ```js
   // 5c RESOLVED: schema accepts the oldStr/newStr aliases the dispatch already took.
   assert.strictEqual(validateToolCall('replaceInFile', { path: '/abs/x', oldStr: 'a', newStr: 'b' }), true);
   assert.strictEqual(validateToolCall('replaceInFile', { path: '/abs/x', old: 'a', newStr: 'b' }), true, 'mixed aliases normalize');
   rejects('replaceInFile', { path: '/abs/x', oldStr: 42, newStr: 'b' }, /"old" deve ser string/,
     'type check applies to the normalized alias value');
   rejects('replaceInFile', { path: '/abs/x' }, /campo obrigatório "old"/);
   ```
   Also rename the test to `'P0-3: replaceInFile — path/old/new required + absolute; oldStr/newStr ACCEPTED (5c resolved)'`.
3. Replace the entire `P0-11` test with:
   ```js
   test('P0-11: checksum drift verify/record resolves the filePath/file aliases (5b resolved)', async () => {
     const toolFn = async () => ({ success: true });
     const target = path.join(os.tmpdir(), `luna-t5-drift-${process.pid}.txt`);
     try {
       // filePath alias
       const guard1 = new ToolGuard(os.tmpdir());
       fs.writeFileSync(target, 'v1');
       await guard1.execute('writeFile', { filePath: target, content: 'a' }, toolFn);
       fs.writeFileSync(target, 'v2-external');
       await assert.rejects(() => guard1.execute('writeFile', { filePath: target, content: 'b' }, toolFn), /Drift detectado/);
       // file alias (appendFile goes through the record path too)
       const guard2 = new ToolGuard(os.tmpdir());
       fs.writeFileSync(target, 'v3');
       await guard2.execute('appendFile', { file: target, content: 'a' }, toolFn);
       fs.writeFileSync(target, 'v4-external');
       await assert.rejects(() => guard2.execute('appendFile', { file: target, content: 'b' }, toolFn), /Drift detectado/);
     } finally {
       try { fs.unlinkSync(target); } catch {}
     }
   });
   ```
4. In `wave3-guard-tools.test.cjs`, replace the H1 test at `:955-960`:
   ```js
   test('H1: pathMustNotContain also applies to the resolved alias value', () => {
     assert.throws(
       () => validateToolCall('writeFile', { filePath: '/abs/../escape', content: 'c' }),
       /padrão proibido/
     );
   });
   ```
   with:
   ```js
   // Wave 5 (Task 5a): writeFile pathMustNotContain was REMOVED from the registry
   // schema — soul's realpath path-guard owns traversal safety; the schema no
   // longer rejects raw '..'/'~' in the path value.
   test('H1: writeFile schema accepts .. and ~ in the alias value (path guard owns traversal)', () => {
     assert.strictEqual(validateToolCall('writeFile', { filePath: '/abs/../escape', content: 'c' }), true);
     assert.strictEqual(validateToolCall('writeFile', { path: '/abs/~user/x', content: 'c' }), true);
   });
   ```

Run `node --test packages/kernel/tests/wave5-tool-registry.test.cjs packages/kernel/tests/wave3-guard-tools.test.cjs` → FAILS (P0-2, P0-3, P0-11, and the flipped wave3 H1).

- [ ] **T5.2. Implement 5a — remove `pathMustNotContain` from the writeFile schema**

In `packages/kernel/lib/tool-registry.cjs`, in the `writeFile` entry, delete the line `pathMustNotContain: ['..', '~'],` (rendered with JSON quotes as `"pathMustNotContain": ["..", "~"],` by the bootstrap — match whatever the file actually contains). The entry keeps `required`, `types`, `pathMustBeAbsolute: true`. Leave the guard's generic `pathMustNotContain` enforcement loop (`luna-tool-guard.cjs:253-259`) in place — it is now unused machinery, harmless, and still part of the schema vocabulary the T2 shape test allows.

- [ ] **T5.3. Implement 5b — alias-aware checksum paths in `ToolGuard.execute`**

In `luna-tool-guard.cjs`, replace the checksum-before-edit block (`:498-506`):

```js
    // 6. Checksum antes de editar
    if (['writeFile', 'replaceInFile', 'appendFile', 'deleteFile'].includes(toolName)) {
      const check = this.checksums.verify(params.path);
      if (!check.ok) {
        const err = new Error(`Drift detectado em "${params.path}": ${check.reason}. O arquivo foi modificado externamente. Abortando para evitar perda de dados.`);
        err.code = 'FILE_DRIFT';
        throw err;
      }
    }
```

with:

```js
    // 6. Checksum antes de editar
    // Wave 5 (5b): resolve through the same path aliases the dispatch accepts —
    // params.filePath / params.file bypassed drift verify AND record entirely.
    const driftPath = params.path || params.filePath || params.file;
    if (['writeFile', 'replaceInFile', 'appendFile', 'deleteFile'].includes(toolName)) {
      const check = this.checksums.verify(driftPath);
      if (!check.ok) {
        const err = new Error(`Drift detectado em "${driftPath}": ${check.reason}. O arquivo foi modificado externamente. Abortando para evitar perda de dados.`);
        err.code = 'FILE_DRIFT';
        throw err;
      }
    }
```

and replace the record block (`:525-527`):

```js
    // 6. Update checksum após editar
    if (['writeFile', 'replaceInFile', 'appendFile'].includes(toolName)) {
      this.checksums.record(params.path);
    }
```

with:

```js
    // 6. Update checksum após editar (Wave 5: same alias resolution as the verify above)
    if (['writeFile', 'replaceInFile', 'appendFile'].includes(toolName)) {
      this.checksums.record(driftPath);
    }
```

Behavior when no alias is present: `driftPath` is `undefined` → `verify(undefined)` returns `{ ok: true, reason: 'no prior checksum' }` and `record(undefined)` no-ops (computeChecksum catches the read error) — IDENTICAL to today's `params.path`-undefined behavior.

- [ ] **T5.4. Implement 5c — oldStr/newStr normalization in `validateToolCall`**

In `luna-tool-guard.cjs`, inside `validateToolCall`, immediately after the existing path-alias normalization block (`:228-231`, the `if ((schema.required || []).includes('path') ...}` block), add:

```js
  // Wave 5 (5c): replaceInFile dispatch accepts oldStr/newStr aliases
  // (luna-soul.cjs: p.old || p.oldStr, p.new || p.newStr) — normalize before
  // the required/type checks so the schema and the dispatch agree.
  if (toolName === 'replaceInFile') {
    if (p.old === undefined && p.oldStr !== undefined) p.old = p.oldStr;
    if (p.new === undefined && p.newStr !== undefined) p.new = p.newStr;
  }
```

(Type enforcement comes for free: a non-string `oldStr` lands in `p.old` and trips the existing `types: { old: 'string' }` check.)

- [ ] **T5.5. Verify + regression + commit (NO dist rebuild — no luna-web source changed)**

```bash
node --test packages/kernel/tests/wave5-tool-registry.test.cjs packages/kernel/tests/wave3-guard-tools.test.cjs   # all green
# full regression — all green
cd /home/jhin/.luna-kernel && git add packages/kernel/lib/tool-registry.cjs packages/kernel/luna-tool-guard.cjs packages/kernel/tests/wave5-tool-registry.test.cjs packages/kernel/tests/wave3-guard-tools.test.cjs
git commit -m "fix(guard): reconcile 3 deferred schema bugs - writeFile pathMustNotContain removed, checksum drift resolves filePath/file aliases, replaceInFile accepts oldStr/newStr"
```

---

## Task 6 — Close the wave in `.brain/bugs.md`

**Files:**
- Modify: `packages/kernel/.brain/bugs.md` (Tools/Guard Open section `:33-39`; Resolved section — new `### Wave 5` entry)

- [ ] **T6.1. Move the resolved items and record the wave**

1. From `## Open` → `### Tools / Guard`, DELETE these two bullets (both resolved by Task 5):
   - the `writeFile schema pathMustNotContain …` bullet (`:36`)
   - the `Checksum drift protection only reads params.path …` bullet (`:37`, covers both the checksum alias AND the replaceInFile `old`/`new` desync)
   Leave the other three bullets in place (heuristic validators — still deferred per decisions; `dashboardCommandRouter` success:true; `fs.writeFileSync` sites).
2. Under `## Resolved`, append AFTER the `### Wave 4` section:
   ```markdown
   ### Wave 5 (2026-07-12) — tool registry (modularization Phase 0+1)

   - [x] 🟡 **writeFile schema `pathMustNotContain: ['..','~']` contradicts the path guard** — rule removed from the registry's writeFile schema; soul's realpath path-guard (`lib/path-guard.cjs`) remains the sole traversal authority. (`<hash-t5>`; tests `wave5-tool-registry.test.cjs` P0-2, wave3 H1 updated)
   - [x] 🟡 **Checksum drift protection only read `params.path`** — guard resolves `path || filePath || file` for drift verify/record; `replaceInFile` schema now accepts the `oldStr`/`newStr` aliases the dispatch already took. (`<hash-t5>`; tests P0-3, P0-11)
   - [x] 🟡 **Four sources of truth for tools → three** — `lib/tool-registry.cjs` (132 entries) is THE source: guard schemas derive from it (`buildToolSchemas()`); frontend icon/color maps are GENERATED from it (`scripts/gen-tool-meta.cjs` → `luna-web/src/lib/toolMeta.generated.js`, byte-drift test T4). Accepted residual: the master-prompt tool docs (`LUNA_MASTER_PROMPT.md`) stay hand-maintained. (`<hash-t2>`, `<hash-t3>`, `<hash-t4>`)
   ```
3. Replace every `<hash-tN>` with the actual commit hash from the corresponding task (`git log --oneline -8`).

- [ ] **T6.2. Commit**

```bash
cd /home/jhin/.luna-kernel && git add packages/kernel/.brain/bugs.md
git commit -m "docs(brain): close Wave 5 - tool registry landed, 4->3 sources of truth, 3 guard schema bugs resolved"
```

---

## Out of scope (explicitly NOT in Wave 5)

- **Provider abstraction** (Kimi/OpenAI/Claude) and **renaming "soul"→"kernel"** — later modularization phases.
- **Per-tool schemas for the ~120 unschema'd tools** — the registry makes this incremental now (add a `schema` to any entry), but authoring them is a later wave; fail-open stays the default.
- **ChatArea/ToolCard decomposition, UX card redesign, human tool labels** — accepted as a dedicated frontend phase (decisions.md); `meta.label` slots exist but stay `null`.
- **Bridge parser duplication** and **`luna-code-validator.cjs` heuristic validators** — still deferred (needs a real parser).
- **Desktop tools** (`DESKTOP_TOOLS`, `luna-soul.cjs:4150`) — separate dispatch subsystem, no guard/frontend-meta involvement; not in the registry.
- **Pre-existing dispatch desync** (`validateProject`, `getVisibleMode`, `setVisibleMode`, `lunaSelfUpdate` exported but unreachable via the soul switch) — registered in this plan's verification notes; not fixed here.
- **`dashboardCommandRouter` success-on-failure** and **non-atomic `fs.writeFileSync` soul sites** — open bugs untouched by this wave.
- **PM2 restarts / runtime smoke** — the owner restarts and validates live himself.

---

## Self-Review

**Coverage of every deferred bug assigned to this wave:** (i) writeFile `pathMustNotContain` → Task 5a (failing flip in P0-2 + wave3 H1, registry edit); (ii) checksum drift alias bypass → Task 5b (failing flip in P0-11, guard `execute()` edit at the REAL drift sites `:500`/`:526` — the bugs.md citation `:475,518` had drifted); (iii) replaceInFile `old`/`new` vs `oldStr`/`newStr` → Task 5c (failing flip in P0-3, `validateToolCall` normalization). The heuristic-validators bug is deliberately NOT covered — decisions defer it (needs a real parser); Task 6 leaves it Open. ✅

**Placeholder scan:** no TBDs. Every task ships actual test code and actual implementation code: the full Phase 0 net, the full bootstrap script (with all 12 schemas sourced programmatically from the guard and all 18 meta entries harvested inline), the full generator, the full ToolCard diff, the full guard diffs, and the exact wave3 test replacement. The only `<...>` placeholders are the commit-hash fills in Task 6, with the command to resolve them.

**Cross-task name consistency:** `lib/tool-registry.cjs` (`TOOL_REGISTRY`, `buildToolSchemas`), `scripts/gen-tool-meta.cjs` (`render`), `packages/kernel/luna-web/src/lib/toolMeta.generated.js` (`TOOL_COLORS`, `TOOL_ICONS`), and `wave5-tool-registry.test.cjs` (P0-1…P0-11, T2, T3, T4) are spelled identically in every task that references them; carve-out flips reference the exact test names defined in Task 1 (P0-2 ↔ 5a, P0-3 ↔ 5c, P0-11 ↔ 5b).

**Ordering rationale:** Task 1 first (net must exist before anything moves). Task 2 pure additive (new module, no consumers). Task 3 mechanical move whose correctness is proven by Task 1's net + the wave3 suite — it must precede Task 5a because 5a edits the schema in its NEW home. Task 4 before Task 5: the frontend switch is behavior-neutral and independent of the reconciliations, keeping intentional behavior changes (Task 5) isolated in one commit at the end of the code work. Task 6 is bookkeeping that needs all five commit hashes.

**Risk containment:** the migration's zero-behavior-change claim is enforced three ways — the P0 net (green before AND after Task 3), the T2 verbatim-move deep-equality test, and the untouched wave3 H suite. The one intentional existing-test change (wave3 H1 pathMustNotContain) is called out in the header, in Task 5's Files, and in the commit message. Codegen drift is impossible to commit silently (byte-identity test runs in every regression). `require(ESM)` for the generated module uses the wave4-proven path on the same Node version. No new npm deps, no config flags, no PM2 interaction, no `apps/dashboard` changes.

**Verification limits:** no PM2, no live browser — runtime validation (ToolCards rendering identical icons/colors after the switch) is delegated to the owner after he restarts. The bootstrap's quote style (JSON double quotes) in the checked-in registry is a cosmetic deviation from the repo's single-quote norm — accepted, since no formatter is configured and the file is generated-then-maintained. Behavior changes to flag in the handoff: (1) writeFile with literal `..`/`~` in the path no longer fails schema validation — the soul realpath guard was already the real authority (PT-BR error messages unchanged); (2) external file modification between a read and a write via the `filePath`/`file` aliases now throws `FILE_DRIFT` where it previously sailed through — a legitimate Luna flow that relied on the bypass (none known; the master prompt trains `path`) would now see the drift error; (3) `replaceInFile` with `oldStr`/`newStr` now passes validation and actually executes where it previously died in the guard.
