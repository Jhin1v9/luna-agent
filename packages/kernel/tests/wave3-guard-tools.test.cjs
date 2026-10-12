// wave3-guard-tools.test.cjs — Wave 3 regression tests
// Fix A: readFile binary detection + 2MB byte cap (lib/text-file.cjs + luna-tools.cjs)
// Fix B: atomic writeFile via tmp+rename (lib/atomic-write.cjs + luna-tools.cjs + luna-soul.cjs)
// Fix C: IdempotencyStore TTL + mark-on-success + success:true on skip (luna-tool-guard.cjs)
// Fix D: safeExec default 60s/600s cap + dashboardApi 15s abort (lib/exec-timeout.cjs + luna-tools.cjs)
// Fix E: command injection — shell-quote + numeric clamps + name whitelist (lib/shell-quote.cjs + luna-tools.cjs + luna-code-validator.cjs)
// Fix F: path traversal — alias-aware, realpath-resolved, tmp allowlist (lib/path-guard.cjs + luna-soul.cjs)
// Fix G: SSRF guard for fetchURL/downloadFile/browser (lib/url-safety.cjs + luna-tools.cjs)
// Fix H: guard registry desync — fail-open default schema, alias-aware paths, per-session workspace guard,
//        mutating-only idempotency, executeShell timeout alignment (luna-tool-guard.cjs + luna-soul.cjs)
// Fix I: quick wins — replaceInFile errors on missing file, executeScript consistent failure shape,
//        runBuildCheck capped at 60s (luna-tools.cjs + luna-code-validator.cjs)
// Run: node --test packages/kernel/tests/wave3-guard-tools.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { looksBinary } = require('../lib/text-file.cjs');
const { atomicWriteFileSync } = require('../lib/atomic-write.cjs');
const { readFile, writeFile, replaceInFile, executeScript } = require('../luna-tools.cjs');
const { ToolGuard, IdempotencyStore, validateToolCall, IDEMPOTENCY_TTL_MS } = require('../luna-tool-guard.cjs');

// ── Fix A1: looksBinary (pure unit tests) ────────────────────────────────────

test('A1: looksBinary returns false for plain text', () => {
  assert.strictEqual(looksBinary(Buffer.from('hello world\nfoo\tbar\r\nlinha com acentuação é í\n')), false);
});

test('A1: looksBinary returns true when the buffer contains a NUL byte', () => {
  assert.strictEqual(looksBinary(Buffer.from([0x68, 0x69, 0x00, 0x6f, 0x6b])), true);
});

test('A1: looksBinary returns true when >30% of the sample is control chars', () => {
  const buf = Buffer.alloc(100, 0x61); // 'a'
  for (let i = 0; i < 40; i++) buf[i] = 0x01; // 40% control chars
  assert.strictEqual(looksBinary(buf), true);
});

test('A1: looksBinary returns false for an empty buffer', () => {
  assert.strictEqual(looksBinary(Buffer.alloc(0)), false);
  assert.strictEqual(looksBinary(null), false);
});

// ── Fix A2: readFile integration (tmp-dir fixtures) ──────────────────────────

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-wave3-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('A2 (v13.0): readFile returns the WHOLE file by default; opt-in maxBytes still caps', () => {
  // Owner directive 2026-08-13: Luna reads full files — no default byte cap.
  withTmpDir((dir) => {
    const file = path.join(dir, 'big.log');
    // ~3MB of text: 30000 lines × (100 chars + \n)
    const line = 'x'.repeat(100) + '\n';
    fs.writeFileSync(file, line.repeat(30000));
    const fileSize = fs.statSync(file).size;
    assert.ok(fileSize > 2 * 1024 * 1024, `fixture must exceed 2MB (got ${fileSize})`);

    const result = readFile(file);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.truncatedBytes, undefined, 'no default cap — nothing truncated');
    assert.strictEqual(result.totalLines, 30001, 'all lines read by default (30000 + trailing empty)');

    // Opt-in cap still works for callers that ask for it
    const capped = readFile(file, { maxBytes: 1024 * 1024 });
    assert.strictEqual(capped.truncatedBytes, true, 'explicit maxBytes must still cap');
  });
});

test('A2: readFile rejects a binary file and points to readMediaFile', () => {
  withTmpDir((dir) => {
    const file = path.join(dir, 'img.png');
    // PNG signature + IHDR chunk header (contains NUL bytes)
    fs.writeFileSync(file, Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10,
    ]));

    const result = readFile(file);
    assert.strictEqual(result.success, false, 'binary file must not be utf8-decoded');
    assert.ok(result.error.includes('readMediaFile'), `error must mention readMediaFile (got: ${result.error})`);
  });
});

test('A2: readFile on a small text file keeps the numbered output unchanged', () => {
  withTmpDir((dir) => {
    const file = path.join(dir, 'small.txt');
    fs.writeFileSync(file, 'hello\nworld\n', 'utf8');

    const result = readFile(file);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.truncatedBytes, undefined);
    assert.strictEqual(result.totalLines, 3);
    assert.strictEqual(result.linesRead, 3);
    assert.strictEqual(result.content, '   1 │ hello\n   2 │ world\n   3 │ ');
  });
});

// ── Fix B: atomic writes (tmp + rename) ──────────────────────────────────────

function tmpLeftovers(dir) {
  return fs.readdirSync(dir).filter((name) => name.startsWith('.luna-tmp-'));
}

test('B1: atomicWriteFileSync creates a file with exact content and no tmp leftover', () => {
  withTmpDir((dir) => {
    const file = path.join(dir, 'out.txt');
    atomicWriteFileSync(file, 'conteúdo com acentuação\nsegunda linha\n');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'conteúdo com acentuação\nsegunda linha\n');
    assert.deepStrictEqual(tmpLeftovers(dir), [], 'no .luna-tmp-* files may be left behind');
  });
});

test('B1: atomicWriteFileSync overwrites an existing file atomically (full replace)', () => {
  withTmpDir((dir) => {
    const file = path.join(dir, 'out.txt');
    fs.writeFileSync(file, 'old content that is longer than the new one\n', 'utf8');
    atomicWriteFileSync(file, 'new\n');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'new\n', 'content must be fully replaced, not partially overwritten');
    assert.deepStrictEqual(tmpLeftovers(dir), []);
  });
});

test('B1: atomicWriteFileSync writes Buffer content byte-exactly', () => {
  withTmpDir((dir) => {
    const file = path.join(dir, 'blob.bin');
    const buf = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x7f]);
    atomicWriteFileSync(file, buf);
    assert.deepStrictEqual(fs.readFileSync(file), buf);
    assert.deepStrictEqual(tmpLeftovers(dir), []);
  });
});

test('B1: atomicWriteFileSync throws on failure and cleans up the tmp file', () => {
  withTmpDir((dir) => {
    const missing = path.join(dir, 'no-such-dir', 'out.txt');
    assert.throws(() => atomicWriteFileSync(missing, 'x'), 'must throw when the target dir does not exist');
    assert.deepStrictEqual(tmpLeftovers(dir), [], 'tmp file must be unlinked on the error path');
    assert.strictEqual(fs.existsSync(path.join(dir, 'no-such-dir')), false, 'target dir must not be created');
  });
});

test('B1: atomicWriteFileSync leaves no partial file when rename fails (rename error injection)', () => {
  withTmpDir((dir) => {
    const file = path.join(dir, 'target.txt');
    fs.writeFileSync(file, 'original\n', 'utf8');
    const originalRename = fs.renameSync;
    fs.renameSync = () => { throw new Error('injected rename failure'); };
    try {
      assert.throws(() => atomicWriteFileSync(file, 'corrupted\n'), /injected rename failure/);
    } finally {
      fs.renameSync = originalRename;
    }
    // The crash must NOT have touched the destination — readers see the old
    // complete file, never a half-written one.
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'original\n');
    assert.deepStrictEqual(tmpLeftovers(dir), [], 'tmp file must be cleaned up after the rename failure');
  });
});

test('B2: writeFile tool writes atomically (exact content, no tmp leftover)', () => {
  withTmpDir((dir) => {
    const file = path.join(dir, 'tool-out.txt');
    const result = writeFile(file, 'via writeFile tool\n');
    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'via writeFile tool\n');
    assert.deepStrictEqual(tmpLeftovers(dir), []);
  });
});

test('B2: writeFile tool base64 branch writes exact bytes', () => {
  withTmpDir((dir) => {
    const file = path.join(dir, 'tool-blob.bin');
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
    const result = writeFile(file, buf.toString('base64'), { encoding: 'base64' });
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(fs.readFileSync(file), buf);
    assert.deepStrictEqual(tmpLeftovers(dir), []);
  });
});

test('B2: replaceInFile tool writes atomically (exact content, no tmp leftover)', () => {
  withTmpDir((dir) => {
    const file = path.join(dir, 'tool-edit.txt');
    fs.writeFileSync(file, 'foo bar baz\n', 'utf8');
    const result = replaceInFile(file, 'bar', 'qux');
    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'foo qux baz\n');
    assert.deepStrictEqual(tmpLeftovers(dir), []);
  });
});

test('B3: luna-tools.cjs no longer writes writeFile results directly', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-tools.cjs'), 'utf8');
  assert.ok(!src.includes('fs.writeFileSync(resolved, finalContent)'), 'writeFile must use atomicWriteFileSync');
  assert.ok(!src.includes("fs.writeFileSync(resolved, content, 'utf8')"), 'replaceInFile must use atomicWriteFileSync');
});

test('B3: luna-soul.cjs auto-fix rewrite is atomic', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-soul.cjs'), 'utf8');
  assert.ok(!src.includes('fs.writeFileSync(writtenPath'), 'soul auto-fix must not write directly');
  assert.ok(src.includes('atomicWriteFileSync(writtenPath'), 'soul auto-fix must use atomicWriteFileSync');
});

// B4: mode preservation — overwriting an executable file must keep its mode
// (tmp+rename replaces the inode; without chmod the mode would reset to
// 0o666 & ~umask and Luna's self-edited .sh files would lose +x).
test('B4: atomicWriteFileSync preserves the target file mode on overwrite', () => {
  if (process.platform === 'win32') return; // Windows has no Unix file modes
  const { atomicWriteFileSync } = require('../lib/atomic-write.cjs');
  withTmpDir(dir => {
    const target = path.join(dir, 'script.sh');
    fs.writeFileSync(target, '#!/bin/bash\necho old\n');
    fs.chmodSync(target, 0o755);

    atomicWriteFileSync(target, '#!/bin/bash\necho new\n');

    const mode = fs.statSync(target).mode & 0o777;
    assert.strictEqual(mode, 0o755, `mode must be preserved, got ${mode.toString(8)}`);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), '#!/bin/bash\necho new\n');
  });
});

test('B4b: atomicWriteFileSync on a new file uses default mode', () => {
  const { atomicWriteFileSync } = require('../lib/atomic-write.cjs');
  withTmpDir(dir => {
    const target = path.join(dir, 'fresh.txt');
    atomicWriteFileSync(target, 'hello');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'hello');
    // Default mode = 0o666 & ~umask — just assert it exists and is a file.
    assert.ok(fs.statSync(target).isFile());
  });
});

// ── Fix C: IdempotencyStore TTL + mark-on-success + skip result shape ────────

// v13.0 (F3.2): TTL vem do guard (60s p/ mutantes) — política única, sem cópia local.

test('C1: IdempotencyStore expires entries after the TTL (injected clock)', () => {
  let now = 1000;
  const store = new IdempotencyStore(() => now);
  const key = store.generateKey('writeFile', { path: '/tmp/x', content: 'y' });

  assert.strictEqual(store.isProcessed(key), false, 'unseen key must not be processed');
  store.markProcessed(key);
  assert.strictEqual(store.isProcessed(key), true, 'just-marked key must be processed');

  now += IDEMPOTENCY_TTL_MS - 1; // advance < TTL
  assert.strictEqual(store.isProcessed(key), true, 'key within TTL must still be processed');

  now += 1; // advance to exactly TTL
  assert.strictEqual(store.isProcessed(key), false, 'key at/after TTL must be expired');
  assert.strictEqual(store.isProcessed(key), false, 'expired key must stay deleted');
});

test('C2: ToolGuard.execute does NOT mark a failed result — retry re-executes', async () => {
  const guard = new ToolGuard(process.cwd());
  let calls = 0;
  const toolFn = async () => { calls++; return { success: false, error: 'boom' }; };

  const first = await guard.execute('executeShell', { command: 'echo ok' }, toolFn);
  const second = await guard.execute('executeShell', { command: 'echo ok' }, toolFn);

  assert.strictEqual(calls, 2, 'failed toolFn must be executed BOTH times (no silent skip)');
  assert.strictEqual(first.skipped, undefined);
  assert.strictEqual(second.skipped, undefined, 'second call must NOT be idempotency-skipped');
  assert.strictEqual(second.success, false);
});

test('C3: ToolGuard.execute skips a duplicate SUCCESS with success:true on the skip result', async () => {
  const guard = new ToolGuard(process.cwd());
  let calls = 0;
  const toolFn = async () => { calls++; return { success: true, output: 'done' }; };

  // v13.0 (F3.2): 'touch' is a MUTATING command — idempotency applies.
  const first = await guard.execute('executeShell', { command: 'touch /tmp/luna-wave3-c3' }, toolFn);
  const second = await guard.execute('executeShell', { command: 'touch /tmp/luna-wave3-c3' }, toolFn);

  assert.strictEqual(calls, 1, 'successful mutating toolFn must execute only once');
  assert.strictEqual(first.success, true);
  assert.strictEqual(second.skipped, true, 'duplicate success must be idempotency-skipped');
  assert.strictEqual(second.success, true, 'skip result must carry success:true (a no-op success, not a failure)');
  assert.strictEqual(second.reason, 'already processed');
});

test('C3b (v13.0 F3.2): read-only shell commands are NEVER idempotency-skipped', async () => {
  const guard = new ToolGuard(process.cwd());
  let calls = 0;
  const toolFn = async () => { calls++; return { success: true, output: 'done' }; };

  for (const cmd of ['echo ok', 'cat /etc/hostname', 'git status']) {
    await guard.execute('executeShell', { command: cmd }, toolFn);
    await guard.execute('executeShell', { command: cmd }, toolFn);
  }
  assert.strictEqual(calls, 6, 'read-only commands must always re-execute (no skip)');
});

// C4: auto-commit gate must not fire for idempotency-skipped results —
// the skip path bypasses the checksum drift check, so committing there
// could commit externally-modified content (FILE_DRIFT bypass).
test('C4: soul auto-commit gate excludes skipped results (content assertion)', () => {
  const soulSrc = fs.readFileSync(require('node:path').join(__dirname, '../luna-soul.cjs'), 'utf8');
  const gateIdx = soulSrc.indexOf('Auto-commit git hook for file-modifying tools');
  assert.ok(gateIdx !== -1, 'auto-commit gate must exist');
  const window = soulSrc.slice(gateIdx, gateIdx + 500);
  assert.ok(
    window.includes('result.success && !result.skipped'),
    'auto-commit gate must exclude idempotency-skipped results'
  );
});

// ── Fix D: safeExec default/cap + dashboardApi abort ─────────────────────────

const { clampExecTimeout } = require('../lib/exec-timeout.cjs');
const { runTests } = require('../luna-tools.cjs');

test('D1: clampExecTimeout falls back to 60s default on null/0/negative/garbage', () => {
  for (const bad of [undefined, null, 0, -5, 'abc', NaN, Infinity]) {
    assert.strictEqual(clampExecTimeout(bad), 60000, `clampExecTimeout(${bad}) must be 60000`);
  }
});

test('D1: clampExecTimeout converts seconds to ms and caps at 600s', () => {
  assert.strictEqual(clampExecTimeout(5), 5000);
  assert.strictEqual(clampExecTimeout(120), 120000);
  assert.strictEqual(clampExecTimeout(99999), 600000, 'values above the cap must clamp to 600000ms');
  assert.strictEqual(clampExecTimeout(5, 10, 30), 5000, 'custom default/max must be honored');
  assert.strictEqual(clampExecTimeout(undefined, 10, 30), 10000);
  assert.strictEqual(clampExecTimeout(99, 10, 30), 30000);
});

test('D2: safeExec no longer defaults to an unlimited timeout (content assertion)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-tools.cjs'), 'utf8');
  const fnIdx = src.indexOf('function safeExec(');
  assert.ok(fnIdx !== -1, 'safeExec must exist');
  const body = src.slice(fnIdx, fnIdx + 1400);
  assert.ok(!body.includes('timeout: opts.timeout || 0'), 'safeExec must not keep the v8.5 unlimited default');
  assert.ok(body.includes('clampExecTimeout(opts.timeout)'), 'safeExec must clamp via clampExecTimeout');
  assert.ok(
    body.includes('timeout -k 10') && body.includes('shQuote(cmd)'),
    'safeExec must wrap the command in GNU timeout so the whole process group is killed'
  );
});

test('D2: a short-timeout exec of sleep actually terminates (no 30s hang)', () => {
  // Distinctive duration so we can identify OUR process; '[s]' keeps the
  // pgrep pattern from matching pgrep's own command line.
  const start = Date.now();
  const result = runTests({ command: 'sleep 98765', timeout: 1 });
  const elapsed = Date.now() - start;
  assert.strictEqual(result.success, false, 'killed command must report success:false');
  assert.ok(elapsed < 5000, `must abort near the 1s timeout, not wait for sleep 98765 (took ${elapsed}ms)`);
  // The whole process GROUP must be dead — execSync's native timeout only
  // kills the direct /bin/sh child and orphans the sleep grandchild.
  const { execSync } = require('node:child_process');
  const survivors = execSync(`pgrep -af '[s]leep 98765' || true`, { encoding: 'utf8' }).trim();
  assert.strictEqual(survivors, '', `timed-out process group must be dead, found: ${survivors}`);
});

test('D3: dashboardApi fetch carries a 15s AbortSignal (content assertion)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-tools.cjs'), 'utf8');
  assert.ok(src.includes('AbortSignal.timeout(15000)'), 'dashboardApi fetch must use AbortSignal.timeout(15000)');
});

// ── Fix E: command injection — shell-quote + clamps (lib/shell-quote.cjs) ────

const { shellQuote, toNonNegInt, assertSafeName } = require('../lib/shell-quote.cjs');
const { searchFiles, installPackages, gitLog } = require('../luna-tools.cjs');

test('E1: shellQuote round-trips hostile strings through bash with no injection', () => {
  const { execFileSync } = require('node:child_process');
  for (const payload of ['a"b$c`d`', "'; rm -rf /; '", '$(touch /tmp/x)', 'linha\ncom quebra']) {
    const out = execFileSync('bash', ['-c', 'printf %s ' + shellQuote(payload)], { encoding: 'utf8' });
    assert.strictEqual(out, payload, `shellQuote must preserve ${JSON.stringify(payload)} byte-exactly through bash`);
  }
});

test('E1: toNonNegInt rejects garbage and negatives, honors default and cap', () => {
  assert.strictEqual(toNonNegInt('2;rm -rf /', 2), 2, 'injection string must fall back to default');
  assert.strictEqual(toNonNegInt(5, 2), 5);
  assert.strictEqual(toNonNegInt('7', 2), 7, 'numeric strings are accepted');
  assert.strictEqual(toNonNegInt(-1, 2), 2);
  assert.strictEqual(toNonNegInt(2.5, 2), 2, 'non-integers fall back to default');
  assert.strictEqual(toNonNegInt(99999, 2, 100), 100, 'values above max are clamped');
});

test('E1: assertSafeName accepts package/process names, rejects shell metachars', () => {
  assert.strictEqual(assertSafeName('left-pad'), 'left-pad');
  assert.strictEqual(assertSafeName('a/b@c'), 'a/b@c', 'scoped npm names must pass');
  assert.strictEqual(assertSafeName('luna-server'), 'luna-server');
  assert.throws(() => assertSafeName('x;y'), /inválido/, 'semicolon must be rejected');
  assert.throws(() => assertSafeName('$(id)'), /inválido/);
  assert.throws(() => assertSafeName('a b'), /inválido/, 'spaces must be rejected');
  assert.throws(() => assertSafeName('../../etc'), /inválido/, 'dot-dot traversal must be rejected');
  assert.throws(() => assertSafeName(''), /inválido/, 'empty name must be rejected');
});

test('E2: installPackages rejects an injected package name and runs nothing', () => {
  withTmpDir((dir) => {
    const marker = path.join(dir, 'pwned');
    const result = installPackages([`lodash;touch ${marker}`], { cwd: dir });
    assert.strictEqual(result.success, false, 'unsafe package name must return success:false');
    assert.ok(result.error.includes('inválido'), `error must explain the rejection (got: ${result.error})`);
    assert.strictEqual(fs.existsSync(marker), false, 'injected command must NOT have executed');
  });
});

test('E2: gitLog clamps an injected n to the default and runs plain git log', () => {
  withTmpDir((dir) => {
    const { execSync } = require('node:child_process');
    execSync('git init -q', { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
    execSync('git add a.txt && git -c user.email=t@t -c user.name=t commit -qm init', { cwd: dir });

    const marker = path.join(dir, 'pwned');
    const result = gitLog({ cwd: dir, n: `1; touch ${marker}` });
    assert.strictEqual(result.success, true, `git log -10 must run cleanly (got: ${result.error})`);
    assert.strictEqual(result.commits.length, 1, 'the single fixture commit must be listed');
    assert.strictEqual(fs.existsSync(marker), false, 'injected command must NOT have executed');
  });
});

test('E2: searchFiles clamps an injected context param and runs the search', () => {
  withTmpDir((dir) => {
    fs.writeFileSync(path.join(dir, 'hay.txt'), 'line1\nneedle here\nline3\n');
    const marker = path.join(dir, 'pwned');
    const result = searchFiles('needle', { cwd: dir, context: `2;touch ${marker}` });
    assert.strictEqual(result.success, true, `search must succeed with the default -C 2 (got: ${result.error})`);
    assert.ok(result.results.some(l => l.includes('needle here')), 'the match must be found');
    assert.strictEqual(fs.existsSync(marker), false, 'injected command must NOT have executed');
  });
});

test('E3: all six injection sites use the helpers (content assertion)', () => {
  const toolsSrc = fs.readFileSync(path.join(__dirname, '..', 'luna-tools.cjs'), 'utf8');
  const validatorSrc = fs.readFileSync(path.join(__dirname, '..', 'luna-code-validator.cjs'), 'utf8');

  assert.ok(toolsSrc.includes('cd ${shellQuote(cwd)}'), 'executeShellVisible must shell-quote the cwd in the script');
  const ctxClamps = toolsSrc.match(/-C \$\{toNonNegInt\(opts\['-C'\] \?\? opts\.context, 2, 100\)\}/g) || [];
  assert.strictEqual(ctxClamps.length, 4, 'searchFiles and grep must clamp -C in both rg and grep branches');
  assert.ok(toolsSrc.includes("assertSafeName(p, 'pacote')"), 'installPackages must whitelist package names');
  assert.ok(toolsSrc.includes('toNonNegInt(opts.n ?? opts.limit, 10, 1000)'), 'gitLog must clamp n');
  assert.ok(toolsSrc.includes("assertSafeName(targetProcess, 'processo pm2')"), 'openDebugTerminal must whitelist the pm2 process name');
  assert.ok(toolsSrc.includes('toNonNegInt(lines, 50, 5000)'), 'openDebugTerminal must clamp --lines');

  assert.ok(validatorSrc.includes('-p ${shellQuote(tsconfigDir)}'), 'typeScriptValidate must quote the tsconfig path');
  assert.ok(validatorSrc.includes('--moduleResolution node ${shellQuote(filePath)}'), 'typeScriptValidate must quote the file path');
});

test('E3: shell-quote.cjs reuses the Fix D shQuote implementation (no duplicate quoting helper)', () => {
  const { shQuote } = require('../lib/exec-timeout.cjs');
  assert.strictEqual(shellQuote, shQuote, 'shellQuote must be the same function as shQuote');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'shell-quote.cjs'), 'utf8');
  assert.strictEqual(src.match(/replace\(\/'/g), null, 'shell-quote.cjs must not re-implement the quoting regex');
});

// E4: JSON.stringify-in-shell sites converted to shellQuote — $(...) executes
// inside shell double quotes, so the old "already safe" premise was false.
// These are behavioral PoCs through the real tool functions.
test('E4: searchFiles pattern with command substitution does NOT execute', () => {
  const marker = `/tmp/luna-w3-e4-${process.pid}`;
  try { fs.unlinkSync(marker); } catch {}
  const result = searchFiles(`$(touch ${marker})`, { cwd: '/tmp' });
  // pattern legitimately matches nothing; the point is the side effect
  assert.ok(!fs.existsSync(marker), 'command substitution in pattern must not execute');
});

test('E4: gitCommit message with command substitution does NOT execute', () => {
  const { gitCommit } = require('../luna-tools.cjs');
  const { execSync: execSyncLocal } = require('node:child_process');
  const marker = `/tmp/luna-w3-e4-git-${process.pid}`;
  withTmpDir(dir => {
    try { fs.unlinkSync(marker); } catch {}
    execSyncLocal('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    gitCommit(`msg $(touch ${marker})`, { cwd: dir });
    assert.ok(!fs.existsSync(marker), 'command substitution in commit message must not execute');
  });
});

test('E4: assertSafeName rejects leading-dash argument injection, accepts npm ranges', () => {
  assert.throws(() => assertSafeName('--prefix=/tmp', 'pacote'), /inválido/);
  assert.throws(() => assertSafeName('-g', 'pacote'), /inválido/);
  assert.strictEqual(assertSafeName('lodash@^4', 'pacote'), 'lodash@^4');
  assert.strictEqual(assertSafeName('react@~18.2.0', 'pacote'), 'react@~18.2.0');
  assert.throws(() => assertSafeName('pkg@>=2', 'pacote'), /inválido/, '< and > stay banned (shell metachars)');
});

test('E4: no JSON.stringify interpolation remains in shell command strings (content assertion)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-tools.cjs'), 'utf8');
  const lines = src.split('\n');
  const offenders = lines.filter(l =>
    l.includes('JSON.stringify') &&
    (l.includes('execSync(') || /cmd\s*=\s*`/.test(l) || l.includes('safeExec(`')) &&
    !l.includes('tmpFile') &&           // internal pid-based tmp paths, not LLM-controllable
    !l.includes('node -e ${shellQuote')  // JS-level quoting inside a shell-quoted arg
  );
  assert.deepStrictEqual(offenders, [], `JSON.stringify-in-shell sites remain: ${offenders.join(' | ')}`);
});

// ── Fix F: path traversal — alias-aware, realpath-resolved (lib/path-guard.cjs)

const { realpathLoose, isInside, checkPathWithinRoots, PATH_PARAM_KEYS } = require('../lib/path-guard.cjs');

function allowedRootsFor(workspaceDir) {
  const roots = [];
  for (const root of [workspaceDir, os.tmpdir()]) {
    if (root) { try { roots.push(fs.realpathSync(root)); } catch {} }
  }
  return roots;
}

test('F1: realpathLoose resolves a nonexistent tail through the nearest existing ancestor', () => {
  withTmpDir((dir) => {
    const real = fs.realpathSync(dir);
    const target = path.join(dir, 'no-such-dir', 'deep', 'file.txt');
    assert.strictEqual(realpathLoose(target), path.join(real, 'no-such-dir', 'deep', 'file.txt'));
  });
});

test('F1: isInside accepts the root itself and children, rejects siblings and parents', () => {
  withTmpDir((dir) => {
    const real = fs.realpathSync(dir);
    assert.strictEqual(isInside(real, real), true, 'root itself is inside');
    assert.strictEqual(isInside(path.join(real, 'sub', 'file.txt'), real), true);
    assert.strictEqual(isInside(path.join(real, '..', 'sibling'), real), false);
    assert.strictEqual(isInside('/etc/hosts', real), false);
  });
});

test('F1: checkPathWithinRoots accepts a real file inside the workspace', () => {
  withTmpDir((dir) => {
    const file = path.join(dir, 'real.txt');
    fs.writeFileSync(file, 'x');
    const check = checkPathWithinRoots(file, allowedRootsFor(dir));
    assert.strictEqual(check.ok, true, `real file inside workspace must pass (got: ${check.reason})`);
  });
});

test('F1: checkPathWithinRoots accepts a not-yet-existing file inside the workspace', () => {
  withTmpDir((dir) => {
    const target = path.join(dir, 'new-dir', 'new-file.txt');
    const check = checkPathWithinRoots(target, allowedRootsFor(dir));
    assert.strictEqual(check.ok, true, `new writeFile target must pass (got: ${check.reason})`);
  });
});

test('F1: checkPathWithinRoots accepts a legit temp path under os.tmpdir()', () => {
  withTmpDir((dir) => {
    const tmpFile = path.join(os.tmpdir(), `luna-w3-f1-${process.pid}.txt`);
    const check = checkPathWithinRoots(tmpFile, allowedRootsFor(dir));
    assert.strictEqual(check.ok, true, `path under os.tmpdir() must pass (got: ${check.reason})`);
  });
});

test('F1: checkPathWithinRoots rejects /tmp/../../etc/passwd (decision on resolved path)', () => {
  withTmpDir((dir) => {
    const check = checkPathWithinRoots('/tmp/../../etc/passwd', allowedRootsFor(dir));
    assert.strictEqual(check.ok, false, 'raw-string /tmp prefix must NOT save a resolved escape');
    assert.ok(check.reason.includes('/tmp/../../etc/passwd'), 'reason must name the raw path');
  });
});

test('F1: checkPathWithinRoots rejects /etc/hosts outright', () => {
  withTmpDir((dir) => {
    const check = checkPathWithinRoots('/etc/hosts', allowedRootsFor(dir));
    assert.strictEqual(check.ok, false);
  });
});

test('F1: checkPathWithinRoots rejects a symlink inside the workspace pointing to /etc', () => {
  withTmpDir((dir) => {
    const link = path.join(dir, 'escape-link');
    try {
      fs.symlinkSync('/etc', link);
    } catch (err) {
      console.log(`F1 symlink fixture skipped: ${err.code || err.message}`);
      return; // environment cannot create symlinks — skip
    }
    const check = checkPathWithinRoots(path.join(link, 'passwd'), allowedRootsFor(dir));
    assert.strictEqual(check.ok, false, 'symlink escape must resolve outside the workspace and be rejected');
  });
});

test('F1: checkPathWithinRoots rejects empty and non-string paths', () => {
  withTmpDir((dir) => {
    const roots = allowedRootsFor(dir);
    assert.strictEqual(checkPathWithinRoots('', roots).ok, false);
    assert.strictEqual(checkPathWithinRoots(null, roots).ok, false);
    assert.strictEqual(checkPathWithinRoots(42, roots).ok, false);
  });
});

test('F1: PATH_PARAM_KEYS covers every alias used by the soul tool dispatch', () => {
  for (const key of ['path', 'filePath', 'file', 'source', 'from', 'destination', 'to', 'dirPath']) {
    assert.ok(PATH_PARAM_KEYS.includes(key), `PATH_PARAM_KEYS must include "${key}"`);
  }
});

test('F2: soul guard loop blocks EVERY alias key, not just params.path', () => {
  withTmpDir((dir) => {
    const roots = allowedRootsFor(dir);
    // Mirror of the luna-soul.cjs guard loop (F2) — every key must be gated.
    for (const key of PATH_PARAM_KEYS) {
      const params = { [key]: '/etc/hosts' };
      let blocked = false;
      for (const k of PATH_PARAM_KEYS) {
        if (!params[k]) continue;
        if (!checkPathWithinRoots(params[k], roots).ok) { blocked = true; break; }
      }
      assert.strictEqual(blocked, true, `alias key "${key}" carrying /etc/hosts must be blocked`);
    }
  });
});

test('F3: luna-soul.cjs uses the new guard and dropped the raw /tmp hatch (content assertion)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-soul.cjs'), 'utf8');
  assert.ok(!src.includes("params.path.startsWith('/tmp')"), 'raw-string /tmp escape hatch must be deleted');
  assert.ok(src.includes('PATH_PARAM_KEYS'), 'soul must iterate all path alias keys');
  assert.ok(src.includes('checkPathWithinRoots'), 'soul must realpath-check via checkPathWithinRoots');
  assert.ok(src.includes("require('./lib/path-guard.cjs')"), 'soul must import lib/path-guard.cjs');
});

// F4: review follow-ups — guard scoped to file tools, cwd/pattern covered,
// session-user workspace, symlink-aware `..` resolution.
test('F4: soul path guard is scoped to file tools and checks cwd/pattern (content assertion)', () => {
  const soulSrc = fs.readFileSync(path.join(__dirname, '..', 'luna-soul.cjs'), 'utf8');
  const guardIdx = soulSrc.indexOf('PATH_GUARD_TOOLS = new Set(');
  assert.ok(guardIdx !== -1, 'PATH_GUARD_TOOLS set must exist');
  const window = soulSrc.slice(guardIdx, guardIdx + 1800);
  assert.ok(window.includes('if (PATH_GUARD_TOOLS.has(tool))'), 'guard must be scoped to file tools');
  assert.ok(!window.includes("'dashboardSendEmail'"), 'dashboard tools must not be in the guard set');
  assert.ok(window.includes('cwd: params.cwd'), 'cwd param must be checked');
  assert.ok(window.includes("tool === 'listFiles'"), 'listFiles pattern must be handled');
  assert.ok(window.includes("tool === 'glob'"), 'glob static prefix must be handled');
  assert.ok(window.includes('options?.userId'), 'workspace must resolve from the session user, not hardcoded luna-cli');
});

test('F4: realpathLoose follows symlinks before collapsing .. (kernel semantics)', () => {
  const { realpathLoose } = require('../lib/path-guard.cjs');
  withTmpDir(dir => {
    // ws/root -> / ; ws/root/../etc/passwd must resolve via the symlink to
    // /etc/passwd — NOT lexically to ws/etc/passwd.
    const link = path.join(dir, 'root');
    try {
      fs.symlinkSync('/', link);
    } catch (e) {
      console.log('symlink unavailable, skipping:', e.message);
      return;
    }
    // Raw string concatenation — path.join would collapse `..` lexically
    // BEFORE the guard sees it (LLM params arrive as raw strings).
    const real = realpathLoose(dir + '/root/../etc/passwd');
    assert.strictEqual(real, '/etc/passwd', `symlink must win over lexical .., got ${real}`);
  });
});

test('F4: glob static prefix extraction blocks absolute outside-glob (behavioral)', () => {
  // Simulate the soul's glob branch: /etc/*.conf → prefix /etc → must fail
  // against a workspace-only root set.
  const { checkPathWithinRoots } = require('../lib/path-guard.cjs');
  withTmpDir(dir => {
    const roots = [fs.realpathSync(dir)];
    const pattern = '/etc/*.conf';
    const idx = pattern.search(/[*?\[\]{}]/);
    const prefix = pattern.slice(0, idx);
    const base = prefix.endsWith('/') ? prefix.slice(0, -1) : path.dirname(prefix);
    assert.strictEqual(checkPathWithinRoots(base, roots).ok, false, '/etc glob prefix must be blocked');
    const inside = path.join(dir, 'src', '**', '*.ts');
    const idx2 = inside.search(/[*?\[\]{}]/);
    const prefix2 = inside.slice(0, idx2);
    const base2 = prefix2.endsWith('/') ? prefix2.slice(0, -1) : path.dirname(prefix2);
    assert.strictEqual(checkPathWithinRoots(base2, roots).ok, true, 'in-workspace glob prefix must pass');
  });
});

// F5: second review round — 6 missing file tools added, listFiles globby
// patterns guarded by static prefix, workspace fallback mirrors _buildContext.
test('F5: PATH_GUARD_TOOLS covers all file tools incl. destructive ones (content assertion)', () => {
  const soulSrc = fs.readFileSync(path.join(__dirname, '..', 'luna-soul.cjs'), 'utf8');
  const setIdx = soulSrc.indexOf('PATH_GUARD_TOOLS = new Set(');
  const setBody = soulSrc.slice(setIdx, soulSrc.indexOf('])', setIdx));
  for (const t of ['getFileInfo', 'viewDirectory', 'readMediaFile', 'checkSyntax', 'createDirectory', 'removeDirectory']) {
    assert.ok(setBody.includes(`'${t}'`), `${t} must be in PATH_GUARD_TOOLS`);
  }
});

test('F5: listFiles globby patterns go through static-prefix extraction (content assertion)', () => {
  const soulSrc = fs.readFileSync(path.join(__dirname, '..', 'luna-soul.cjs'), 'utf8');
  const guardIdx = soulSrc.indexOf('PATH_GUARD_TOOLS = new Set(');
  const window = soulSrc.slice(guardIdx, guardIdx + 2000);
  assert.ok(
    window.includes("tool === 'listFiles' || tool === 'glob'"),
    'listFiles and glob must share the prefix extraction branch'
  );
  assert.ok(window.includes("options?.userId || 'luna-default'"), 'workspace fallback must mirror _buildContext');
});

test('F5: listFiles /etc/** static prefix is blocked (behavioral)', () => {
  const { checkPathWithinRoots } = require('../lib/path-guard.cjs');
  withTmpDir(dir => {
    const roots = [fs.realpathSync(dir)];
    const pattern = '/etc/**';
    const idx = pattern.search(/[*?\[\]{}]/);
    const prefix = pattern.slice(0, idx);
    const base = prefix.endsWith('/') ? prefix.slice(0, -1) : path.dirname(prefix);
    assert.strictEqual(checkPathWithinRoots(base, roots).ok, false, '/etc/** must be blocked via prefix');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix G — SSRF: host validation + redirect/size/timeout caps
// ═══════════════════════════════════════════════════════════════════════════

const http = require('node:http');
const { checkUrlSafety, parseIPv4, isPrivateIPv4, fetchAllowList } = require('../lib/url-safety.cjs');
const { fetchURL, downloadFile, browser } = require('../luna-tools.cjs');

const G_BLOCKED = [
  'http://127.0.0.1/', 'http://2130706433/', 'http://0177.0.0.1/', 'http://0x7f000001/',
  'http://127.1/', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://172.31.255.1/',
  'http://192.168.1.1/', 'http://169.254.169.254/', 'http://100.64.0.1/',
  'http://localhost/', 'http://foo.localhost/', 'http://db.internal/',
  'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'file:///etc/passwd',
];

test('G1: checkUrlSafety blocks every private/loopback/metadata form', () => {
  for (const u of G_BLOCKED) {
    const r = checkUrlSafety(u);
    assert.strictEqual(r.ok, false, `${u} must be blocked`);
    assert.ok(r.reason, `${u} must carry a reason`);
  }
});

test('G1: checkUrlSafety allows public hosts and boundary ranges', () => {
  for (const u of ['http://example.com/', 'http://8.8.8.8/', 'http://172.15.0.1/', 'http://172.32.0.1/', 'http://100.128.0.1/']) {
    assert.strictEqual(checkUrlSafety(u).ok, true, `${u} must be allowed`);
  }
});

test('G1: parseIPv4 normalizes integer/octal/hex/short literals', () => {
  assert.deepStrictEqual(parseIPv4('2130706433'), [127, 0, 0, 1]);
  assert.deepStrictEqual(parseIPv4('0177.0.0.1'), [127, 0, 0, 1]);
  assert.deepStrictEqual(parseIPv4('0x7f000001'), [127, 0, 0, 1]);
  assert.deepStrictEqual(parseIPv4('127.1'), [127, 0, 0, 1]);
  assert.strictEqual(parseIPv4('example.com'), null);
  assert.strictEqual(isPrivateIPv4([172, 31, 0, 1]), true);
  assert.strictEqual(isPrivateIPv4([172, 32, 0, 1]), false);
});

test('G1: LUNA_FETCH_ALLOW_HOSTS allowlist punches exact holes only', () => {
  assert.strictEqual(checkUrlSafety('http://127.0.0.1/', ['127.0.0.1']).ok, true);
  assert.strictEqual(checkUrlSafety('http://127.0.0.1:3456/', ['127.0.0.1:3456']).ok, true);
  assert.strictEqual(checkUrlSafety('http://127.0.0.1:9999/', ['127.0.0.1:3456']).ok, false, 'different port must stay blocked');
  assert.deepStrictEqual(fetchAllowList({ LUNA_FETCH_ALLOW_HOSTS: ' a , b:3000 ,' }), ['a', 'b:3000']);
  assert.deepStrictEqual(fetchAllowList({}), []);
});

// Starts an http fixture on 127.0.0.1 with the given handler; returns { server, base }.
function listenFixture(handler) {
  return new Promise((resolveListen) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolveListen({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function withAllowHosts(value, fn) {
  const prev = process.env.LUNA_FETCH_ALLOW_HOSTS;
  if (value === undefined) delete process.env.LUNA_FETCH_ALLOW_HOSTS; else process.env.LUNA_FETCH_ALLOW_HOSTS = value;
  return Promise.resolve().then(fn).finally(() => {
    if (prev === undefined) delete process.env.LUNA_FETCH_ALLOW_HOSTS; else process.env.LUNA_FETCH_ALLOW_HOSTS = prev;
  });
}

test('G2: fetchURL blocks a loopback URL before any connection (no allowlist)', async () => {
  await withAllowHosts(undefined, async () => {
    const r = await fetchURL('http://127.0.0.1:1/secret');
    assert.strictEqual(r.success, false);
    assert.match(r.error, /bloqueado/);
  });
});

test('G2: allowlisted fixture is reachable end-to-end (owner override)', async () => {
  const { server, base } = await listenFixture((req, res) => res.end('hello-luna'));
  try {
    await withAllowHosts(base.replace('http://', ''), async () => {
      const r = await fetchURL(base + '/');
      assert.strictEqual(r.success, true);
      assert.strictEqual(r.content, 'hello-luna');
    });
  } finally { server.close(); }
});

test('G2: relative redirect Location is resolved against the current URL', async () => {
  const { server, base } = await listenFixture((req, res) => {
    if (req.url === '/target') return res.end('relative-ok');
    res.writeHead(302, { Location: '/target' });
    res.end();
  });
  try {
    await withAllowHosts(base.replace('http://', ''), async () => {
      const r = await fetchURL(base + '/start');
      assert.strictEqual(r.success, true);
      assert.strictEqual(r.content, 'relative-ok');
    });
  } finally { server.close(); }
});

test('G2: redirect from an allowed host to a private IP is re-validated and blocked', async () => {
  const { server, base } = await listenFixture((req, res) => {
    res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
    res.end();
  });
  try {
    await withAllowHosts(base.replace('http://', ''), async () => {
      const r = await fetchURL(base + '/bounce');
      assert.strictEqual(r.success, false);
      assert.match(r.error, /bloqueado/);
    });
  } finally { server.close(); }
});

test('G2: a redirect loop terminates after 5 redirects', async () => {
  const { server, base } = await listenFixture((req, res) => {
    res.writeHead(302, { Location: '/loop' });
    res.end();
  });
  try {
    await withAllowHosts(base.replace('http://', ''), async () => {
      const r = await fetchURL(base + '/loop');
      assert.strictEqual(r.success, false);
      assert.match(r.error, /redirect/i);
    });
  } finally { server.close(); }
});

test('G2: a body over 5MB is capped mid-stream', async () => {
  const big = Buffer.alloc(5 * 1024 * 1024 + 4096, 'a');
  const { server, base } = await listenFixture((req, res) => res.end(big));
  try {
    await withAllowHosts(base.replace('http://', ''), async () => {
      const r = await fetchURL(base + '/big');
      assert.strictEqual(r.success, false);
      assert.match(r.error, /5MB/);
    });
  } finally { server.close(); }
});

test('G3: downloadFile blocks a loopback URL and creates no file', async () => {
  await withAllowHosts(undefined, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-wave3g-'));
    try {
      const dst = path.join(dir, 'x.bin');
      const r = await downloadFile('http://127.0.0.1:1/secret', dst);
      assert.strictEqual(r.success, false);
      assert.match(r.error, /bloqueado/);
      assert.strictEqual(fs.existsSync(dst), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('G3: downloadFile honors the byte cap, aborts and unlinks the partial file', async () => {
  const { server, base } = await listenFixture((req, res) => res.end(Buffer.alloc(1024 * 1024, 'b')));
  try {
    await withAllowHosts(base.replace('http://', ''), async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-wave3g-'));
      try {
        const dst = path.join(dir, 'big.bin');
        const r = await downloadFile(base + '/big', dst, { maxBytes: 4096 });
        assert.strictEqual(r.success, false);
        assert.match(r.error, /100MB/);
        assert.strictEqual(fs.existsSync(dst), false, 'partial file must be unlinked');
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  } finally { server.close(); }
});

test('G3: downloadFile timeout no longer defaults to 0 = unlimited (content assertion)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-tools.cjs'), 'utf8');
  const idx = src.indexOf('function downloadFile(');
  const body = src.slice(idx, idx + 2000);
  assert.ok(!body.includes('opts.timeout || 0'), 'zero default timeout must be gone');
  assert.ok(body.includes('opts.timeout || 15000'), '15s default timeout expected');
});

test('G4: browser blocks a private URL before launching Playwright', async () => {
  await withAllowHosts(undefined, async () => {
    const r = await browser('http://169.254.169.254/latest/meta-data');
    assert.strictEqual(r.success, false);
    assert.match(r.error, /bloqueado/);
  });
});

// G5: review follow-ups — trailing-dot bypass, IPv4-in-IPv6 tails, redirect clamp.
test('G5: trailing-dot hostnames are blocked (localhost. resolves to loopback)', () => {
  const { checkUrlSafety } = require('../lib/url-safety.cjs');
  assert.strictEqual(checkUrlSafety('http://localhost.:8080/').ok, false);
  assert.strictEqual(checkUrlSafety('http://foo.localhost./').ok, false);
  assert.strictEqual(checkUrlSafety('http://example.com./').ok, true, 'public trailing-dot host must still pass');
});

test('G5: IPv4 embedded in IPv6 tails blocked (v4-compat + NAT64)', () => {
  const { checkUrlSafety } = require('../lib/url-safety.cjs');
  assert.strictEqual(checkUrlSafety('http://[::127.0.0.1]/').ok, false, 'v4-compat loopback');
  assert.strictEqual(checkUrlSafety('http://[::10.0.0.1]/').ok, false, 'v4-compat private');
  assert.strictEqual(checkUrlSafety('http://[64:ff9b::127.0.0.1]/').ok, false, 'NAT64 loopback');
  assert.strictEqual(checkUrlSafety('http://[64:ff9b::192.168.1.1]/').ok, false, 'NAT64 private');
  assert.strictEqual(checkUrlSafety('http://[64:ff9b::8.8.8.8]/').ok, true, 'NAT64 public must pass');
  assert.strictEqual(checkUrlSafety('http://[fec0::1]/').ok, false, 'deprecated site-local');
});

test('G5: redirect counter is clamped (content assertion)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-tools.cjs'), 'utf8');
  const occurrences = src.split('Math.max(0, opts._redirects | 0)').length - 1;
  assert.strictEqual(occurrences, 2, 'both fetchURL and downloadFile must clamp _redirects');
});

// ── Fix H: guard registry desync + workspace mismatch ────────────────────────

// H1: tools sem schema estrito NÃO lançam mais — fail-open com warn-once.
// FAILS pré-fix: validateToolCall('dashboardListTasks', {}) lançava
// "não existe no schema registry".
test('H1: unschema\'d tool validates against the permissive default (no throw), warning fires ONCE', () => {
  validateToolCall._warned.delete('dashboardListTasks'); // estado limpo p/ o assert de warn-once

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (msg) => warnings.push(String(msg));
  try {
    assert.strictEqual(validateToolCall('dashboardListTasks', {}), true, 'fail-open must return true');
    assert.strictEqual(validateToolCall('dashboardListTasks', {}), true, 'second call must also pass');
  } finally {
    console.warn = originalWarn;
  }

  assert.strictEqual(warnings.length, 1, 'warning must fire exactly once per tool');
  assert.match(warnings[0], /dashboardListTasks/);
  assert.match(warnings[0], /fail-open/);
  validateToolCall._warned.delete('dashboardListTasks');
});

// H1: writeFile com o alias filePath (suportado pelo dispatch do soul) satisfaz
// required:['path'] e pathMustBeAbsolute. FAILS pré-fix: required check só olhava
// params.path.
test('H1: writeFile accepts the filePath alias for required + absolute checks', () => {
  assert.strictEqual(validateToolCall('writeFile', { filePath: '/abs/x', content: 'c' }), true);
  assert.strictEqual(validateToolCall('writeFile', { file: '/abs/y', content: 'c' }), true, 'file alias also accepted');
});

test('H1: writeFile alias is still ENFORCED — relative filePath throws', () => {
  assert.throws(
    () => validateToolCall('writeFile', { filePath: 'rel/x', content: 'c' }),
    /deve ser absoluto/
  );
});

// Wave 5 (Task 5a): writeFile pathMustNotContain was REMOVED from the registry
// schema — soul's realpath path-guard owns traversal safety; the schema no
// longer rejects raw '..'/'~' in the path value.
test('H1: writeFile schema accepts .. and ~ in the alias value (path guard owns traversal)', () => {
  assert.strictEqual(validateToolCall('writeFile', { filePath: '/abs/../escape', content: 'c' }), true);
  assert.strictEqual(validateToolCall('writeFile', { path: '/abs/~user/x', content: 'c' }), true);
});

// H3: idempotency escopada a tools mutating — reads idênticos NUNCA são
// dedupados. FAILS pré-fix para o caso read (segunda chamada era skipada).
test('H3: duplicate READ tool calls are NOT idempotency-skipped', async () => {
  const guard = new ToolGuard(process.cwd());
  let calls = 0;
  const toolFn = async () => { calls++; return { success: true, output: 'data' }; };

  const first = await guard.execute('readFile', { path: '/etc/hostname' }, toolFn);
  const second = await guard.execute('readFile', { path: '/etc/hostname' }, toolFn);

  assert.strictEqual(calls, 2, 'read toolFn must execute BOTH times');
  assert.strictEqual(first.skipped, undefined);
  assert.strictEqual(second.skipped, undefined, 'duplicate read must NOT be skipped');
});

test('H3: duplicate MUTATING tool calls ARE still idempotency-skipped', async () => {
  const guard = new ToolGuard(os.tmpdir());
  let calls = 0;
  const target = path.join(os.tmpdir(), 'luna-h3-mut.txt');
  const toolFn = async () => { calls++; return { success: true }; }; // stubbed: no fs write

  await guard.execute('writeFile', { path: target, content: 'a' }, toolFn);
  const second = await guard.execute('writeFile', { path: target, content: 'a' }, toolFn);

  assert.strictEqual(calls, 1, 'mutating toolFn must execute only once');
  assert.strictEqual(second.skipped, true);
  assert.strictEqual(second.success, true);
});

test('H3: dashboard read tools are not treated as mutating', async () => {
  const guard = new ToolGuard(process.cwd());
  let calls = 0;
  const toolFn = async () => { calls++; return { success: true, tasks: [] }; };

  await guard.execute('dashboardListTasks', {}, toolFn);
  const second = await guard.execute('dashboardListTasks', {}, toolFn);

  assert.strictEqual(calls, 2, 'dashboard read must run every time');
  assert.strictEqual(second.skipped, undefined);
});

// H4: o guard clampa params.timeout do executeShell ao seu próprio budget, para
// que o kill real do safeExec (Fix D) dispare dentro do race do guard.
test('H4: executeShell params.timeout is clamped to the guard budget', async () => {
  const guard = new ToolGuard(process.cwd());

  const big = { command: 'echo a', timeout: 999 };
  await guard.execute('executeShell', big, async () => ({ success: true }));
  assert.ok(big.timeout <= 30, `timeout 999 must be clamped to <=30, got ${big.timeout}`);

  const small = { command: 'echo b', timeout: 5 };
  await guard.execute('executeShell', small, async () => ({ success: true }));
  assert.strictEqual(small.timeout, 5, 'a timeout under the budget must be preserved');

  const missing = { command: 'echo c' };
  await guard.execute('executeShell', missing, async () => ({ success: true }));
  assert.strictEqual(missing.timeout, 30, 'missing timeout must default to the guard budget (30s)');
});

// H2: _ensureToolGuard nunca retorna null (fallback workspaceBase) e o call site
// passa o usuário da sessão. Content-assertion estrutural.
test('H2: _ensureToolGuard has a workspaceBase fallback and the call site passes actionUserId (content assertion)', () => {
  const soulSrc = fs.readFileSync(path.join(__dirname, '..', 'luna-soul.cjs'), 'utf8');

  const fnIdx = soulSrc.indexOf('_ensureToolGuard(userId)');
  assert.ok(fnIdx !== -1, '_ensureToolGuard must take a userId parameter');
  const fnWindow = soulSrc.slice(fnIdx, fnIdx + 600);
  assert.ok(
    fnWindow.includes('lunaConfig.PATHS.workspaceBase'),
    '_ensureToolGuard must fall back to lunaConfig.PATHS.workspaceBase instead of returning null'
  );
  assert.ok(
    !fnWindow.includes('if (!ws) return null'),
    '_ensureToolGuard must never return null'
  );
  assert.ok(
    fnWindow.includes("workspaceManager.getWorkspace(userId)"),
    'user workspace must be tried before the luna-cli fallback'
  );

  assert.ok(
    soulSrc.includes('this._ensureToolGuard(actionUserId)'),
    'the execute call site must pass the session user'
  );
  assert.ok(
    soulSrc.includes("options?.userId || 'luna-cli'"),
    '_handleAction must resolve actionUserId from options.userId (transport-provided) with a luna-cli fallback'
  );
  assert.ok(
    !soulSrc.includes('const session = this.sessionManager.loadSession(sessionId);\n    const actionUserId'),
    'actionUserId must not come from a per-call loadSession (sessions do not persist userId — pure wasted I/O)'
  );
});

// H5: review follow-ups — clamp hoisted above circuit.check so check/record
// sign the same params (the breaker could never trip for executeShell), and
// garbage timeouts are sanitized via clampExecTimeout.
test('H5: circuit breaker trips for repeated identical executeShell calls', async () => {
  const guard = new ToolGuard(process.cwd());
  const params = { command: 'echo loop-test' };
  const toolFn = async () => ({ success: true, stdout: 'ok' });

  // Budget allows 3 identical calls/60s; the 4th/5th must throw CIRCUIT_OPEN.
  // Pre-fix: check signed {command} but record signed {command,timeout:30}
  // after the clamp — the breaker never tripped.
  let tripped = false;
  for (let i = 0; i < 6 && !tripped; i++) {
    try {
      await guard.execute('executeShell', { ...params }, toolFn);
    } catch (e) {
      if (/circuit|CIRCUIT/i.test(e.message)) tripped = true;
      else throw e;
    }
  }
  assert.ok(tripped, 'circuit breaker must trip on repeated identical executeShell calls');
});

test('H5: negative/garbage executeShell timeout is sanitized, not passed through', async () => {
  const guard = new ToolGuard(process.cwd());
  let seenTimeout;
  const toolFn = async () => ({ success: true });
  const params = { command: 'echo x', timeout: -5 };
  await guard.execute('executeShell', params, toolFn);
  assert.ok(params.timeout > 0, `clamped timeout must be positive, got ${params.timeout}`);
  assert.ok(params.timeout <= 30, `clamped timeout must respect the guard budget, got ${params.timeout}`);
});

// ── Fix I1: replaceInFile must NOT create the file when the target is missing ──

test('I1: replaceInFile on a missing file returns success:false and does not create it', () => {
  withTmpDir((dir) => {
    const file = path.join(dir, 'does-not-exist.txt');
    const result = replaceInFile(file, 'a', 'b');
    assert.strictEqual(result.success, false);
    assert.match(result.error, /writeFile/i, 'error must point the model to writeFile');
    assert.ok(!fs.existsSync(file), 'missing target must NOT be created');
  });
});

test('I1: replaceInFile on a missing file does not create parent dirs either', () => {
  withTmpDir((dir) => {
    const file = path.join(dir, 'nested', 'deep', 'missing.txt');
    const result = replaceInFile(file, 'a', 'b');
    assert.strictEqual(result.success, false);
    assert.ok(!fs.existsSync(path.join(dir, 'nested')), 'parent dirs must NOT be created');
  });
});

// ── Fix I2: executeScript single success semantics ──

test('I2: executeScript failure returns success:false WITH an error string', () => {
  const result = executeScript('exit 3', { language: 'bash' });
  assert.strictEqual(result.success, false);
  assert.strictEqual(typeof result.error, 'string', 'failed script must carry an error field');
  assert.match(result.error, /exit 3/);
  assert.strictEqual(result.exitCode, 3);
});

test('I2: executeScript success keeps success:true and exitCode 0', () => {
  const result = executeScript('echo hello', { language: 'bash' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.exitCode, 0);
  assert.match(result.stdout, /hello/);
  assert.strictEqual(result.error, undefined);
});

// ── Fix I3: runBuildCheck timeout capped at 60s (content assertion) ──

test('I3: BUILD_TIMEOUT_MS is 60000 and drives the execSync timeout', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-code-validator.cjs'), 'utf8');
  assert.ok(/const BUILD_TIMEOUT_MS = 60000;/.test(src), 'BUILD_TIMEOUT_MS constant must be hoisted at 60s');
  assert.ok(src.includes('timeout: BUILD_TIMEOUT_MS'), 'execSync must use BUILD_TIMEOUT_MS');
  assert.ok(!src.includes('timeout: 180000'), 'the old 180s inline timeout must be gone');
});

// ── Wave 6: visible-shell no-log fallback (live bug 2026-07-12) ─────────────
// PM2 inherited DISPLAY from the shell → executeShell went down the VISIBLE
// path (executeShellVisible) → the graphical terminal produced no log under
// the PM2 session (no D-Bus) → readFileSync(tmpFile) ENOENT was classified as
// a bogus "file not found" tool failure instead of falling back to the
// invisible shell. Every executeShell failed.

test('W6a: invisible executeShell still executes (regression baseline)', async () => {
  const { executeShell } = require('../luna-tools.cjs');
  const res = await executeShell('echo w6-marker', { visible: false, timeout: 10 });
  assert.strictEqual(res.success, true, `invisible shell must work, got ${JSON.stringify(res)}`);
  assert.ok((res.stdout || '').includes('w6-marker'), 'stdout must carry the echo output');
});

test('W6b: close-handler falls back to invisible shell when the terminal produced no log', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-tools.cjs'), 'utf8');
  const closeIdx = src.indexOf("child.on('close'");
  assert.ok(closeIdx !== -1, 'executeShellVisible must have a close handler');
  const closeFn = src.slice(closeIdx, closeIdx + 2000);
  assert.ok(closeFn.includes("e.code === 'ENOENT'"), 'close handler must detect the missing-log case specifically');
  assert.ok(closeFn.includes('visible: false'), 'close handler must fall back to invisible execution on missing log');
  assert.ok(closeFn.includes('setTimeout(async () =>'), 'the close setTimeout must be async to await the fallback');
});

// ── W6-T10: system-default terminal resolver + session-env self-sufficiency ──
// lib/terminal-resolver.cjs resolves ANY system terminal ($TERMINAL first, then
// a candidate table) and repairs the session env (DISPLAY/D-Bus/Xauthority) so
// visible mode no longer depends on gnome-terminal or the stale PM2 env.

const { resolveTerminal, enrichSessionEnv, _argvFor, TERMINAL_CANDIDATES } = require('../lib/terminal-resolver.cjs');

test('W6-T10a: resolveTerminal honors $TERMINAL first, then the system default', () => {
  const r = resolveTerminal({ TERMINAL: process.env.TERMINAL || 'gnome-terminal', PATH: process.env.PATH });
  const anyCandidateOnPath = TERMINAL_CANDIDATES.some(c =>
    (process.env.PATH || '').split(path.delimiter).some(d => d && fs.existsSync(path.join(d, c.bin))));
  // Guard: headless CI with no terminal at all must not fail the suite.
  if (anyCandidateOnPath || process.env.TERMINAL) {
    assert.ok(r && r.bin, 'must resolve on this host');
  }
  const none = resolveTerminal({ PATH: '/nonexistent' });
  assert.strictEqual(none, null, 'unresolvable PATH resolves null');
});

test('W6-T10b: _argvFor builds argv per terminal style', () => {
  assert.deepStrictEqual(_argvFor('dashdash', 'gnome-terminal', '/s.sh'), ['gnome-terminal', '--wait', '--', 'bash', '/s.sh']);
  assert.deepStrictEqual(_argvFor('e', 'xterm', '/s.sh'), ['xterm', '-e', 'bash', '/s.sh']);
  assert.deepStrictEqual(_argvFor('plain', 'kitty', '/s.sh'), ['kitty', 'bash', '/s.sh']);
  // W6-T10 review: per-bin extra flags (e.g. konsole --nofork) prepend the style args.
  assert.deepStrictEqual(_argvFor('e', 'konsole', '/s.sh', ['--nofork']), ['konsole', '--nofork', '-e', 'bash', '/s.sh']);
  assert.deepStrictEqual(_argvFor('dashdash', 'kgx', '/s.sh', ['--verbose']), ['kgx', '--verbose', '--wait', '--', 'bash', '/s.sh']);

  // W6-T10 review: real-bin overrides keep close-based completion correct
  // through symlinks — the mechanism must exist in the resolver source.
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'terminal-resolver.cjs'), 'utf8');
  assert.ok(src.includes('realpathSync'), 'resolver must resolve symlinks to the real binary');
  assert.ok(src.includes('REAL_BIN_OVERRIDES'), 'resolver must apply per-real-binary overrides');
  assert.ok(src.includes("'--nofork'"), 'konsole must get --nofork (it forks by default)');
  // Host-pinned: on this host x-terminal-emulator → gnome-terminal.wrapper, so
  // the resolved style must be xterm (W7-T3: the perl wrapper swallows
  // `-- bash script`; the single-string `-e 'bash script'` convention works).
  // Real gnome-terminal binaries keep dashdash. Guarded so other hosts
  // (x-terminal-emulator → xterm, etc.) don't fail the suite.
  const r = resolveTerminal({ PATH: process.env.PATH });
  if (r) {
    try {
      const real = path.basename(fs.realpathSync(require('child_process').execSync(
        `command -v ${r.bin}`, { encoding: 'utf8' }).trim()));
      if (real === 'gnome-terminal.wrapper') {
        assert.strictEqual(r.style, 'xterm', `${r.bin} → gnome-terminal.wrapper must resolve to xterm style (W7-T3)`);
      }
      if (['gnome-terminal', 'gnome-terminal.real', 'kgx', 'gnome-console'].includes(real)) {
        assert.strictEqual(r.style, 'dashdash', `${r.bin} → ${real} must resolve to dashdash style`);
      }
      if (real === 'konsole') {
        assert.ok(r.extra && r.extra.includes('--nofork'), 'konsole target must carry --nofork');
      }
    } catch { /* realpath check is best-effort */ }
  }
});

test('W6-T10c: enrichSessionEnv fills D-Bus/runtime only when absent and existing', () => {
  const uid = os.userInfo().uid;
  const env = enrichSessionEnv({});
  if (fs.existsSync(`/run/user/${uid}/bus`)) {
    assert.strictEqual(env.DBUS_SESSION_BUS_ADDRESS, `unix:path=/run/user/${uid}/bus`);
  }
  const kept = enrichSessionEnv({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/custom' });
  assert.strictEqual(kept.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/custom', 'existing values are never overwritten');
  const input = { PATH: '/x' };
  enrichSessionEnv(input);
  assert.deepStrictEqual(input, { PATH: '/x' }, 'input object must not be mutated');
});

test('W6-T10d: luna-tools consumes the resolver (no hardcoded gnome-terminal spawn)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-tools.cjs'), 'utf8');
  assert.ok(src.includes("require('./lib/terminal-resolver.cjs')"), 'must use the resolver');
  assert.ok(!src.includes("spawn('gnome-terminal'"), 'hardcoded gnome-terminal spawn must be gone');
  assert.ok(!src.includes("execSync('which gnome-terminal')"), 'per-call which must be gone');
});

// ── W6-T11: invisible-fallback results carry a visible warning ───────────────
// All three degradation paths (resolver-null, spawn-error, ENOENT-no-log) must
// annotate the fallback result so the user learns visible mode didn't open.

test('W6e-b: fallback results carry a visible warning', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-tools.cjs'), 'utf8');
  assert.ok(src.includes('visibleFallback'), 'fallbacks must annotate the result');
  assert.ok(src.includes('modo invisível'), 'PT-BR warning text must be present');
  const count = (src.match(/fallback\.warning = /g) || []).length;
  assert.ok(count >= 3, `all three fallback sites must set the warning (found ${count})`);
  const flagCount = (src.match(/fallback\.visibleFallback = true/g) || []).length;
  assert.ok(flagCount >= 3, `all three fallback sites must set visibleFallback (found ${flagCount})`);
});

// ── W7-T3: visible terminal — xterm-style argv + invisible by default ──────
// Live bug 2026-07-12: x-terminal-emulator → gnome-terminal.wrapper (Debian
// perl wrapper) SILENTLY DROPS `-- bash script` argv → empty --wait window
// that never closes, no log, and the invisible fallback double-executes. The
// wrapper honors the xterm convention instead (ONE string after -e; it adds
// --wait itself). And visibleMode must default to false (opt-in) — under PM2
// `!detectHeadless()` was true, so every tool opened an uninvited window.

test('W7-T3a: resolver maps a gnome-terminal.wrapper realpath to xterm style', () => {
  if (process.platform === 'win32') return; // Windows requires admin rights for symlinks
  withTmpDir((dir) => {
    // Debian-style layout: a PATH-visible name whose REALPATH basename is
    // gnome-terminal.wrapper (the perl wrapper that drops `-- bash script`).
    const wrapper = path.join(dir, 'gnome-terminal.wrapper');
    fs.writeFileSync(wrapper, '#!/bin/sh\n');
    fs.symlinkSync(wrapper, path.join(dir, 'fake-terminal'));
    const r = resolveTerminal({ TERMINAL: 'fake-terminal', PATH: dir });
    assert.ok(r, 'must resolve the stub terminal');
    assert.strictEqual(r.style, 'xterm', 'gnome-terminal.wrapper realpath must resolve to xterm style, not dashdash');
  });
});

test('W7-T3b: _argvFor xterm style passes the command as ONE string after -e', () => {
  assert.deepStrictEqual(_argvFor('xterm', 'x-terminal-emulator', '/tmp/s.sh'),
    ['x-terminal-emulator', '-e', 'bash /tmp/s.sh']);
  // The Debian wrapper adds --wait itself and swallows `--`; neither may appear.
  const argv = _argvFor('xterm', 'bin', '/s.sh');
  assert.ok(!argv.includes('--wait'), 'xterm style must not add --wait (the wrapper adds it)');
  assert.ok(!argv.includes('--'), 'xterm style must not add -- (the wrapper swallows it)');
});

test('W7-T3c: luna-tools defaults visibleMode to false (visible is opt-in)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-tools.cjs'), 'utf8');
  assert.ok(/let visibleMode = false;/.test(src), 'visibleMode must default to false');
  assert.ok(!src.includes('let visibleMode = !detectHeadless()'), 'detectHeadless-based default must be gone');
});

// ── Wave 8 Task 4: atomic soul writes, real build detection, dead bridge-libs ──
// (a) Every fs.writeFileSync in luna-soul.cjs now routes through
// atomicWriteFileSync (tmp + rename in the same dir). A crash mid-write can no
// longer truncate personas/skills/memory/state/plan files.

test('W8-T4a: soul data writes are atomic — source-slice + content characterization + rename-failure safety', () => {
  const soulSrc = fs.readFileSync(path.join(__dirname, '..', 'luna-soul.cjs'), 'utf8');
  assert.ok(!soulSrc.includes('fs.writeFileSync('), 'no plain fs.writeFileSync may remain in luna-soul.cjs');
  const callSites = (soulSrc.match(/atomicWriteFileSync\(/g) || []).length;
  assert.ok(callSites >= 16, `expected >=16 atomicWriteFileSync call sites (15 converted + 1 pre-existing), got ${callSites}`);

  withTmpDir((dir) => {
    // Characterization: content written through the helper is byte-identical
    // to what a plain writeFileSync produced, on create AND on overwrite.
    const file = path.join(dir, 'persona.md');
    const content = '---\nname: test\n---\n\n# Persona\nconteúdo com acentuação\n';
    atomicWriteFileSync(file, content);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), content, 'fresh write must be byte-identical');
    const updated = content + 'extra line\n';
    atomicWriteFileSync(file, updated);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), updated, 'overwrite must be byte-identical');

    // Rename failure mid-write leaves the original file intact (and no tmp
    // leftover) — mirrors B1, pinned here for the soul data paths.
    const stateFile = path.join(dir, 'state.json');
    fs.writeFileSync(stateFile, '{"persona":"old"}');
    const originalRename = fs.renameSync;
    fs.renameSync = () => { throw new Error('injected rename failure'); };
    try {
      assert.throws(() => atomicWriteFileSync(stateFile, '{"persona":"new"}'), /injected rename failure/);
    } finally {
      fs.renameSync = originalRename;
    }
    assert.strictEqual(fs.readFileSync(stateFile, 'utf8'), '{"persona":"old"}', 'original must survive a failed rename');
    assert.strictEqual(fs.readdirSync(dir).filter(f => f.includes('.luna-tmp-')).length, 0, 'no tmp files may be left behind');
  });
});

// (b) Timeout no longer derives from the visible flag — build/install/long
// commands are detected by pattern and get 300s; everything else keeps
// opts.timeout || 60. Precedence preserved: 300s wins for build commands even
// with an explicit opts.timeout.

const { isBuildLikeCommand, resolveShellTimeout } = require('../lib/build-detect.cjs');

test('W8-T4b: build/install command detection drives a 300s timeout, decoupled from visibility', () => {
  const buildCases = [
    'npm install', 'pnpm install', 'yarn install', 'bun install',
    'npm run build', 'apt install build-essential', 'apt-get install curl',
    'pip install requests', 'pip3 install torch', 'docker build -t img .',
    'cargo build --release', 'make', 'gradle build', 'mvn package',
    'cd /tmp && npm install', 'NPM INSTALL', 'docker buildx build .',
    'npm run build:css',
  ];
  for (const cmd of buildCases) {
    assert.ok(isBuildLikeCommand(cmd), `must detect build command: ${cmd}`);
    assert.strictEqual(resolveShellTimeout(cmd, {}), 300, `build command gets 300s: ${cmd}`);
    assert.strictEqual(resolveShellTimeout(cmd, { timeout: 120 }), 300, `300s wins over explicit timeout for build: ${cmd}`);
  }
  const plainCases = ['ls -la', 'echo hello', 'git status', 'node script.js', 'npm run test',
    'cmake ..', 'cmake --build .', 'docker buildx ls', 'npm run buildx', 'apt update', 'pip list'];
  for (const cmd of plainCases) {
    assert.ok(!isBuildLikeCommand(cmd), `must NOT detect as build: ${cmd}`);
    assert.strictEqual(resolveShellTimeout(cmd, {}), 60, `default is 60s: ${cmd}`);
    assert.strictEqual(resolveShellTimeout(cmd, { timeout: 120 }), 120, `opts.timeout wins for non-build: ${cmd}`);
  }
});

// (b)+(c) Source-slices: the visible→timeout coupling is gone, the dead
// bridge-libs are deleted, and the orphan getModeUrls was removed.

test('W8-T4c: no isBuildCommand=isVisibleCommand; dead bridge-libs and getModeUrls removed', () => {
  const kernelDir = path.join(__dirname, '..');
  const toolsSrc = fs.readFileSync(path.join(kernelDir, 'luna-tools.cjs'), 'utf8');
  assert.ok(!toolsSrc.includes('isBuildCommand = isVisibleCommand'), 'timeout must not derive from the visible flag');
  assert.ok(toolsSrc.includes('resolveShellTimeout(command, opts)'), 'executeShell must resolve timeout via the detector');
  assert.ok(!fs.existsSync(path.join(kernelDir, 'bridge-libs', 'message-sender.cjs')), 'message-sender.cjs must be deleted');
  assert.ok(!fs.existsSync(path.join(kernelDir, 'bridge-libs', 'input-validator.cjs')), 'input-validator.cjs must be deleted');
  const bridgeSrc = fs.readFileSync(path.join(kernelDir, 'kimi-bridge.cjs'), 'utf8');
  assert.ok(!bridgeSrc.includes('function getModeUrls('), 'orphan getModeUrls must be removed');
  assert.ok(bridgeSrc.includes("treating as 'instant'"), 'setMode must warn + normalize invalid modes to instant');
});


// ── Fix J: destructive-operation confirmation gate (luna-soul.cjs) ──────────

const { LunaSoul } = require('../luna-soul.cjs');

test('J1: isDestructive flags explicit destructive tools', () => {
  const soul = new LunaSoul({});
  assert.strictEqual(soul.isDestructive('deleteFile', { path: 'x.txt' }), true);
  assert.strictEqual(soul.isDestructive('removeDirectory', { path: 'foo' }), true);
  assert.strictEqual(soul.isDestructive('dashboardDeleteTask', { id: 1 }), true);
  assert.strictEqual(soul.isDestructive('readFile', { path: 'x.txt' }), false);
  assert.strictEqual(soul.isDestructive('writeFile', { path: 'x.txt', content: 'a' }), false);
});

test('J2: isDestructive flags destructive shell patterns', () => {
  const soul = new LunaSoul({});
  const destructive = [
    'rm -rf /',
    'rm -r /tmp',
    'rm *.log',
    'dd if=/dev/zero of=/dev/sda',
    'mkfs.ext4 /dev/sdb1',
    'git reset --hard',
    'git clean -fd',
  ];
  for (const cmd of destructive) {
    assert.strictEqual(soul.isDestructive('executeShell', { command: cmd }), true, `expected ${cmd} to be destructive`);
  }
  const safe = ['ls -la', 'git status', 'echo hello', 'cat file.txt'];
  for (const cmd of safe) {
    assert.strictEqual(soul.isDestructive('executeShell', { command: cmd }), false, `expected ${cmd} to be safe`);
  }
});

test('J3: isDestructive respects autoConfirmDestructive', () => {
  const soul = new LunaSoul({ autoConfirmDestructive: true });
  assert.strictEqual(soul.isDestructive('deleteFile', { path: 'x.txt' }), false);
  assert.strictEqual(soul.isDestructive('executeShell', { command: 'rm -rf /' }), false);
});

test('J4: _requestConfirmation emits a confirmation_required event and resolves on confirm', async () => {
  const soul = new LunaSoul({});
  const sessionId = 'test-session-confirm';
  let captured = null;
  soul.on('confirmation_required', (ev) => { captured = ev; });

  const promise = soul._requestConfirmation('deleteFile', { path: 'x.txt' }, sessionId);
  assert.ok(captured, 'confirmation_required should be emitted synchronously');
  assert.strictEqual(captured.tool, 'deleteFile');
  assert.strictEqual(captured.sessionId, sessionId);
  assert.ok(captured.confirmationId, 'confirmationId must be present');

  const confirmResult = soul.confirmAction(sessionId, captured.confirmationId, 'confirm');
  assert.strictEqual(confirmResult.ok, true);
  assert.strictEqual(confirmResult.confirmed, true);

  const resolved = await promise;
  assert.strictEqual(resolved.confirmed, true);
});

test('J5: canceling a confirmation returns a user-canceled result', async () => {
  const soul = new LunaSoul({});
  const sessionId = 'test-session-cancel';
  let captured = null;
  soul.on('confirmation_required', (ev) => { captured = ev; });

  const promise = soul._requestConfirmation('deleteFile', { path: 'x.txt' }, sessionId);
  const cancelResult = soul.confirmAction(sessionId, captured.confirmationId, 'cancel');
  assert.strictEqual(cancelResult.ok, true);
  assert.strictEqual(cancelResult.confirmed, false);

  const resolved = await promise;
  assert.strictEqual(resolved.confirmed, false);
  assert.ok(/cancel/i.test(resolved.error), `error should mention cancel, got ${resolved.error}`);
});

test('J6: confirmAction returns error for unknown/expired confirmation', () => {
  const soul = new LunaSoul({});
  const res = soul.confirmAction('no-such-session', 'no-such-id', 'confirm');
  assert.strictEqual(res.ok, false);
});
