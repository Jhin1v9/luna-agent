# Wave 3 — Guard/Tools Security & Correctness Implementation Plan

> **For agentic workers:** Execute fixes A → I sequentially, in this order (safest/most independent first; H is the risky one and goes last). A, B touch disjoint `luna-tools.cjs` regions; C and H both touch `luna-tool-guard.cjs` so C MUST land first. Each fix: implement → spec review → quality review → commit.

**Goal:** Fix the nine guard/tools bugs registered in `packages/kernel/.brain/bugs.md` (Tools/Guard section): readFile memory/binary, writeFile non-atomic, IdempotencyStore retry-lockout, timeouts that don't kill, command injection, path traversal, SSRF, guard schema registry desync (the big one), plus a quick-wins batch.

**Architecture:** Surgical fixes + additive PURE helpers extracted into `packages/kernel/lib/` (precedents: `lib/stream-text-cursor.cjs`, `lib/stream-completion-guard.cjs`, `apps/dashboard/lib/chat-event-dedup.cjs`), pinned with `node --test`. Security policy is pragmatic for a single-user local agent: no regex blacklists for injection — shell-quoting helper + numeric clamps + arg validation; SSRF is default-deny for private/loopback/metadata hosts with an env-var allowlist, because internal services (dashboard, self-update) do NOT go through `fetchURL` (verified below). NEVER touch PM2 processes — verification is `node --test` only; runtime smoke is left to the owner.

**Tech Stack:** Node 22 (.cjs), native `node --test`, no new npm deps.

**Source of truth for root causes:** `packages/kernel/.brain/bugs.md` (all file:line re-verified against code on 2026-07-12 — citations below are the corrected current line numbers).

**Line-number verification notes (drift corrections):**
- Path traversal: cited `luna-soul.cjs:4122-4129` → actual `:4171-4180` (check only `params.path`; `/tmp` hatch tested on the RAW path at `:4177`, so `/tmp/../../etc/...` bypasses; aliases `filePath`/`source`/`from`/`to`/`dirPath` never checked).
- Soul auto-fix second write: cited `:4333-4341` → actual `:4384-4392` (`fs.writeFileSync` at `:4387`).
- `runBuildCheck` call site: cited `:4378-4388` → actual `:4428-4439`; the 180s timeout itself is `luna-code-validator.cjs:338`.
- Guard instantiation: cited `:1687-1693` → actual `_ensureToolGuard()` at `:1701-1708`, hardcoding `workspaceManager.getWorkspace('luna-cli')`. The `'luna-cli'` workspace is only ever created by `ensureWorkspace(currentUserId, …)` at `:3762` when the session user IS `luna-cli` (`luna-cli.cjs:377,607`) → guard is null for every web/Telegram user.
- Guard execute call site: `luna-soul.cjs:4361-4365` inside `_handleAction` (`:4077`); the throw from `validateToolCall` is caught at `:4545-4547` → tool "fails" with a schema error.
- Skipped-result downstream: cited `:4552` — correct; additionally `:4594`, `:4603`, `:4613` all read `result.success`, which the `{skipped:true}` result (`luna-tool-guard.cjs:428`) lacks.
- `TOOL_SCHEMAS` (`luna-tool-guard.cjs:142-198`) has **12** entries; `docs/luna-tools-registry.json` registers **123** tools. `validateToolCall` throws for the other 111 at `:202-204`.
- Remaining citations (`luna-tools.cjs:123, 143-173, 187-189, 559-592, 748-762, 778, 1075-1077, 1114, 1165-1190, 1355, 1380-1396`; `luna-tool-guard.cjs:116-139, 282-292, 456`; `luna-code-validator.cjs:552-555`) verified correct as cited.
- **New finding:** `searchWeb` (`luna-tools.cjs:643-644`) also follows redirects into `fetchURL` — included in the SSRF fix.
- **Usage evidence for the SSRF policy:** internal services are reached via dedicated code with hardcoded URLs — `dashboardApi` (`:1375-1396`, default `https://vps.nexo-digital.app:3501/api`), self-update (`:1285-1297`, `http://localhost:3458`), telegram adapter (`telegram-luna-adapters.cjs:121`, `http://localhost:3456`). `fetchURL`/`downloadFile`/`browser` receive URLs only from the LLM; the master prompt (`LUNA_MASTER_PROMPT.md:105,174`) shows external URLs only. Local preview screenshots use `execSync`/playwright directly (`luna-soul.cjs:1454-1482`), not the `browser` tool. → Blocking private ranges in the three network tools breaks nothing internal.

---

## Fix A — readFile: binary detection + byte cap (`luna-tools.cjs:143-173`)

**Files:**
- New: `packages/kernel/lib/text-file.cjs` (pure, additive)
- Modify: `packages/kernel/luna-tools.cjs` (`:143-173`)
- Test: `packages/kernel/tests/wave3-guard-tools.test.cjs`

- [ ] **A1. Pure binary detector (`packages/kernel/lib/text-file.cjs`)**

`readFile` does `fs.readFileSync(resolved, 'utf8')` on the WHOLE file before any limit — a 2GB log or a binary blob goes straight into memory and then into the prompt. Extract:

```js
'use strict';
// Heuristic binary detection: NUL byte, or >30% non-text bytes in the sample.
function looksBinary(buf) {
  if (!buf || buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  let nonText = 0;
  for (const b of sample) {
    if (b === 0) return true;
    // allow printable ASCII + common whitespace + UTF-8 continuation bytes
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) nonText++;
  }
  return nonText / sample.length > 0.30;
}
module.exports = { looksBinary };
```

- [ ] **A2. Cap + detect in `readFile` (`luna-tools.cjs:143-173`)**

1. After `fs.existsSync`, `statSync` the file; if `size > (opts.maxBytes || 2 * 1024 * 1024)`, read only the first `maxBytes` via `fs.openSync`/`fs.readSync` into a Buffer (do NOT read the whole file) and set `truncatedBytes: true` in the result with a note telling Kimi to page with `line_offset`.
2. Run `looksBinary` on the read buffer (or a first 8KB read for big files); if binary → `return err(\`Arquivo binário (${size} bytes): ${filePath}. Use readMediaFile para imagens/vídeo.\`)` — do not attempt utf8 decode.
3. Keep the existing offset/limit/negative-offset logic and the numbered output format EXACTLY as-is for the text path.

**What NOT to touch:** `readMediaFile`, the line-numbering format (`padStart(4)` + ` │ `), the negative-offset semantics.

- [ ] **A3. Test + commit**

Unit-test `looksBinary` directly: text → false; buffer with NUL → true; >30% control chars → true; empty → false. Integration-test `readFile` with `fs.mkdtempSync(os.tmpdir())` fixtures: a 3MB text file → `truncatedBytes: true`, no full read (assert result content length < file size); a PNG header fixture → `success:false` + mentions `readMediaFile`; a normal small file → unchanged numbered output. These FAIL on pre-fix code (pre-fix reads everything, decodes binary). Run: `node --test packages/kernel/tests/wave3-guard-tools.test.cjs`.

```bash
git add packages/kernel/lib/text-file.cjs packages/kernel/luna-tools.cjs packages/kernel/tests/wave3-guard-tools.test.cjs
git commit -m "fix(tools): readFile binary detection and 2MB byte cap - stop loading whole files into memory"
```

---

## Fix B — writeFile atomic (tmp + rename); same for replaceInFile and soul auto-fix

**Files:**
- New: `packages/kernel/lib/atomic-write.cjs` (additive; fs-bound but testable with tmp dirs)
- Modify: `packages/kernel/luna-tools.cjs` (`:175-201` writeFile, `:259` replaceInFile's write)
- Modify: `packages/kernel/luna-soul.cjs` (`:4387` auto-fix rewrite)
- Test: `packages/kernel/tests/wave3-guard-tools.test.cjs`

- [ ] **B1. Atomic write helper (`packages/kernel/lib/atomic-write.cjs`)**

```js
'use strict';
const fs = require('fs');
const path = require('path');
// Write to a sibling temp file then rename — rename(2) is atomic on POSIX
// within the same directory, so readers never see a half-written file.
function atomicWriteFileSync(filePath, content) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.luna-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}
module.exports = { atomicWriteFileSync };
```

- [ ] **B2. Use it at all three direct-write sites**

1. `writeFile` (`luna-tools.cjs:187` base64 branch and `:189` utf8 branch): replace both `fs.writeFileSync(resolved, …)` with `atomicWriteFileSync(resolved, finalContent)` — hoist `finalContent` computation before the write, one call site. Keep the `mkdirSync`/`createdDir` logic and the `ok({...})` result shape unchanged.
2. `replaceInFile` (`:259`): replace `fs.writeFileSync(resolved, content, 'utf8')` with `atomicWriteFileSync(resolved, content)`. Do NOT change the missing-file fallback at `:239-245` — that is Fix I.
3. Soul auto-fix (`luna-soul.cjs:4387`): replace `fs.writeFileSync(writtenPath, autoFixResult.fixed, 'utf8')` with `atomicWriteFileSync(writtenPath, autoFixResult.fixed)` and add the `require` at the top of `luna-soul.cjs` next to the other lib requires.

**What NOT to touch:** `appendFile` (append semantics — left direct by design, noted in Out of scope), the base64 decoding, the auto-fix detection logic (`autoFix()` itself), validation flow after the write.

- [ ] **B3. Test + commit**

Integration test in a tmp dir: `atomicWriteFileSync` creates the file with exact content, leaves NO `.luna-tmp-*` files behind, and overwrites an existing file atomically (content fully replaced). Throw-path test: write to a nonexistent dir → error thrown, no tmp leftover. Content-assertion test: `luna-tools.cjs` no longer contains `fs.writeFileSync(resolved, finalContent)` / the soul no longer contains `fs.writeFileSync(writtenPath` — wave1 A2 style. Run: `node --test packages/kernel/tests/wave3-guard-tools.test.cjs`.

```bash
git add packages/kernel/lib/atomic-write.cjs packages/kernel/luna-tools.cjs packages/kernel/luna-soul.cjs packages/kernel/tests/wave3-guard-tools.test.cjs
git commit -m "fix(tools): atomic writeFile via tmp+rename - no half-written files on crash; soul auto-fix too"
```

---

## Fix C — IdempotencyStore: TTL + mark-on-success + skipped result shape (`luna-tool-guard.cjs`)

**Files:**
- Modify: `packages/kernel/luna-tool-guard.cjs` (`:115-139`, `:425-429`, `:456`)
- Test: `packages/kernel/tests/wave3-guard-tools.test.cjs`

- [ ] **C1. TTL on the store (`:115-139`)**

Replace the `Set` with a `Map<key, timestamp>` and add `IDEMPOTENCY_TTL_MS = 10 * 60 * 1000`. `isProcessed(key)` deletes and returns false for expired entries; `markProcessed(key)` stores `Date.now()` (accept an injectable `nowFn` in the constructor for tests — `constructor(nowFn = Date.now)`). Keep `generateKey` and `clear` unchanged.

- [ ] **C2. Mark processed only on success (`:447-456`)**

Today `markProcessed` runs after `withRetry` returns — a FAILED writeFile (returns `{success:false}`, doesn't throw) is marked processed and can never be retried: the retry is silently "skipped". Fix: only mark when the result indicates success:
```js
if (result && result.success !== false) {
  this.idempotency.markProcessed(idemKey);
}
```
(Results are tool result objects with `success`; thrown errors never reach this line — unchanged behavior for throwers.)

- [ ] **C3. Skipped result must carry `success: true` (`:426-429`)**

The skip result `{skipped:true, reason:'already processed'}` lacks `success`; downstream the soul treats it as failure at `luna-soul.cjs:4552` (auto-commit gate), `:4594` (stored `success`), `:4603` (error progress event), `:4613` (no continue → turn stalls). A legitimate idempotent skip is a no-op SUCCESS — the desired end state (file written, commit made) already holds. Change the return to:
```js
return { success: true, skipped: true, reason: 'already processed', idempotencyKey: idemKey, message: 'Operação idêntica já executada recentemente (idempotência).' };
```

**What NOT to touch:** `CircuitBreaker`, `withRetry`, the checksum flow, `StepCheckpoint`.

- [ ] **C4. Test + commit**

Unit-test `IdempotencyStore` with an injected clock: mark → processed; advance < TTL → still processed; advance ≥ TTL → not processed (expired). Test `ToolGuard.execute` via `ToolGuard.prototype.execute.call(new ToolGuard(process.cwd()), …)` — actually just construct `new ToolGuard(process.cwd())` and call `.execute` with a stub `toolFn`: (a) toolFn returning `{success:false}` twice → executed BOTH times (no skip); (b) toolFn returning `{success:true}` twice → second call returns `skipped:true` AND `success:true`. Both fail pre-fix. Run: `node --test packages/kernel/tests/wave3-guard-tools.test.cjs`.

```bash
git add packages/kernel/luna-tool-guard.cjs packages/kernel/tests/wave3-guard-tools.test.cjs
git commit -m "fix(guard): idempotency TTL + mark only on success + success:true on skip - failed tools can retry"
```

---

## Fix D — Timeouts: safeExec default + dashboardApi abort (`luna-tools.cjs`)

**Files:**
- New: pure helper `clampExecTimeout` added to `packages/kernel/lib/text-file.cjs`? NO — add to a new `packages/kernel/lib/exec-timeout.cjs` (pure, additive)
- Modify: `packages/kernel/luna-tools.cjs` (`:118-137` safeExec, `:1380-1396` dashboardApi)
- Test: `packages/kernel/tests/wave3-guard-tools.test.cjs`

- [ ] **D1. Pure clamp (`packages/kernel/lib/exec-timeout.cjs`)**

```js
'use strict';
// Seconds-or-ms tolerant clamp: null/0/negative/garbage → defaultSec; capped at maxSec.
function clampExecTimeout(value, defaultSec = 60, maxSec = 600) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultSec * 1000;
  return Math.min(n * 1000, maxSec * 1000);
}
module.exports = { clampExecTimeout };
```
(All `safeExec` callers pass seconds — e.g. `:1057` 15, `:1080` `(opts.timeout||300)*1000`… NOTE: `:1080` passes ms already; verify each caller and normalize to seconds at the safeExec boundary: `timeout: clampExecTimeout(opts.timeout)` and adjust the two ms-passing callers `:1080` and `:563/:594` (`opts.timeout || 0` → default 60s cap 600s) to pass seconds. List every `safeExec(` caller in the diff review and confirm units.)

- [ ] **D2. safeExec default (`:123`)**

Replace `timeout: opts.timeout || 0, // v8.5-fix: no default timeout` with `timeout: clampExecTimeout(opts.timeout),` (default 60s, max 600s). A hung `rg`/`git`/`npx` no longer blocks the tool path forever.

- [ ] **D3. dashboardApi fetch timeout (`:1386`)**

Node 22 supports `AbortSignal.timeout`. Change the fetch to:
```js
const res = await fetch(`${DASHBOARD_BASE}${path}`, { ...opts, signal: AbortSignal.timeout(15000) });
```
The existing `catch` at `:1393` already converts failures to `err(...)` — an abort surfaces as a clean tool error instead of a hung turn.

**What NOT to touch:** `executeShell`'s own timeout logic (`:919-934` — already kills its child; guard alignment is Fix H), `runTests`, `checkSyntax`'s explicit 15s.

- [ ] **D4. Test + commit**

Unit-test `clampExecTimeout`: `undefined/0/-5/'abc'` → 60000; `5` → 5000; `99999` → 600000. Content-assertion: `safeExec` no longer contains `timeout: opts.timeout || 0` and `dashboardApi` contains `AbortSignal.timeout(15000)`. Run: `node --test packages/kernel/tests/wave3-guard-tools.test.cjs`.

```bash
git add packages/kernel/lib/exec-timeout.cjs packages/kernel/luna-tools.cjs packages/kernel/tests/wave3-guard-tools.test.cjs
git commit -m "fix(tools): safeExec default 60s/600s cap + dashboardApi 15s abort - no more unlimited hangs"
```

---

## Fix E — Command injection: shell-quote helper + clamps (`luna-tools.cjs`, `luna-code-validator.cjs`)

**Files:**
- New: `packages/kernel/lib/shell-quote.cjs` (pure, additive)
- Modify: `packages/kernel/luna-tools.cjs` (`:776-783` executeShellVisible script, `:559/:561` searchFiles context, `:587-592` grep context/glob, `:1073-1077` installPackages, `:1113-1114` gitLog n, `:1354-1355` openDebugTerminal)
- Modify: `packages/kernel/luna-code-validator.cjs` (`:552-555` tsconfig path)
- Test: `packages/kernel/tests/wave3-guard-tools.test.cjs`

- [ ] **E1. Pure helpers (`packages/kernel/lib/shell-quote.cjs`)**

```js
'use strict';
// POSIX single-quote escaping: safe for embedding ANY string in a shell command.
function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}
// Integer-or-default: context lines, log counts. Rejects 2;rm -rf / → default.
function toNonNegInt(value, def, max = 10000) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return def;
  return Math.min(n, max);
}
// Package/process names: npm/pip/cargo identifiers and pm2 process names only.
const SAFE_NAME_RE = /^[a-zA-Z0-9@._/-]+$/;
function assertSafeName(value, what = 'name') {
  const s = String(value ?? '');
  if (!s || s.length > 200 || !SAFE_NAME_RE.test(s) || s.includes('..')) {
    throw new Error(`${what} inválido (caracteres proibidos): ${JSON.stringify(s).slice(0, 60)}`);
  }
  return s;
}
module.exports = { shellQuote, toNonNegInt, assertSafeName, SAFE_NAME_RE };
```

- [ ] **E2. Apply at every injection site**

1. `executeShellVisible` (`:776-783`): replace `cd "${cwd}"` with `cd ${shellQuote(cwd)}` — a cwd containing `"`, `$`, or backticks currently breaks out of the double quotes.
2. `searchFiles` (`:559`/`:561`) and `grep` (`:590`/`:592`): replace `-C ${opts.context || opts['-C'] || 2}` with `-C ${toNonNegInt(opts['-C'] ?? opts.context, 2, 100)}` (numeric only — `context: "2;curl evil"` becomes 2).
3. `installPackages` (`:1073-1077`): build the list as `(Array.isArray(packages) ? packages : [packages]).map(p => assertSafeName(p, 'pacote')).join(' ')` — runs inside the existing try; an unsafe name returns a clean `err(e.message)`.
4. `gitLog` (`:1113-1114`): `const n = toNonNegInt(opts.n ?? opts.limit, 10, 1000);` then `git log --oneline -${n}`.
5. `openDebugTerminal` (`:1324`, `:1354-1355`): validate `targetProcess` and `lines` at the top: `const target = assertSafeName(targetProcess, 'processo pm2'); const nLines = toNonNegInt(lines, 50, 5000);` and use `target`/`nLines` in the command string (pm2 names and the `--lines` value are LLM-controllable params).
6. `typeScriptValidate` (`luna-code-validator.cjs:552` and `:555`): `-p ${shellQuote(tsconfigDir)}` and `… ${shellQuote(filePath)}` — paths come from Luna's own writeFile path param, fully LLM-controllable (`x;touch /tmp/pwned` is a valid filename).

**What NOT to touch:** the `JSON.stringify(...)`-quoted pattern/cwd args in searchFiles/grep (already safe), `gitCommit`'s message quoting (`:1126`, already `JSON.stringify`), the command strings' overall shape, `checkSyntax`'s quoted paths.

- [ ] **E3. Test + commit**

Unit-test all three pure helpers: `shellQuote('a"b$c`d`')` round-trips through `bash -c 'printf %s ' + shellQuote(x)` (spawn bash in the test and compare stdout — proves no injection); `toNonNegInt('2;rm -rf /', 2)` → 2, `toNonNegInt(5,2)` → 5; `assertSafeName('left-pad')` ok, `assertSafeName('x;y')` throws, `assertSafeName('a/b@c')` ok. Integration: `installPackages(['lodash;touch /tmp/x'])` → `success:false`, no file created; `gitLog({n:'5;id'})` → runs plain `git log -10` in a tmp repo (init with 1 commit). Run: `node --test packages/kernel/tests/wave3-guard-tools.test.cjs`.

```bash
git add packages/kernel/lib/shell-quote.cjs packages/kernel/luna-tools.cjs packages/kernel/luna-code-validator.cjs packages/kernel/tests/wave3-guard-tools.test.cjs
git commit -m "fix(tools): shell-quote cwd/paths, clamp numeric params, whitelist package/process names - close injection holes"
```

---

## Fix F — Path traversal: alias-aware, realpath-resolved, tmp allowlist (`luna-soul.cjs`)

**Files:**
- New: `packages/kernel/lib/path-guard.cjs` (fs-bound, testable with tmp dirs)
- Modify: `packages/kernel/luna-soul.cjs` (`:4171-4180`)
- Test: `packages/kernel/tests/wave3-guard-tools.test.cjs`

- [ ] **F1. Safe-path resolver (`packages/kernel/lib/path-guard.cjs`)**

```js
'use strict';
const fs = require('fs');
const path = require('path');

// realpath of the nearest existing ancestor + re-join the non-existing tail.
function realpathLoose(p) {
  const resolved = path.resolve(p);
  if (fs.existsSync(resolved)) return fs.realpathSync(resolved);
  const parent = path.dirname(resolved);
  if (parent === resolved) return resolved;
  return path.join(realpathLoose(parent), path.basename(resolved));
}

function isInside(child, root) {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Returns { ok: true, resolved } or { ok: false, reason }.
// allowedRoots: pre-realpathed absolute dirs (workspace, LUNA_TMP_DIR, os.tmpdir()).
function checkPathWithinRoots(rawPath, allowedRoots) {
  if (!rawPath || typeof rawPath !== 'string') return { ok: false, reason: 'path vazio' };
  const expanded = rawPath.startsWith('~/') ? path.join(require('os').homedir(), rawPath.slice(2)) : rawPath;
  const real = realpathLoose(expanded);
  for (const root of allowedRoots) {
    if (isInside(real, root)) return { ok: true, resolved: real };
  }
  return { ok: false, reason: `"${rawPath}" (real: ${real}) está fora dos diretórios permitidos`, resolved: real };
}

// All param keys that carry a filesystem path across the 123-tool surface.
const PATH_PARAM_KEYS = ['path', 'filePath', 'file', 'source', 'from', 'destination', 'to', 'dirPath'];

module.exports = { realpathLoose, isInside, checkPathWithinRoots, PATH_PARAM_KEYS };
```

This kills all three holes: aliases (caller checks every key), `/tmp/../../etc` (decision on the RESOLVED path, not the raw string), symlink escape (`realpathLoose` follows links — a symlink inside the workspace pointing to `/etc` resolves outside and is rejected).

- [ ] **F2. Replace the soul check (`luna-soul.cjs:4171-4180`)**

```js
// ── Path Traversal Protection (wave3: aliases + realpath + tmp allowlist) ──
const ws = workspaceManager.getWorkspace('luna-cli');
{
  const allowedRoots = [];
  for (const root of [ws?.path, lunaConfig.PATHS.tmp, require('os').tmpdir()]) {
    if (root) { try { allowedRoots.push(fs.realpathSync(root)); } catch {} }
  }
  for (const key of PATH_PARAM_KEYS) {
    if (!params[key]) continue;
    const check = checkPathWithinRoots(params[key], allowedRoots);
    if (!check.ok) {
      result = { success: false, error: `Path traversal bloqueado (${key}): ${check.reason}.` };
      break;
    }
  }
}
```
Notes: `lunaConfig` is already imported in the soul (verify; it is used at `:307`). The old raw-string `/tmp` hatch (`params.path.startsWith('/tmp')`) is DELETED — `os.tmpdir()` realpathed covers `/tmp` legitimately and nothing else. Non-existent targets (new writeFile paths) are handled by `realpathLoose` walking to the nearest existing ancestor.

**What NOT to touch:** the plan-mode filter above it (`:4083-4125`), the truncation guard below (`:4188-4232`), `resolvePath` in luna-tools (tools themselves still resolve as before — the guard is the gate).

- [ ] **F3. Test + commit**

Tmp-dir fixtures: workspace dir + symlink inside it → `/etc` (skip if symlink creation fails): `checkPathWithinRoots` rejects the symlink, accepts a real file, accepts a not-yet-existing file inside the workspace, accepts a path under `os.tmpdir()`, rejects `/tmp/../../etc/passwd`, rejects `/etc/hosts`. `realpathLoose` unit: nonexistent tail under existing dir resolves through. Content-assertion: soul no longer contains `params.path.startsWith('/tmp')` and does contain `PATH_PARAM_KEYS`. Run: `node --test packages/kernel/tests/wave3-guard-tools.test.cjs`.

```bash
git add packages/kernel/lib/path-guard.cjs packages/kernel/luna-soul.cjs packages/kernel/tests/wave3-guard-tools.test.cjs
git commit -m "fix(soul): path traversal guard checks all path aliases, resolves symlinks, replaces raw /tmp hatch with realpath allowlist"
```

---

## Fix G — SSRF: host validation + redirect/size/timeout caps (`luna-tools.cjs`)

**Files:**
- New: `packages/kernel/lib/url-safety.cjs` (pure, additive)
- Modify: `packages/kernel/luna-tools.cjs` (`:748-762` fetchURL, `:1165-1190` downloadFile, `:713-746` browser, `:643-644` searchWeb redirect)
- Test: `packages/kernel/tests/wave3-guard-tools.test.cjs`

**Policy (decided, see header evidence):** the three LLM-facing network tools default-DENY private/loopback/link-local/metadata/CGNAT destinations; the owner can punch holes with `LUNA_FETCH_ALLOW_HOSTS=host1,host2:port`. Internal dashboard/self-update/telegram traffic does NOT use these tools (hardcoded URLs in dedicated code), so nothing internal breaks.

- [ ] **G1. Pure host checker (`packages/kernel/lib/url-safety.cjs`)**

```js
'use strict';
const BLOCKED_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);

function isPrivateIPv4(parts) { // parts: [a,b,c,d] numbers
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
         (a === 192 && b === 168) || (a === 169 && b === 254) ||
         (a === 100 && b >= 64 && b <= 127) || a === 0 || a >= 224;
}

// Normalizes IPv4 literals incl. integer (2130706433), octal (0177.0.0.1),
// hex (0x7f000001) and short (127.1) forms to dotted parts, or null.
function parseIPv4(host) {
  const m = host.match(/^(\d+|0x[0-9a-f]+)(\.(\d+|0x[0-9a-f]+)){0,3}$/i);
  if (!m) return null;
  const parts = host.split('.').map(p => parseInt(p, p.startsWith('0x') ? 16 : (/^0\d/.test(p) ? 8 : 10)));
  if (parts.some(isNaN)) return null;
  let a, b, c, d;
  if (parts.length === 4) [a, b, c, d] = parts;
  else if (parts.length === 3) { [a, b] = parts; c = parts[2] >> 8; d = parts[2] & 255; }
  else if (parts.length === 2) { a = parts[0]; b = parts[1] >> 16; c = (parts[1] >> 8) & 255; d = parts[1] & 255; }
  else { a = parts[0] >> 24; b = (parts[0] >> 16) & 255; c = (parts[0] >> 8) & 255; d = parts[0] & 255; }
  if ([a, b, c, d].some(n => n > 255)) return null;
  return [a, b, c, d];
}

// Returns { ok: true } or { ok: false, reason }. allowList: ['host', 'host:port'].
function checkUrlSafety(rawUrl, allowList = []) {
  let u;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: 'URL inválida' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: `protocolo bloqueado: ${u.protocol}` };
  const host = u.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (allowList.some(a => a === host || a === `${host}:${u.port}`)) return { ok: true };
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { ok: false, reason: `host local bloqueado: ${host}` };
  }
  const v4 = parseIPv4(host);
  if (v4) {
    if (isPrivateIPv4(v4)) return { ok: false, reason: `IP privado/loopback bloqueado: ${v4.join('.')}` };
    return { ok: true };
  }
  if (host.includes(':')) { // IPv6 literal
    if (host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('::ffff:')) {
      return { ok: false, reason: `IPv6 local/privado bloqueado: ${host}` };
    }
  }
  return { ok: true };
}

function fetchAllowList(env = process.env) {
  return (env.LUNA_FETCH_ALLOW_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
}

module.exports = { checkUrlSafety, parseIPv4, isPrivateIPv4, fetchAllowList };
```

Residual (documented in code comment): DNS-rebinding (public hostname resolving to a private IP) is NOT checked in Wave 3 — hostnames are validated literally. See Out of scope.

- [ ] **G2. fetchURL rewrite (`:748-762`)**

1. Validate before the request: `const safety = checkUrlSafety(url, fetchAllowList()); if (!safety.ok) return resolve(err(\`fetchURL bloqueado: ${safety.reason}\`));`
2. Redirects: replace the blind recursion with a `redirectCount` carried in opts (internal `_redirects` counter, max 5); resolve `Location` against the current URL (`new URL(res.headers.location, url).href` — today relative Locations produce a broken URL); RE-VALIDATE every redirect target through `checkUrlSafety` (an allowed host must not bounce to `169.254.169.254`).
3. Size cap: accumulate `data` but `req.destroy()` and resolve `err('Resposta excede 5MB')` once received bytes exceed `opts.maxBytes || 5 * 1024 * 1024` (today the whole body is buffered THEN sliced at `:757` — same bug class as readFile).
4. Timeout stays 15s default (already present at `:751`).

- [ ] **G3. downloadFile (`:1165-1190`)**

Same validation + redirect re-validation + max 5 redirects. Fix `timeout: opts.timeout || 0` (zero = NO timeout) → `opts.timeout || 15000`. Add a byte cap on the write stream: track piped bytes, abort + unlink when `> opts.maxBytes || 100 * 1024 * 1024`.

- [ ] **G4. browser (`:713-746`) + searchWeb redirect (`:643-644`)**

`browser`: validate `url` with `checkUrlSafety` before `page.goto` (and before the `fetchURL` fallback at `:744`, which then double-checks anyway). `searchWeb`: route its redirect through the new safe `fetchURL` (it already calls `fetchURL` at `:644` — validation comes for free; just make sure the max-redirect counter is threaded so a DDG bounce loop terminates).

**What NOT to touch:** the DDG HTML parsing, the browser content extraction/evaluate block, `DASHBOARD_BASE` / self-update / telegram fetches (not LLM-facing), `browserContext` reuse logic.

- [ ] **G5. Test + commit**

Unit-test `checkUrlSafety`: blocked → `127.0.0.1`, `2130706433`, `0177.0.0.1`, `0x7f000001`, `127.1`, `10.0.0.1`, `172.16.0.1`, `172.31.255.1`, `192.168.1.1`, `169.254.169.254`, `100.64.0.1`, `localhost`, `foo.localhost`, `db.internal`, `[::1]`, `[::ffff:127.0.0.1]`, `file:///etc/passwd`; allowed → `example.com`, `8.8.8.8`, `172.15.0.1` (boundary), `172.32.0.1`; allowlist → `127.0.0.1` with `['127.0.0.1']` allowed, `127.0.0.1:3456` with `['127.0.0.1:3456']` allowed but `127.0.0.1:9999` blocked. Integration: start a local `http.createServer` fixture that 302s to `http://127.0.0.1:<port>/secret` → `fetchURL('http://<allowed-public-mock>')`… simpler: call `fetchURL('http://127.0.0.1:<fixturePort>')` directly → `success:false` with "bloqueado"; a fixture serving >5MB → capped error. Run: `node --test packages/kernel/tests/wave3-guard-tools.test.cjs`.

```bash
git add packages/kernel/lib/url-safety.cjs packages/kernel/luna-tools.cjs packages/kernel/tests/wave3-guard-tools.test.cjs
git commit -m "fix(tools): SSRF guard for fetchURL/downloadFile/browser - block private hosts, validate redirects, cap size and timeout"
```

---

## Fix H — 🔴 Guard registry desync + workspace mismatch (THE RISKY ONE)

**Decision (recommended approach — ONE pragmatic Wave-3 fix, full schema coverage deferred to Wave 5):**

Evaluated and rejected: (a) writing schemas for all 123 tools now — that IS the Wave 5 "tools registry from single source" work, not a bug fix, and 111 hand-written schemas in one diff is unreviewable; (b) deleting the guard — it carries the timeout/circuit/idempotency/checksum value this wave hardens.

Recommended: **fail-open default schema + make the guard load for every session**. Unknown tools validate against a permissive default (no required fields, no type checks) with a one-time warning, so luna-cli sessions stop failing 111 tools on a registry technicality; `_ensureToolGuard` resolves the workspace from the SESSION user (fallback chain) so web/Telegram get validation+timeout+idempotency for the first time. The 12 strict schemas stay strict; full per-tool coverage lands with Wave 5's generated registry (`docs/luna-tools-registry.json` becomes the schema source).

**Risk flags:** after this fix, web/Telegram tool calls run through the guard for the first time — 30s timeout applies, circuit breaker applies (3 identical calls/60s), idempotency applies. Mitigations built into the tasks below: idempotency scoped to MUTATING tools only (read tools like dashboardList* must be freely repeatable), and the guard timeout is aligned with executeShell's own kill timer so timeouts actually kill.

**Files:**
- Modify: `packages/kernel/luna-tool-guard.cjs` (`:142-198` schemas, `:200-243` validateToolCall, `:415-464` execute, `:441-444` timeout)
- Modify: `packages/kernel/luna-soul.cjs` (`:1701-1708` _ensureToolGuard, `:4237` call site, `:4077-4081` session lookup)
- Test: `packages/kernel/tests/wave3-guard-tools.test.cjs`

- [ ] **H1. Fail-open default + alias-aware path constraints (`luna-tool-guard.cjs:200-243`)**

1. Replace the throw at `:202-204` with:
```js
let schema = TOOL_SCHEMAS[toolName];
if (!schema) {
  if (!validateToolCall._warned.has(toolName)) {
    validateToolCall._warned.add(toolName);
    console.warn(`[tool-guard] Sem schema estrito para "${toolName}" — validação permissiva (Wave 5 cobrirá todos os tools).`);
  }
  schema = DEFAULT_SCHEMA; // { required: [], types: {} }
}
```
(add `validateToolCall._warned = new Set();` and `const DEFAULT_SCHEMA = { required: [], types: {} };` above the function.)
2. Path constraints must check the resolved alias, not only `params.path`: compute `const pathValue = params.path || params.filePath || params.source || params.from;` once and use it in `pathMustBeAbsolute` (`:221`) and `pathMustNotContain` (`:225-231`) — today `writeFile` with `filePath` (a soul-supported alias, `luna-soul.cjs:4244`) FAILS `required:['path']`. ALSO make the required-field check alias-aware for `path`: if the schema requires `path`, accept any of `path|filePath|file` being present (normalize into `params.path` copy for the rest of validation).
3. Keep `forbiddenPatterns` and the 12 strict schemas unchanged.

- [ ] **H2. Guard always loads (`luna-soul.cjs:1701-1708`, `:4077-4081`, `:4237`)**

1. Change the signature to `_ensureToolGuard(userId)` with fallback chain:
```js
_ensureToolGuard(userId) {
  const ws = (userId && workspaceManager.getWorkspace(userId))
    || workspaceManager.getWorkspace('luna-cli')
    || { path: lunaConfig.PATHS.workspaceBase };
  if (this.toolGuard && this.toolGuard.workspacePath === ws.path) return this.toolGuard;
  this.toolGuard = new ToolGuard(ws.path);
  return this.toolGuard;
}
```
2. At the top of `_handleAction` (`:4077-4081`), resolve the user: `const session = this.sessionManager.loadSession(sessionId); const actionUserId = session?.userId || 'luna-cli';` (`loadSession` exists — used at `:2179`).
3. Update the call site `:4237` to `const guard = this._ensureToolGuard(actionUserId);` — guard is now never null; the `if (guard) … else toolFn()` branches at `:4361-4365`, `:4497-4501`, `:4512-4516`, `:4526-4530`, `:4537-4541` keep working with the guard always present (leave the else branches — zero-risk dead code).

**What NOT to touch:** `_ensureGit` (`:1669-1681`) — same 'luna-cli' hardcoding, but auto-commit staying CLI-scoped is acceptable for Wave 3 (tracked in Out of scope).

- [ ] **H3. Idempotency scoped to mutating tools (`luna-tool-guard.cjs:425-429`)**

Before the skip check, gate on a mutating-tools predicate so read tools are never deduped:
```js
const MUTATING_TOOL_RE = /^(writeFile|appendFile|replaceInFile|deleteFile|moveFile|copyFile|gitCommit|applyPatch|installPackages|clipboardWrite|executeScript|executeShell|dashboard(Create|Update|Delete|Complete|Pay|Receive|Add|Send|Vote|Control|Enrich|Sync|Mark|Quick|Adjust|Reconcile))/;
const isMutating = MUTATING_TOOL_RE.test(toolName);
if (isMutating && this.idempotency.isProcessed(idemKey) && options.idempotent !== false) { …skip… }
```
and wrap the `markProcessed` from Fix C in `if (isMutating && …)`. Rationale: with the guard now active on web sessions, `dashboardListTasks` twice in 10min would otherwise return a stale skip.

- [ ] **H4. Guard timeout actually kills executeShell (`:441-450`)**

The guard's `withTimeout` (`:282-292`) is a bare `Promise.race` — the rejected promise leaves the spawned child running (zombie up to executeShell's own default). executeShell ALREADY kills its child on timeout (`luna-tools.cjs:929-934`) when `timeoutMs > 0`, driven by `opts.timeout` seconds. So align them: inside `execute`, before building the retry wrapper, when `toolName === 'executeShell'` clamp the params the toolFn closes over:
```js
if (toolName === 'executeShell') {
  const budgetSec = Math.floor(timeoutMs / 1000);
  params.timeout = Math.min(Number(params.timeout) || budgetSec, budgetSec);
}
```
(`guard.execute(tool, p, toolFn)` receives the same object reference `p` the lambda closes over — verified at `luna-soul.cjs:4239-4262`.) Also fix `withTimeout` to clear its timer on settle (the current `promise.finally(...)` at `:288` creates an unhandled rejection path when the timeout wins — wrap: `promise.then(() => clearTimeout(timer), () => clearTimeout(timer))`). Leave the generic `withTimeout(promise, ms, label)` signature unchanged; document in a comment that only shell tools get a real kill — other toolFns are cooperative.

- [ ] **H5. Test + commit**

Unit tests (construct `new ToolGuard(tmpdir)` directly, stub toolFns):
- `validateToolCall('dashboardListTasks', {})` → `true` (no throw), warning emitted once (spy console.warn, second call silent). FAILS pre-fix (throws).
- `validateToolCall('writeFile', {filePath:'/abs/x', content:'c'})` → `true` (alias satisfies required+absolute). FAILS pre-fix.
- `validateToolCall('writeFile', {filePath:'rel/x', content:'c'})` → throws (alias still enforced).
- Idempotency scoping: execute `readFile` twice with identical params → BOTH run (toolFn call count 2); execute `writeFile` twice with identical params → second skipped. FAILS pre-fix for the read case.
- Timeout alignment: `guard.execute('executeShell', {command:'x', timeout:999}, ()=>({success:true}))` → params.timeout mutated to ≤30; with `timeout:5` → stays 5.
- Content-assertion: `_ensureToolGuard` no longer returns `null` on missing workspace (contains `lunaConfig.PATHS.workspaceBase` fallback); soul call site passes `actionUserId`.
Run: `node --test packages/kernel/tests/wave3-guard-tools.test.cjs`.

```bash
git add packages/kernel/luna-tool-guard.cjs packages/kernel/luna-soul.cjs packages/kernel/tests/wave3-guard-tools.test.cjs
git commit -m "fix(guard): fail-open default schema + per-session workspace guard - 111 tools unblocked, web sessions now validated"
```

---

## Fix I — Quick wins: replaceInFile fallback, executeScript semantics, runBuildCheck cap

**Files:**
- Modify: `packages/kernel/luna-tools.cjs` (`:239-245` replaceInFile, `:328-338` executeScript)
- Modify: `packages/kernel/luna-code-validator.cjs` (`:338` runBuildCheck timeout)
- Modify: `packages/kernel/.brain/bugs.md` (move Wave 3 items to Resolved)
- Test: `packages/kernel/tests/wave3-guard-tools.test.cjs`

- [ ] **I1. replaceInFile must not create the file (`luna-tools.cjs:239-245`)**

Silently creating an EMPTY file when the target is missing turns a typo'd path into a new empty file (and the subsequent replace is a no-op success). Replace the fallback with `return err(\`Arquivo não encontrado: ${filePath}. Use writeFile para criar novos arquivos.\`);`. `createdFile` flag and its `ok()` branch below become dead — remove both cleanly.

- [ ] **I2. executeScript single success semantics (`luna-tools.cjs:328-338`)**

`ok({...})` sets `success:true` then the spread overwrites it with `success: result.exitCode === 0` — a failed script returns `success:false` WITHOUT an `error` field, breaking the soul's error path (`result.error || ...` → undefined message). Restructure: on `result.exitCode !== 0` return `err(\`Script ${language} falhou (exit ${result.exitCode})\`, { language, stdout, stderr, exitCode })`; on zero return the existing `ok({...})` minus the redundant `success` key.

- [ ] **I3. runBuildCheck 180s → 60s (`luna-code-validator.cjs:338`)**

One writeFile can block the tool path for 180s, fighting the guard's 30s. Change `timeout: 180000` to `timeout: 60000` and hoist `const BUILD_TIMEOUT_MS = 60000;` next to the imports with a comment. (Screenshot/project validation in the soul stays as-is.)

- [ ] **I4. Update bugs.md + test + commit**

Move all Wave 3 items from Open→Resolved in `packages/kernel/.brain/bugs.md` (Tools/Guard section), following the Wave 1/2 Resolved entry style with commit hashes. Tests: `replaceInFile('/tmp/x/missing.txt', 'a', 'b')` → `success:false` mentioning writeFile, and no file created; `executeScript('exit 3', {language:'bash'})` → `success:false` WITH `error` string; content-assert `BUILD_TIMEOUT_MS = 60000`. Run: `node --test packages/kernel/tests/wave3-guard-tools.test.cjs`.

```bash
git add packages/kernel/luna-tools.cjs packages/kernel/luna-code-validator.cjs packages/kernel/.brain/bugs.md packages/kernel/tests/wave3-guard-tools.test.cjs
git commit -m "fix(tools): replaceInFile errors on missing file, executeScript consistent failure shape, build check capped at 60s"
```

---

## Out of scope (deferred — guard/tools items NOT in Wave 3)

- **Full schema coverage for the remaining ~111 tools** — this IS Wave 5 Phase 1 ("tools registry from single source", decisions.md 2026-07-11). Wave 3 ships the fail-open default + a TODO pointing at `docs/luna-tools-registry.json` as the future schema source.
- **Heuristic validator false positives** (`checkJsxBalanced` `luna-code-validator.cjs:19-115`, `checkFileTruncated` `:121-200`) — char-by-char JSX parser breaks on TS generics; brace counting ignores strings/comments. Fixing means swapping in a real parser (acorn/ts compiler API) — high regression risk on the writeFile hot path; defer to Wave 5 with the characterization net.
- **DNS-rebinding SSRF** (public hostname resolving to a private IP at connect time) — Wave 3 validates hostnames/IP literals only; a full fix needs a custom `lookup` that resolves-then-validates before connecting. Noted in `url-safety.cjs` comment.
- **`_ensureGit` workspace mismatch** (`luna-soul.cjs:1669-1681`) — same 'luna-cli' hardcoding as the guard; auto-commit staying CLI-scoped is acceptable short-term. Fix alongside the workspace-model cleanup.
- **`StepCheckpoint` shell interpolation** (`luna-tool-guard.cjs:353,378` — `cd "${this.workspacePath}"`) — workspacePath comes from config, not the LLM; quote it opportunistically if the file is already open in Fix H, otherwise leave.
- **appendFile non-atomic write** — append semantics don't compose with tmp+rename (rename would replace, not append); left direct by design.
- **Bridge-side tools-lost bugs** (`_extractJsonToolCalls` brace counting, extension nested-params regex, DeepSeek 5-cycle delivery) — registered under Bridge in bugs.md; Wave 2 leftovers / Wave 5 parser dedup.
- **Guard for desktop/computer/ipython paths** — these run through `guard.execute` with generic timeouts; no shell-kill alignment possible (no child handle). Cooperative-timeout only, documented in H4 comment.

---

## Self-Review

**Coverage:** Tools/Guard section of bugs.md = Fix H (🔴 registry desync), Fix F (🔴 traversal), Fix E (🔴 injection), Fix G (🔴 SSRF), Fix D + H4 (🟠 timeouts), Fix B (🟠 atomic writeFile), Fix A (🟠 readFile caps), Fix C (🟠 idempotency), Fix I (🟡 quick wins: replaceInFile, executeScript, runBuildCheck). Deferred with reasons: heuristic validators (🟡). ✅

**Ordering rationale:** A/B/C/D are mutually disjoint small surfaces (one function or one file region each) and pin the new lib/ helpers first. E reuses none of them but touches many `luna-tools.cjs` sites — landed before F/G so the injection surface is closed while traversal/SSRF are still being worked. F and G introduce the two policy helpers (path-guard, url-safety). H is last because it (1) edits `luna-tool-guard.cjs` already touched by C (idempotency) and must compose with it, (2) changes behavior for EVERY session type — highest blast radius — so it lands on top of a green test suite, and (3) its H3/H4 sub-tasks depend on C's mark-on-success semantics. I is a trivial disjoint tail that also carries the bugs.md bookkeeping.

**Guard-registry decision (the big one):** fail-open default schema (warn once per tool) + `_ensureToolGuard(userId)` with session→'luna-cli'→workspaceBase fallback. Chosen over full schema coverage (that's Wave 5's generated registry — 111 hand schemas is unreviewable) and over deleting the guard (it carries the timeout/idempotency/circuit value this wave hardens). Residual risks mitigated in-plan: idempotency scoped to mutating tools (H3) so web dashboard reads aren't deduped; strict schemas kept strict and made alias-aware (H1) so the 12 covered tools still bite.

**SSRF policy:** default-deny private/loopback/link-local/metadata/CGNAT (IPv4 incl. integer/octal/hex/short literals, IPv6 ::1/ULA/link-local/v4-mapped, `localhost`/`*.localhost`/`*.internal`), re-validated on every redirect (max 5, relative Location resolved), 5MB/100MB body caps, 15s timeouts, `LUNA_FETCH_ALLOW_HOSTS` escape hatch for the owner. Verified safe against internal traffic: dashboard (`dashboardApi`, `:1375`), self-update (`:1285-1297`), telegram (`telegram-luna-adapter.cjs:121`) all use hardcoded URLs outside these three tools; the master prompt shows external-only fetchURL examples. Residual: DNS rebinding — documented, deferred.

**Risk containment:** six new additive lib modules (`text-file`, `atomic-write`, `exec-timeout`, `shell-quote`, `path-guard`, `url-safety`), all pinned by `node --test`; no config flags, no new npm deps, no PM2 interaction. Every fix ships a regression test that fails on pre-fix code (pure-function tests for the helpers; tmp-dir integration for fs-bound ones; content-assertions where the change is structural).

**Verification limits:** no PM2, no live browser — runtime validation (real Kimi tool-call stream through the always-on guard, `LUNA_FETCH_ALLOW_HOSTS` in practice, symlink-escape attempt on the owner's box) is delegated to the owner after merge. One known behavior change to flag in the handoff: after Fix H, web/Telegram tool calls gain a 30s guard timeout and circuit breaker (3 identical calls/minute) for the first time — if the owner's workflows rely on long-running non-shell tools, the timeout constants (`luna-tool-guard.cjs:22-23`) are the single knob.
