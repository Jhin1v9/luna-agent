/**
 * luna-tool-guard.cjs — Resiliência, Segurança e Validação para Tool Calls
 *
 * Implementa 7 padrões identificados pelo Kimi Web:
 *   1. Retry com backoff (exponential jitter)
 *   2. Circuit breaker (detecta loop de mesma tool)
 *   3. Idempotency keys (evita duplicação)
 *   4. Schema validation (valida JSON de ações)
 *   5. Timeout nas tool calls
 *   6. Checksum de arquivo antes de editar (detecta drift)
 *   7. Checkpoint / Savepoint por step (git stash + apply)
 */

const fs = require('fs');
const crypto = require('crypto');
const { clampExecTimeout } = require('./lib/exec-timeout.cjs');
const { buildToolSchemas } = require('./lib/tool-registry.cjs');
const path = require('path');

// ── Config ──
const RETRY_MAX = 3;
const RETRY_BASE_MS = 300;
const RETRY_MAX_MS = 5000;
const TOOL_TIMEOUT_MS = 30000;       // 30s para shell/read
const SHELL_TIMEOUT_MS = 120000;     // 2min para npm test/build
const CIRCUIT_WINDOW_MS = 60000;     // 1min janela para detectar loop
const CIRCUIT_THRESHOLD = 3;         // 3 calls iguais = loop

// ── 1. Retry com Backoff ──
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function jitter(baseMs, attempt) {
  const exp = Math.min(attempt, 5);
  const delay = Math.min(baseMs * Math.pow(2, exp), RETRY_MAX_MS);
  const jittered = delay * (0.5 + Math.random() * 0.5);
  return Math.floor(jittered);
}

async function withRetry(fn, options = {}) {
  const maxRetries = options.maxRetries || RETRY_MAX;
  const baseMs = options.baseMs || RETRY_BASE_MS;
  const label = options.label || 'tool call';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable =
        err.message?.includes('EAGAIN') ||
        err.message?.includes('EBUSY') ||
        err.message?.includes('EMFILE') ||
        err.message?.includes('ENFILE') ||
        err.message?.includes('EACCES') ||
        err.message?.includes('EPERM') ||
        err.message?.includes('lock') ||
        err.message?.includes('temporarily') ||
        err.message?.includes('timeout') ||
        err.code === 'EAGAIN' ||
        err.code === 'EBUSY';

      if (!isRetryable || attempt >= maxRetries) {
        throw err;
      }

      const delay = jitter(baseMs, attempt);
      console.log(`[tool-guard] Retry ${attempt + 1}/${maxRetries} for "${label}" in ${delay}ms: ${err.message}`);
      await sleep(delay);
    }
  }
}

// ── 2. Circuit Breaker ──
class CircuitBreaker {
  constructor() {
    this.history = new Map(); // toolSignature -> [{ timestamp, count }]
  }

  _signature(toolName, params) {
    // Normaliza params para comparação
    const normalized = JSON.stringify(params, Object.keys(params || {}).sort());
    return `${toolName}::${normalized}`;
  }

  check(toolName, params) {
    const sig = this._signature(toolName, params);
    const now = Date.now();
    const windowStart = now - CIRCUIT_WINDOW_MS;

    // Limpar entradas antigas
    if (this.history.has(sig)) {
      const entries = this.history.get(sig).filter(e => e.timestamp > windowStart);
      this.history.set(sig, entries);

      if (entries.length >= CIRCUIT_THRESHOLD) {
        const err = new Error(`Circuit breaker: tool "${toolName}" chamada ${entries.length}x com os mesmos params em ${CIRCUIT_WINDOW_MS / 1000}s. Possível loop do LLM.`);
        err.code = 'CIRCUIT_OPEN';
        throw err;
      }
    }
  }

  record(toolName, params) {
    const sig = this._signature(toolName, params);
    if (!this.history.has(sig)) this.history.set(sig, []);
    this.history.get(sig).push({ timestamp: Date.now() });
  }

  reset(toolName, params) {
    const sig = this._signature(toolName, params);
    this.history.delete(sig);
  }
}

// ── 3. Idempotency Keys ──
// v13.0 (F3.2): 60s is enough to break an LLM retry loop; the old 10-minute
// window silently skipped legitimate intentional re-executions.
const IDEMPOTENCY_TTL_MS = 60 * 1000;

class IdempotencyStore {
  constructor(nowFn = Date.now) {
    this.keys = new Map(); // idempotencyKey -> timestamp
    this.nowFn = nowFn;
  }

  generateKey(toolName, params) {
    const hash = crypto.createHash('sha256')
      .update(`${toolName}::${JSON.stringify(params)}`)
      .digest('hex')
      .slice(0, 16);
    return hash;
  }

  isProcessed(key) {
    if (!this.keys.has(key)) return false;
    if (this.nowFn() - this.keys.get(key) >= IDEMPOTENCY_TTL_MS) {
      this.keys.delete(key); // expired: allow a legitimate re-execution
      return false;
    }
    return true;
  }

  markProcessed(key) {
    this.keys.set(key, this.nowFn());
  }

  clear() {
    this.keys.clear();
  }
}

// ── 4. Schema Validation ──
// Wave 5: schemas live in the single tool registry (lib/tool-registry.cjs).
// TOOL_SCHEMAS is DERIVED from it — identical content to the pre-Wave-5 inline
// map, proven by the Phase 0 characterization net (wave5-tool-registry.test.cjs).
const TOOL_SCHEMAS = buildToolSchemas();

// Wave 3 (Fix H): tools sem schema estrito validam contra um default permissivo
// (fail-open, warn-once) em vez de derrubar a tool call. Wave 5: os schemas
// migraram para lib/tool-registry.cjs (fonte única); tools sem entry de schema
// seguem no fail-open até ganharem schemas no registry.
const DEFAULT_SCHEMA = { required: [], types: {} };

// v13.0 (F3.3): single alias normalizer — every known alias resolves to the
// canonical schema field. Applied IN PLACE at the execution entry point so
// validation, dispatch and execution all see the same names (the old code
// normalized a validation-only copy and only knew oldStr/newStr, so
// old_string/oldString died in validation or dispatch).
const PARAM_ALIASES = {
  replaceInFile: {
    old: ['oldStr', 'oldString', 'old_string', 'oldText'],
    new: ['newStr', 'newString', 'new_string', 'newText'],
  },
};

function normalizeToolParams(toolName, params) {
  const aliases = PARAM_ALIASES[toolName];
  if (!aliases || !params) return params;
  for (const [canonical, names] of Object.entries(aliases)) {
    if (params[canonical] !== undefined && params[canonical] !== null) continue;
    for (const name of names) {
      if (params[name] !== undefined && params[name] !== null) {
        params[canonical] = params[name];
        break;
      }
    }
  }
  return params;
}

function validateToolCall(toolName, params) {
  let schema = TOOL_SCHEMAS[toolName];
  if (!schema) {
    if (!validateToolCall._warned.has(toolName)) {
      validateToolCall._warned.add(toolName);
      console.warn(`[tool-guard] Sem schema estrito para "${toolName}" — validação permissiva (fail-open; schemas vivem em lib/tool-registry.cjs).`);
    }
    schema = DEFAULT_SCHEMA;
  }

  // Alias-aware: o dispatch do soul aceita path/filePath/file (e source/from em
  // move/copy). Normaliza numa cópia para não mutar os params do chamador.
  const p = { ...params };
  if ((schema.required || []).includes('path') && (p.path === undefined || p.path === null)) {
    if (p.filePath !== undefined && p.filePath !== null) p.path = p.filePath;
    else if (p.file !== undefined && p.file !== null) p.path = p.file;
  }
  // v13.0 (F3.3): full alias set via the central normalizer (copy-based here;
  // execute() normalizes the real params in place before calling us).
  if (toolName === 'replaceInFile') {
    normalizeToolParams(toolName, p);
  }
  const pathValue = p.path || p.filePath || p.source || p.from;

  // Check required fields
  for (const field of schema.required || []) {
    if (p[field] === undefined || p[field] === null) {
      throw new Error(`Schema validation: campo obrigatório "${field}" faltando em "${toolName}".`);
    }
  }

  // Check types
  for (const [field, expectedType] of Object.entries(schema.types || {})) {
    if (p[field] !== undefined && typeof p[field] !== expectedType) {
      throw new Error(`Schema validation: campo "${field}" deve ser ${expectedType}, recebeu ${typeof p[field]} em "${toolName}".`);
    }
  }

  // Check path constraints (no valor resolvido via alias, não só em params.path)
  if (schema.pathMustBeAbsolute && pathValue && !path.isAbsolute(pathValue)) {
    throw new Error(`Schema validation: path "${pathValue}" deve ser absoluto em "${toolName}".`);
  }

  if (schema.pathMustNotContain) {
    for (const forbidden of schema.pathMustNotContain) {
      if (pathValue && pathValue.includes(forbidden)) {
        throw new Error(`Schema validation: path "${pathValue}" contém padrão proibido "${forbidden}" em "${toolName}".`);
      }
    }
  }

  // Check forbidden patterns in shell commands
  if (schema.forbiddenPatterns) {
    for (const pattern of schema.forbiddenPatterns) {
      if (pattern.test(p.command)) {
        throw new Error(`Schema validation: comando proibido detectado em "${toolName}": ${p.command}`);
      }
    }
  }

  return true;
}
validateToolCall._warned = new Set();

// ── 4b. Python Sandbox (AST-light import deny-list) ──
// v3.4: os/pathlib/sys are allowed — ipython runs on the user's REAL PC,
// and the prompt explicitly tells Kimi Web that os/pathlib are fine.
// v5.3: TRAVAS DE SEGURANÇA REMOVIDAS — DONO ABSOLUTO tem controle total.
// A Luna pode usar subprocess, os, shutil, socket, ctypes, eval, exec, etc.
// PYTHON_FORBIDDEN_IMPORTS = [];
// PYTHON_DANGEROUS_BUILTINS = [];

function validatePythonCode(code) {
  if (!code || typeof code !== 'string') return { ok: false, reason: 'código vazio' };
  // TODAS as restrições removidas — a Luna tem permissão total para executar qualquer código Python.
  return { ok: true };
}

// ── 4c. Destructive Operation Detection ──
const DESTRUCTIVE_PATTERNS = [
  { pattern: /^\s*rm\s+/, message: 'Remoção de arquivo/pasta (rm)' },
  { pattern: /^\s*chmod\s+/, message: 'Alteração de permissões (chmod)' },
  { pattern: /^\s*chown\s+/, message: 'Alteração de propriedade (chown)' },
  { pattern: /^\s*curl\s+.*-F[\s\"\'=]/i, message: 'Upload de arquivo (curl -F)' },
  { pattern: /~\/\.ssh/, message: 'Acesso a ~/.ssh' },
  { pattern: /^\s*mkfs/, message: 'Formatação de disco (mkfs)' },
  { pattern: /^\s*dd\s+if=/, message: 'Escrita de disco raw (dd)' },
  { pattern: /^\s*sudo\s+/, message: 'Escalada de privilégio (sudo)' },
];

function checkDestructivePattern(command) {
  if (!command || typeof command !== 'string') return null;
  for (const { pattern, message } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return { destructive: true, message, pattern: pattern.toString() };
    }
  }
  return null;
}

// ── 5. Timeout Wrapper ──
// NOTA (Wave 3, Fix H): este race apenas REJEITA a promise — não mata trabalho
// em andamento. Só executeShell ganha kill real: o timeout do guard é alinhado
// com o timer próprio do safeExec (Fix D), que mata o process group. Os demais
// toolFns são cooperativos (o guard desiste de esperar, o trabalho continua).
function withTimeout(promise, ms, label = 'operation') {
  // Handle non-Promise values (sync tool functions)
  if (!promise || typeof promise.then !== 'function') {
    return Promise.resolve(promise);
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timeout: "${label}" excedeu ${ms}ms`));
    }, ms);
  });
  // Limpa o timer quando a promise settle (resolve OU reject) — o antigo
  // promise.finally(...).catch(...) criava um caminho de unhandled rejection
  // quando o timeout vencia a race.
  promise.then(() => clearTimeout(timer), () => clearTimeout(timer));

  return Promise.race([promise, timeout]);
}

// ── 6. Checksum de Arquivo (Anti-Drift) ──
function computeChecksum(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

class FileChecksumCache {
  constructor() {
    this.cache = new Map(); // path -> { checksum, timestamp }
  }

  record(filePath) {
    const checksum = computeChecksum(filePath);
    if (checksum) {
      this.cache.set(filePath, { checksum, timestamp: Date.now() });
    }
    return checksum;
  }

  verify(filePath) {
    const entry = this.cache.get(filePath);
    if (!entry) return { ok: true, reason: 'no prior checksum' };

    const current = computeChecksum(filePath);
    if (!current) return { ok: false, reason: 'file deleted' };

    if (current !== entry.checksum) {
      return {
        ok: false,
        reason: `drift detectado: checksum mudou de ${entry.checksum} para ${current}`,
        oldChecksum: entry.checksum,
        newChecksum: current,
      };
    }

    return { ok: true, reason: 'checksum match' };
  }

  clear(filePath) {
    this.cache.delete(filePath);
  }
}

// ── 7. Checkpoint / Savepoint por Step ──
class StepCheckpoint {
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
    this.checkpoints = []; // [{ stepIndex, stashRef, timestamp, description }]
  }

  async create(stepIndex, description = '') {
    const stashName = `luna-step-${stepIndex}-${Date.now()}`;
    try {
      const { execSync } = require('child_process');
      execSync(
        `cd "${this.workspacePath}" && git stash push -m "${stashName}" --include-untracked`,
        { encoding: 'utf8', timeout: 10000 }
      );
      this.checkpoints.push({
        stepIndex,
        stashRef: stashName,
        timestamp: Date.now(),
        description,
      });
      return { success: true, stashRef: stashName };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async rollbackTo(stepIndex) {
    const cp = this.checkpoints.find(c => c.stepIndex === stepIndex);
    if (!cp) {
      return { success: false, error: `Checkpoint do step ${stepIndex} não encontrado` };
    }

    try {
      const { execSync } = require('child_process');
      // Pop stash para restaurar estado
      execSync(
        `cd "${this.workspacePath}" && git stash pop stash@{${this.checkpoints.indexOf(cp)}}`,
        { encoding: 'utf8', timeout: 10000 }
      );
      return { success: true, restoredTo: stepIndex };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async undoLast() {
    if (this.checkpoints.length === 0) {
      return { success: false, error: 'Nenhum checkpoint para desfazer' };
    }
    const last = this.checkpoints[this.checkpoints.length - 1];
    return this.rollbackTo(last.stepIndex);
  }

  list() {
    return this.checkpoints.map((c, i) => ({
      index: i,
      stepIndex: c.stepIndex,
      description: c.description,
      timestamp: new Date(c.timestamp).toISOString(),
    }));
  }
}

// ── Guard Wrapper — Combina TUDO ──
// v13.0 (F3.2): idempotency classification is SEMANTIC, not name-regex-based.
// The old MUTATING_TOOL_RE classified executeShell/executeScript as always
// mutating, so read-only commands (`cat`, `ls`, `git status`...) were skipped
// as "already processed" on any identical re-run. Now shell commands are
// classified by analyzing the command itself against a read-only whitelist.
const READONLY_TOOLS = new Set([
  'readFile', 'viewDirectory', 'listFiles', 'getFileInfo', 'searchFiles', 'grep',
  'glob', 'gitStatus', 'gitDiff', 'gitLog', 'getCurrentDirectory', 'searchWeb',
  'fetchURL', 'clipboardRead',
]);
const MUTATING_TOOLS = new Set([
  'writeFile', 'appendFile', 'replaceInFile', 'deleteFile', 'moveFile',
  'copyFile', 'gitCommit', 'applyPatch', 'installPackages', 'clipboardWrite',
]);
const READONLY_COMMAND_RE = /^\s*(?:cat|ls|ll|grep|find|head|tail|wc|which|echo|pwd|env|printenv|date|uname|whoami|hostname|df|du|free|uptime|file|stat|readlink|realpath|basename|dirname|rg|git\s+(?:status|log|diff|branch|remote|show|describe|rev-parse|ls-files|blame|shortlog|config\s+--(?:get|list|local --list))\b|node\s+--version|npm\s+--version|pnpm\s+--version|python3?\s+--version)\b/;

function isMutatingToolCall(toolName, params = {}) {
  if (READONLY_TOOLS.has(toolName)) return false;
  if (MUTATING_TOOLS.has(toolName)) return true;
  if (toolName === 'executeShell' || toolName === 'executeScript') {
    const cmd = String(params.command || params.code || params.script || '');
    return !READONLY_COMMAND_RE.test(cmd);
  }
  if (/^dashboard(?:Create|Update|Delete|Complete|Pay|Receive|Add|Send|Vote|Control|Enrich|Sync|Mark|Quick|Adjust|Reconcile)/.test(toolName)) return true;
  // Unknown tools (incl. dashboard reads): never idempotency-skipped — reads
  // are freely repeatable (Wave 3 H3 intent preserved).
  return false;
}

class ToolGuard {
  constructor(workspacePath) {
    this.circuit = new CircuitBreaker();
    this.idempotency = new IdempotencyStore();
    this.checksums = new FileChecksumCache();
    this.checkpoints = new StepCheckpoint(workspacePath);
    this.workspacePath = workspacePath;
  }

  async execute(toolName, params, toolFn, options = {}) {
    const label = `${toolName}(${JSON.stringify(params).slice(0, 80)})`;

    // 4. Schema validation
    // v13.0 (F3.3): normalize parameter aliases IN PLACE first, so validation,
    // the soul dispatch closure and the tool itself all see canonical names.
    normalizeToolParams(toolName, params);
    validateToolCall(toolName, params);

    // 5. Timeout budget — computed BEFORE the circuit check because the
    // executeShell clamp below mutates params.timeout, and check/record must
    // sign the SAME params or the breaker can never trip (Wave 3 review I1).
    const timeoutMs = toolName === 'executeShell' && params.command?.includes('test')
      ? SHELL_TIMEOUT_MS
      : TOOL_TIMEOUT_MS;

    // Wave 3 (Fix H4): alinha o timeout do guard com o kill real do executeShell.
    // safeExec (Fix D) mata o process group quando opts.timeout > 0; sem o clamp,
    // o guard rejeitaria a promise mas o filho continuaria vivo até o default
    // interno. `params` aqui é a MESMA referência `p` que a toolFn lambda do soul
    // fecha sobre (luna-soul.cjs execute dispatch), então mutar params.timeout
    // limita o timer interno. Outros toolFns são cooperativos (sem handle de
    // processo para matar). clampExecTimeout sanitizes garbage/negatives (M4).
    if (toolName === 'executeShell') {
      const budgetSec = Math.floor(timeoutMs / 1000);
      params.timeout = Math.min(clampExecTimeout(params.timeout) / 1000, budgetSec);
    }

    // 2. Circuit breaker check
    this.circuit.check(toolName, params);

    // 3. Idempotency check — v13.0 (F3.2): SEMANTIC classification. Read-only
    // tools (and read-only shell commands) are never skipped; mutating tools
    // dedupe for 60s, enough to break LLM retry loops.
    const idemKey = this.idempotency.generateKey(toolName, params);
    const isMutating = isMutatingToolCall(toolName, params);
    if (isMutating && this.idempotency.isProcessed(idemKey) && options.idempotent !== false) {
      console.log(`[tool-guard] Idempotency: skipping duplicate ${label}`);
      // Wave 3 (review I1): skipped duplicates still feed the circuit breaker —
      // 3 identical calls in 60s IS an LLM loop even when idempotency answers
      // them, and a runaway shell loop must trip CIRCUIT_OPEN instead of
      // getting silent fake-success forever.
      this.circuit.record(toolName, params);
      return { success: true, skipped: true, reason: 'already processed', idempotencyKey: idemKey, message: 'Operação idêntica já executada recentemente (idempotência).' };
    }

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

    // 1. Retry + execute
    const result = await withRetry(
      () => withTimeout(toolFn(), timeoutMs, label),
      { label }
    );

    // 2. Record circuit
    this.circuit.record(toolName, params);

    // 3. Mark idempotency — only on success: a failed result ({success:false})
    // must stay retryable instead of being silently "skipped" forever.
    // Fix H3: apenas tools mutating são marcadas (reads nunca são dedupados).
    if (isMutating && result && result.success !== false) {
      this.idempotency.markProcessed(idemKey);
    }

    // 6. Update checksum após editar (Wave 5: same alias resolution as the verify above)
    if (['writeFile', 'replaceInFile', 'appendFile'].includes(toolName)) {
      this.checksums.record(driftPath);
    }

    return result;
  }

  recordChecksum(filePath) {
    return this.checksums.record(filePath);
  }

  async checkpoint(stepIndex, description) {
    return this.checkpoints.create(stepIndex, description);
  }

  async rollback(stepIndex) {
    return this.checkpoints.rollbackTo(stepIndex);
  }

  async undo() {
    return this.checkpoints.undoLast();
  }

  listCheckpoints() {
    return this.checkpoints.list();
  }

  reset() {
    this.idempotency.clear();
    this.circuit = new CircuitBreaker();
  }
}

module.exports = {
  ToolGuard,
  CircuitBreaker,
  IdempotencyStore,
  FileChecksumCache,
  StepCheckpoint,
  withRetry,
  withTimeout,
  validateToolCall,
  computeChecksum,
  TOOL_SCHEMAS,
  validatePythonCode,
  checkDestructivePattern,
  isMutatingToolCall,
  IDEMPOTENCY_TTL_MS,
  normalizeToolParams,
};
