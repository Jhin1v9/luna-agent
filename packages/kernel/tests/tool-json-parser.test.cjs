'use strict';

// v12.0: unit tests for the unified tolerant tool-JSON parser.
// Covers the real-world failure modes that used to drop tools/responses:
// truncation, missing commas, single quotes, prose+JSON mixes, code blocks,
// and writeFile payloads with HTML/JS inside string values (Wave 8 case).

const test = require('node:test');
const assert = require('node:assert');
const { parseToolJson, detectIntent, extractStringField } = require('../lib/tool-json-parser.cjs');

test('clean wrapper: strict parse fast path', () => {
  const r = parseToolJson('{"response": "olá"}');
  assert.strictEqual(r.kind, 'response');
  assert.strictEqual(r.text, 'olá');
  assert.strictEqual(r.repaired, false);
});

test('tool wrapper with params', () => {
  const r = parseToolJson('{"tool": "executeShell", "params": {"command": "ls -la"}}');
  assert.strictEqual(r.kind, 'tool');
  assert.strictEqual(r.tool, 'executeShell');
  assert.strictEqual(r.params.command, 'ls -la');
});

test('truncated JSON is repaired (missing closing braces)', () => {
  const r = parseToolJson('{"tool": "executeShell", "params": {"command": "npm test"');
  assert.strictEqual(r.kind, 'tool');
  assert.strictEqual(r.tool, 'executeShell');
  assert.strictEqual(r.params.command, 'npm test');
});

test('truncated string value is closed by repair', () => {
  const r = parseToolJson('{"response": "a resposta ficou cortada no mei');
  assert.strictEqual(r.kind, 'response');
  assert.ok(r.text.includes('cortada'));
});

test('missing comma between fields', () => {
  const r = parseToolJson('{"tool": "readFile" "params": {"filePath": "/tmp/a.txt"}}');
  assert.strictEqual(r.kind, 'tool');
  assert.strictEqual(r.tool, 'readFile');
});

test('single quotes are repaired', () => {
  const r = parseToolJson("{'tool': 'listFiles', 'params': {'path': '.'}}");
  assert.strictEqual(r.kind, 'tool');
  assert.strictEqual(r.tool, 'listFiles');
});

test('trailing commas are repaired', () => {
  const r = parseToolJson('{"tool": "listFiles", "params": {"path": ".",},}');
  assert.strictEqual(r.kind, 'tool');
});

test('script wrapper maps to script kind with language', () => {
  const r = parseToolJson('{"script": "echo hi", "language": "bash"}');
  assert.strictEqual(r.kind, 'script');
  assert.strictEqual(r.script, 'echo hi');
  assert.strictEqual(r.language, 'bash');
});

test('writeFile with HTML/JS inside string (Wave 8 case)', () => {
  const html = '<!DOCTYPE html><html><script>if (a) { b("}"); }</script></html>';
  const payload = JSON.stringify({ tool: 'writeFile', params: { filePath: '/tmp/x.html', content: html } });
  const r = parseToolJson(payload);
  assert.strictEqual(r.kind, 'tool');
  assert.strictEqual(r.tool, 'writeFile');
  assert.strictEqual(r.params.content, html);
});

test('writeFile with unescaped quotes inside content is rescued field-by-field', () => {
  // model emitted raw quotes inside the string — strict parse must fail
  const broken = '{"tool": "writeFile", "params": {"filePath": "/tmp/x.txt", "content": "ele disse "oi" e saiu"}}';
  assert.throws(() => JSON.parse(broken));
  const r = parseToolJson(broken);
  assert.strictEqual(r.kind, 'tool');
  assert.strictEqual(r.tool, 'writeFile');
  assert.strictEqual(r.params.filePath, '/tmp/x.txt');
  assert.ok(r.params.content.includes('oi'));
});

test('fenced code block + prose prefix (wrapper inside markdown)', () => {
  const r = parseToolJson('Aqui está:\n```json\n{"response": "feito"}\n```');
  // cleanWrapperText strips only leading fences; prose prefix makes it non-JSON
  // — the parser must still avoid crashing and return something usable.
  assert.ok(r === null || r.kind === 'prose' || r.kind === 'response');
});

test('Kimi DOM header "JSON Copy" is stripped before parse', () => {
  const r = parseToolJson('JSON\nCopy\n{"response": "ok"}');
  assert.strictEqual(r.kind, 'response');
  assert.strictEqual(r.text, 'ok');
});

test('pure prose returns kind prose (never null for non-empty text)', () => {
  const r = parseToolJson('Claro! Aqui está a explicação sem nenhum JSON.');
  assert.strictEqual(r.kind, 'prose');
  assert.ok(r.text.length > 0);
});

test('bare shell code block is prose with suspected executeShell intent', () => {
  const r = parseToolJson('```bash\nnpm install && npm run build\n```');
  assert.strictEqual(r.kind, 'prose');
  assert.strictEqual(r.suspectedTool, 'executeShell');
  assert.ok(r.suspectedParams.command.includes('npm install'));
});

test('empty and whitespace input returns null', () => {
  assert.strictEqual(parseToolJson(''), null);
  assert.strictEqual(parseToolJson('   \n  '), null);
  assert.strictEqual(parseToolJson(null), null);
});

test('malformed response wrapper {"success":true,"mode":"RESPONSE","message":...}', () => {
  const r = parseToolJson('{"success":true,"mode":"RESPONSE","message":"tudo certo"}');
  assert.strictEqual(r.kind, 'response');
  assert.strictEqual(r.text, 'tudo certo');
});

test('extractStringField tolerates unescaped quotes and truncation', () => {
  const t = '"content": "linha1\ncom "aspas" e fim truncado';
  const v = extractStringField(t, 'content');
  assert.ok(v.includes('aspas'));
  assert.ok(v.includes('truncado'));
});

test('detectIntent on empty text returns null', () => {
  assert.strictEqual(detectIntent(''), null);
  assert.strictEqual(detectIntent('   '), null);
});

// ── v12.1: truncation safety — partial params must NEVER auto-execute ──

test('truncated tool JSON is flagged truncated (partial params)', () => {
  const r = parseToolJson('{"tool": "deleteFile", "params": {"path": "/home/elias');
  assert.strictEqual(r.kind, 'tool');
  assert.strictEqual(r.tool, 'deleteFile');
  assert.strictEqual(r.truncated, true, 'truncated flag must be set so callers refuse to execute');
});

test('complete-but-malformed tool JSON is rescued WITHOUT truncated flag', () => {
  const r = parseToolJson("{'tool': 'deleteFile', 'params': {'path': '/tmp/x.txt',},}");
  assert.strictEqual(r.kind, 'tool');
  assert.strictEqual(r.params.path, '/tmp/x.txt');
  assert.ok(!r.truncated, 'balanced input is safe to execute');
});

test('jsonrepair fragment {"tool": null} does NOT become a tool call', () => {
  const r = parseToolJson('{"tool');
  assert.ok(!r || r.kind !== 'tool', 'fragment must not dispatch as tool (was "Ferramenta desconhecida: undefined")');
});

test('truncated response JSON still returns partial text (safe to display)', () => {
  const r = parseToolJson('{"response": "texto cortado no mei');
  assert.strictEqual(r.kind, 'response');
  assert.ok(r.text.includes('texto cortado'));
});

test('isBalancedJson: balanced vs truncated vs mid-string', () => {
  const { isBalancedJson } = require('../lib/tool-json-parser.cjs');
  assert.strictEqual(isBalancedJson('{"a":1}'), true);
  assert.strictEqual(isBalancedJson('{"a": {"b": 2}}'), true);
  assert.strictEqual(isBalancedJson('{"a": "x'), false);
  assert.strictEqual(isBalancedJson('{"a": "'), false);
  assert.strictEqual(isBalancedJson('sem json'), false);
  // braces inside strings don't count
  assert.strictEqual(isBalancedJson('{"a": "}"}'), true);
});
