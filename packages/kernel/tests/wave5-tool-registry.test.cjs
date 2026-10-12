// wave5-tool-registry.test.cjs — Wave 5 regression tests (tool registry, modularization Phase 0+1)
// T1/P0: characterization net — pins guard schema behavior (accept/reject matrix for all 12
//        schemas + alias normalization + fail-open + checksum drift). The three Phase-0 CARVE-OUT
//        blocks were RESOLVED in Task 5 (P0-2 → 5a, P0-3 → 5c, P0-11 → 5b) and now pin the fixed behavior.
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
// (required + absolute on the alias value). Not repeated here.

test('P0-1: readFile — path required (string), numeric offsets, pathMustExist NOT enforced', () => {
  assert.strictEqual(validateToolCall('readFile', { path: '/etc/hostname' }), true);
  assert.strictEqual(validateToolCall('readFile', { path: '/definitely/not/there-luna-p0' }), true,
    'pathMustExist is declared in the schema but NOT enforced by validateToolCall — pin it');
  assert.strictEqual(validateToolCall('readFile', { path: '/etc/hostname', line_offset: 10, n_lines: 5 }), true);
  rejects('readFile', {}, /campo obrigatório "path"/);
  rejects('readFile', { path: 42 }, /"path" deve ser string/);
  rejects('readFile', { path: '/etc/hostname', line_offset: '10' }, /"line_offset" deve ser number/);
});

test('P0-2: writeFile — path+content required, absolute enforced, .. and ~ ACCEPTED (5a resolved)', () => {
  assert.strictEqual(validateToolCall('writeFile', { path: '/abs/x', content: 'c' }), true);
  rejects('writeFile', { path: '/abs/x' }, /campo obrigatório "content"/);
  rejects('writeFile', { path: 'rel/x', content: 'c' }, /deve ser absoluto/);
  rejects('writeFile', { path: '/abs/x', content: 42 }, /"content" deve ser string/);
  // 5a RESOLVED: writeFile schema no longer rejects '..' or '~' — the soul's
  // realpath path-guard (lib/path-guard.cjs) is the traversal authority.
  assert.strictEqual(validateToolCall('writeFile', { path: '/abs/../sibling', content: 'c' }), true);
  assert.strictEqual(validateToolCall('writeFile', { path: '/abs/~user/x', content: 'c' }), true);
  // The absolute-path check is untouched: '~'-prefixed paths were always rejected
  // by pathMustBeAbsolute BEFORE pathMustNotContain ever fired.
  rejects('writeFile', { path: '~/notes.md', content: 'c' }, /deve ser absoluto/);
});

test('P0-3: replaceInFile — path/old/new required + absolute; oldStr/newStr ACCEPTED (5c resolved)', () => {
  assert.strictEqual(validateToolCall('replaceInFile', { path: '/abs/x', old: 'a', new: 'b' }), true);
  rejects('replaceInFile', { path: '/abs/x', new: 'b' }, /campo obrigatório "old"/);
  rejects('replaceInFile', { path: 'rel', old: 'a', new: 'b' }, /deve ser absoluto/);
  // 5c RESOLVED: schema accepts the oldStr/newStr aliases the dispatch already took.
  assert.strictEqual(validateToolCall('replaceInFile', { path: '/abs/x', oldStr: 'a', newStr: 'b' }), true);
  assert.strictEqual(validateToolCall('replaceInFile', { path: '/abs/x', old: 'a', newStr: 'b' }), true, 'mixed aliases normalize');
  rejects('replaceInFile', { path: '/abs/x', oldStr: 42, newStr: 'b' }, /"old" deve ser string/,
    'type check applies to the normalized alias value');
  rejects('replaceInFile', { path: '/abs/x' }, /campo obrigatório "old"/);
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

// Review follow-up (Task 1): wrong-type pins for every schema field left unpinned,
// so the Task 3 migration proof can't pass with a silently dropped `types` entry.
test('P0-12: wrong-type rejects pinned for every remaining schema field', () => {
  rejects('readFile', { path: '/etc/hostname', n_lines: '5' }, /"n_lines" deve ser number/);
  rejects('writeFile', { path: 42, content: 'c' }, /"path" deve ser string/);
  rejects('replaceInFile', { path: 42, old: 'a', new: 'b' }, /"path" deve ser string/);
  rejects('replaceInFile', { path: '/abs/x', old: 42, new: 'b' }, /"old" deve ser string/);
  rejects('replaceInFile', { path: '/abs/x', old: 'a', new: 42 }, /"new" deve ser string/);
  rejects('appendFile', { path: 42, content: 'c' }, /"path" deve ser string/);
  rejects('appendFile', { path: '/abs/x', content: 42 }, /"content" deve ser string/);
  rejects('deleteFile', { path: 42 }, /"path" deve ser string/);
  rejects('ipython', { code: 42 }, /"code" deve ser string/);
  rejects('browser', { url: 42 }, /"url" deve ser string/);
  rejects('computer', { action: 42 }, /"action" deve ser string/);
  rejects('computer', { action: 'click', y: '20' }, /"y" deve ser number/);
  rejects('computer', { action: 'click', text: 42 }, /"text" deve ser string/);
  rejects('glob', { pattern: 42 }, /"pattern" deve ser string/);
  rejects('grep', { pattern: 42 }, /"pattern" deve ser string/);
  rejects('grep', { pattern: 'foo', type: 42 }, /"type" deve ser string/);
  rejects('validateProject', { path: 42 }, /"path" deve ser string/);
});

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

// ── T4: frontend metadata codegen ────────────────────────────────────────────

test('T4: committed toolMeta.generated.js is byte-identical to a fresh render (no drift)', () => {
  const { render } = require(path.join(REPO, 'scripts/gen-tool-meta.cjs'));
  const committed = fs.readFileSync(
    path.join(REPO, 'packages/kernel/luna-web/src/lib/toolMeta.generated.js'), 'utf8');
  assert.strictEqual(committed, render(),
    'generated file is stale — regenerate with: node scripts/gen-tool-meta.cjs');
});

test('T4: generated maps match the pre-Wave-5 ToolCard maps exactly (behavior-neutral; W6-T11 added the visible-mode entries)', () => {
  const { TOOL_COLORS, TOOL_ICONS } = require('../luna-web/src/lib/toolMeta.generated.js');
  assert.deepStrictEqual(TOOL_COLORS, {
    writeFile: '#3b82f6', readFile: '#22c55e', executeShell: '#a855f7',
    searchWeb: '#f97316', searchFiles: '#f97316', gitStatus: '#6b7280',
    gitDiff: '#6b7280', gitLog: '#6b7280', gitCommit: '#6b7280',
    dashboardCreateTask: '#ec4899', dashboardListTasks: '#ec4899',
    dashboardCreateLead: '#ec4899', dashboardListLeads: '#ec4899',
    dashboardGetFinanceSummary: '#ec4899', replaceInFile: '#06b6d4',
    ipython: '#f59e0b', web_search: '#f97316', browser: '#3b82f6',
    setVisibleMode: '#22c55e', getVisibleMode: '#94a3b8',
  });
  assert.deepStrictEqual(TOOL_ICONS, {
    writeFile: '📄', readFile: '👁', executeShell: '⚡',
    searchWeb: '🌐', searchFiles: '🔍', gitStatus: '🌿',
    gitDiff: '📊', gitLog: '📜', gitCommit: '💾',
    dashboardCreateTask: '📋', dashboardListTasks: '📋',
    dashboardCreateLead: '👤', dashboardListLeads: '👥',
    dashboardGetFinanceSummary: '💰', replaceInFile: '✏️',
    ipython: '🐍', web_search: '🌐', browser: '🌍',
    setVisibleMode: '👁', getVisibleMode: '🙈',
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

// Wave 8 (T3b): internal tools carry meta.hidden in the registry and the
// generated frontend meta must mirror those flags exactly.
test('T4: generated TOOL_HIDDEN matches the registry meta.hidden flags (Wave 8)', () => {
  const { TOOL_REGISTRY } = require('../lib/tool-registry.cjs');
  const { TOOL_HIDDEN } = require('../luna-web/src/lib/toolMeta.generated.js');
  const expected = {};
  for (const [name, entry] of Object.entries(TOOL_REGISTRY)) {
    if (entry.meta && entry.meta.hidden) expected[name] = true;
  }
  assert.deepStrictEqual(TOOL_HIDDEN, expected, 'generated TOOL_HIDDEN must mirror registry meta.hidden');
  for (const name of ['think', 'getVisibleMode', 'setVisibleMode', 'getCurrentDirectory']) {
    assert.strictEqual(TOOL_HIDDEN[name], true, `${name} must be flagged hidden`);
  }
});
