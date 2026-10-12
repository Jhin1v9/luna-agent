/**
 * luna-workspace.cjs — Workspace Bootstrap & Context Manager
 * Arquitetura: Index-Free + On-Demand Discovery (Claude Code style)
 *
 * Responsabilidades:
 *   1. Bootstrap workspace: escaneia árvore, lê arquivos-chave, detecta stack
 *   2. Gerar Workspace Manifest (~2-4KB) para injeção no prompt
 *   3. Active Files Cache: arquivos lidos pelo Kimi nesta sessão (LRU eviction)
 *   4. Detectar git state (branch, dirty, commits)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const readFileAsync = promisify(fs.readFile);
const statAsync = promisify(fs.stat);
const readdirAsync = promisify(fs.readdir);
const existsAsync = promisify(fs.exists);
const { glob, grep, viewDirectory, executeShell } = require('./luna-tools.cjs');
const lunaConfig = require('./config/luna-config');

// ── Constants ──
const MAX_MANIFEST_SIZE = 4096;        // ~4KB soft limit
const MAX_TREE_DEPTH = 4;              // Não escava mais que 4 níveis
const MAX_FILES_PER_DIR = 50;          // Cap files listados por diretório
const KEY_FILES = [
  'README.md', 'readme.md', 'Readme.md',
  'package.json',
  'tsconfig.json', 'jsconfig.json',
  '.env.example', '.env.template',
  'Makefile', 'makefile',
  'docker-compose.yml', 'docker-compose.yaml',
  'Cargo.toml', 'go.mod', 'requirements.txt', 'pyproject.toml',
  'Gemfile', 'composer.json', 'pom.xml', 'build.gradle',
  'next.config.js', 'next.config.mjs', 'vite.config.js', 'vite.config.ts',
  'tailwind.config.js', 'tailwind.config.ts',
  'AGENTS.md', 'agents.md',
];

// ── .gitignore Parser ──
function parseGitignore(gitignorePath) {
  try {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    const patterns = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // Remove leading ! (negation) for simplicity — we just skip matches
      if (trimmed.startsWith('!')) continue;
      patterns.push(trimmed);
    }
    return patterns;
  } catch {
    return [];
  }
}

function matchesGitignore(relativePath, patterns) {
  const parts = relativePath.split('/').filter(Boolean);
  for (const pattern of patterns) {
    const cleanPattern = pattern.replace(/^\//, '').replace(/\/$/, '');
    // Simple matching: exact name, suffix, or directory
    for (const part of parts) {
      if (part === cleanPattern) return true;
      if (cleanPattern.startsWith('*') && part.endsWith(cleanPattern.slice(1))) return true;
      if (cleanPattern.endsWith('*') && part.startsWith(cleanPattern.slice(0, -1))) return true;
      if (cleanPattern.includes('*')) {
        const regex = new RegExp('^' + cleanPattern.replace(/\*/g, '.*') + '$');
        if (regex.test(part)) return true;
      }
    }
    // Check if any part of path matches directory pattern
    if (parts.includes(cleanPattern)) return true;
  }
  return false;
}

// ── Safe Tree Scanner ──
const SAFE_MAX_ENTRIES = 1000;
const SAFE_MAX_DEPTH = 10;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', '.output', 'out', 'tmp', 'temp']);

async function scanTree(rootPath, depth = 0, gitignorePatterns = [], workspaceRoot = null) {
  const result = { dirs: [], files: [] };
  const wsRoot = workspaceRoot || rootPath;

  if (depth > SAFE_MAX_DEPTH) return result;

  let patterns = gitignorePatterns;
  const localGitignore = path.join(rootPath, '.gitignore');
  if (fs.existsSync(localGitignore)) {
    const localPatterns = parseGitignore(localGitignore);
    patterns = [...patterns, ...localPatterns];
  }

  let entries;
  try {
    entries = await readdirAsync(rootPath, { withFileTypes: true });
  } catch {
    return result;
  }

  // Safety: abort if directory has too many entries (DoS protection)
  if (entries.length > SAFE_MAX_ENTRIES) {
    console.warn(`[workspace] Directory ${rootPath} has ${entries.length} entries (max ${SAFE_MAX_ENTRIES}). Skipping deeper scan.`);
    return result;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);

    // Hardcoded skip for known large directories
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;

    // Always compute relPath from workspace root (fixes gitignore matching for subdirs)
    const relPath = path.relative(wsRoot, fullPath);

    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    if (matchesGitignore(relPath, patterns)) continue;

    if (entry.isDirectory()) {
      result.dirs.push(entry.name);
      if (depth < MAX_TREE_DEPTH && result.dirs.length <= MAX_FILES_PER_DIR) {
        const sub = await scanTree(fullPath, depth + 1, patterns, wsRoot);
        if (sub.dirs.length || sub.files.length) {
          result.dirs.push({ name: entry.name, children: sub });
        }
      }
    } else if (entry.isFile()) {
      const stat = await statAsync(fullPath).catch(() => null);
      result.files.push({
        name: entry.name,
        size: stat ? stat.size : 0,
      });
    }
  }

  return result;
}

function formatTree(tree, prefix = '') {
  const lines = [];
  const dirs = tree.dirs.filter(d => typeof d === 'string');
  const nestedDirs = tree.dirs.filter(d => typeof d === 'object');
  const allDirs = [...dirs, ...nestedDirs.map(d => d.name)];
  const files = tree.files.slice(0, MAX_FILES_PER_DIR);

  for (const d of allDirs.slice(0, 20)) {
    lines.push(`${prefix}📁 ${d}/`);
  }
  if (allDirs.length > 20) {
    lines.push(`${prefix}  ... e mais ${allDirs.length - 20} diretórios`);
  }

  for (const f of files) {
    const sizeStr = f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`;
    lines.push(`${prefix}  📄 ${f.name} (${sizeStr})`);
  }
  if (tree.files.length > MAX_FILES_PER_DIR) {
    lines.push(`${prefix}  ... e mais ${tree.files.length - MAX_FILES_PER_DIR} arquivos`);
  }

  return lines.join('\n');
}

// ── Stack Detection ──
function detectStack(keyFilesContent) {
  const stack = {
    frontend: {},
    backend: {},
    database: {},
    devops: {},
  };

  const pkg = keyFilesContent['package.json'];
  if (pkg) {
    try {
      const json = JSON.parse(pkg);
      const deps = { ...json.dependencies, ...json.devDependencies };
      const allDeps = Object.keys(deps || {});

      // Frontend
      if (allDeps.includes('next')) stack.frontend.framework = 'Next.js';
      else if (allDeps.includes('react')) stack.frontend.framework = 'React';
      else if (allDeps.includes('vue')) stack.frontend.framework = 'Vue';
      else if (allDeps.includes('svelte')) stack.frontend.framework = 'Svelte';
      else if (allDeps.includes('angular')) stack.frontend.framework = 'Angular';

      if (allDeps.includes('typescript') || allDeps.includes('ts-node')) stack.frontend.language = 'TypeScript';
      else stack.frontend.language = 'JavaScript';

      if (allDeps.includes('tailwindcss')) stack.frontend.css = 'Tailwind CSS';
      else if (allDeps.includes('styled-components')) stack.frontend.css = 'Styled Components';

      // Backend
      if (allDeps.includes('express')) stack.backend.framework = 'Express';
      else if (allDeps.includes('fastify')) stack.backend.framework = 'Fastify';
      else if (allDeps.includes('koa')) stack.backend.framework = 'Koa';
      else if (allDeps.includes('nest')) stack.backend.framework = 'NestJS';
      else if (allDeps.includes('django')) stack.backend.framework = 'Django';
      else if (allDeps.includes('flask')) stack.backend.framework = 'Flask';
      else if (allDeps.includes('fastapi')) stack.backend.framework = 'FastAPI';

      // Database
      if (allDeps.includes('pg') || allDeps.includes('postgres') || allDeps.includes('sequelize')) stack.database.type = 'PostgreSQL';
      else if (allDeps.includes('mysql') || allDeps.includes('mysql2')) stack.database.type = 'MySQL';
      else if (allDeps.includes('mongodb') || allDeps.includes('mongoose')) stack.database.type = 'MongoDB';
      else if (allDeps.includes('sqlite') || allDeps.includes('better-sqlite3')) stack.database.type = 'SQLite';
      else if (allDeps.includes('redis')) stack.database.type = 'Redis';

      // Package manager
      if (fs.existsSync(path.join(process.cwd(), 'pnpm-lock.yaml'))) stack.frontend.packageManager = 'pnpm';
      else if (fs.existsSync(path.join(process.cwd(), 'yarn.lock'))) stack.frontend.packageManager = 'Yarn';
      else stack.frontend.packageManager = 'npm';

      // DevOps
      if (allDeps.includes('docker') || fs.existsSync(path.join(process.cwd(), 'Dockerfile'))) stack.devops.docker = true;
      if (allDeps.includes('vercel')) stack.devops.deployment = 'Vercel';
      else if (allDeps.includes('@netlify/functions')) stack.devops.deployment = 'Netlify';
    } catch { /* ignore parse errors */ }
  }

  // Python
  if (keyFilesContent['requirements.txt'] || keyFilesContent['pyproject.toml']) {
    stack.backend.language = 'Python';
    const req = keyFilesContent['requirements.txt'] || '';
    if (req.includes('django')) stack.backend.framework = 'Django';
    else if (req.includes('flask')) stack.backend.framework = 'Flask';
    else if (req.includes('fastapi')) stack.backend.framework = 'FastAPI';
  }

  // Go
  if (keyFilesContent['go.mod']) {
    stack.backend.language = 'Go';
    stack.backend.framework = 'Go (std lib / various)';
  }

  // Rust
  if (keyFilesContent['Cargo.toml']) {
    stack.backend.language = 'Rust';
    const cargo = keyFilesContent['Cargo.toml'] || '';
    if (cargo.includes('actix')) stack.backend.framework = 'Actix';
    else if (cargo.includes('axum')) stack.backend.framework = 'Axum';
    else stack.backend.framework = 'Rust';
  }

  return stack;
}

// ── Git State ──
async function detectGitState(workspacePath) {
  const state = {
    isRepo: false,
    branch: null,
    dirty: false,
    modifiedFiles: [],
    lastCommit: null,
  };

  const gitDir = path.join(workspacePath, '.git');
  if (!fs.existsSync(gitDir)) return state;

  state.isRepo = true;

  try {
    const branchResult = await executeShell(`cd "${workspacePath}" && git branch --show-current`);
    state.branch = branchResult?.output?.trim() || 'unknown';
  } catch { /* ignore */ }

  try {
    const statusResult = await executeShell(`cd "${workspacePath}" && git status --short`);
    const statusLines = statusResult?.output?.split('\n').filter(Boolean) || [];
    state.dirty = statusLines.length > 0;
    state.modifiedFiles = statusLines.map(line => line.slice(3).trim()).filter(Boolean);
  } catch { /* ignore */ }

  try {
    const logResult = await executeShell(`cd "${workspacePath}" && git log -1 --oneline`);
    state.lastCommit = logResult?.output?.trim() || null;
  } catch { /* ignore */ }

  return state;
}

// ── Workspace Manifest Generator ──
function generateManifest(workspacePath, tree, keyFiles, stack, gitState) {
  const name = path.basename(workspacePath);

  const keyFilesSummary = {};
  for (const [filename, content] of Object.entries(keyFiles)) {
    if (!content) {
      keyFilesSummary[filename] = 'não encontrado';
      continue;
    }
    const size = content.length;
    const sizeStr = size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;

    // Extract specific info based on file type
    if (filename === 'package.json') {
      try {
        const pkg = JSON.parse(content);
        const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).slice(0, 10);
        keyFilesSummary[filename] = `deps: ${deps.join(', ')}${deps.length >= 10 ? '...' : ''} (${sizeStr})`;
      } catch {
        keyFilesSummary[filename] = `existe (${sizeStr})`;
      }
    } else if (filename === 'tsconfig.json') {
      const hasPaths = content.includes('"paths"');
      keyFilesSummary[filename] = `existe, paths: ${hasPaths ? 'sim' : 'não'} (${sizeStr})`;
    } else {
      keyFilesSummary[filename] = `existe (${sizeStr})`;
    }
  }

  const totalFiles = (function countFiles(t) {
    let count = t.files.length;
    for (const d of t.dirs) {
      if (typeof d === 'object' && d.children) count += countFiles(d.children);
    }
    return count;
  })(tree);

  const totalDirs = (function countDirs(t) {
    let count = t.dirs.length;
    for (const d of t.dirs) {
      if (typeof d === 'object' && d.children) count += countDirs(d.children);
    }
    return count;
  })(tree);

  const manifest = {
    path: workspacePath,
    name,
    detectedStack: stack,
    treeSummary: {
      totalFiles,
      totalDirs,
      keyDirs: tree.dirs
        .filter(d => typeof d === 'string')
        .slice(0, 10),
    },
    keyFiles: keyFilesSummary,
    gitState,
  };

  return manifest;
}

function formatManifestForPrompt(manifest) {
  const lines = [
    `📁 Workspace: ${manifest.name}`,
    `   Path: ${manifest.path}`,
    '',
  ];

  // Stack
  const stack = manifest.detectedStack;
  if (Object.keys(stack).some(k => Object.keys(stack[k]).length > 0)) {
    lines.push('🛠️  Stack Detectada:');
    if (Object.keys(stack.frontend).length) {
      const parts = [];
      if (stack.frontend.framework) parts.push(stack.frontend.framework);
      if (stack.frontend.language) parts.push(stack.frontend.language);
      if (stack.frontend.css) parts.push(stack.frontend.css);
      if (stack.frontend.packageManager) parts.push(`pm:${stack.frontend.packageManager}`);
      lines.push(`   Frontend: ${parts.join(' + ')}`);
    }
    if (Object.keys(stack.backend).length) {
      const parts = [];
      if (stack.backend.framework) parts.push(stack.backend.framework);
      if (stack.backend.language) parts.push(stack.backend.language);
      lines.push(`   Backend: ${parts.join(' + ')}`);
    }
    if (Object.keys(stack.database).length) {
      lines.push(`   Database: ${stack.database.type}`);
    }
    if (Object.keys(stack.devops).length) {
      const parts = [];
      if (stack.devops.docker) parts.push('Docker');
      if (stack.devops.deployment) parts.push(stack.devops.deployment);
      lines.push(`   DevOps: ${parts.join(' + ')}`);
    }
    lines.push('');
  }

  // Key files
  lines.push('📄 Arquivos-chave:');
  for (const [name, info] of Object.entries(manifest.keyFiles)) {
    lines.push(`   ${name}: ${info}`);
  }
  lines.push('');

  // Git
  if (manifest.gitState.isRepo) {
    lines.push('🌿 Git:');
    lines.push(`   Branch: ${manifest.gitState.branch}`);
    lines.push(`   Status: ${manifest.gitState.dirty ? '🔴 dirty' : '🟢 clean'}`);
    if (manifest.gitState.modifiedFiles.length) {
      lines.push(`   Modificados: ${manifest.gitState.modifiedFiles.slice(0, 5).join(', ')}${manifest.gitState.modifiedFiles.length > 5 ? '...' : ''}`);
    }
    if (manifest.gitState.lastCommit) {
      lines.push(`   Último commit: ${manifest.gitState.lastCommit}`);
    }
    lines.push('');
  }

  // Tree summary
  lines.push(`📊 Estrutura: ${manifest.treeSummary.totalFiles} arquivos, ${manifest.treeSummary.totalDirs} diretórios`);
  if (manifest.treeSummary.keyDirs.length) {
    lines.push(`   Diretórios principais: ${manifest.treeSummary.keyDirs.join(', ')}`);
  }

  return lines.join('\n');
}

// ── WorkspaceManager Class ──
class WorkspaceManager {
  constructor() {
    this.workspaces = new Map(); // userId -> workspace data
  }

  async bootstrap(workspacePath, userId = 'default') {
    const resolved = path.resolve(workspacePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Workspace não encontrado: ${resolved}`);
    }
    const stat = await statAsync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Path não é um diretório: ${resolved}`);
    }

    // 1. Read root .gitignore
    const gitignorePath = path.join(resolved, '.gitignore');
    const gitignorePatterns = fs.existsSync(gitignorePath) ? parseGitignore(gitignorePath) : [];

    // 2. Scan tree
    const tree = await scanTree(resolved, 0, gitignorePatterns);

    // 3. Read key files
    const keyFiles = {};
    for (const filename of KEY_FILES) {
      const filePath = path.join(resolved, filename);
      if (fs.existsSync(filePath)) {
        try {
          const content = await readFileAsync(filePath, 'utf8');
          keyFiles[filename] = content;
        } catch {
          keyFiles[filename] = null;
        }
      } else {
        keyFiles[filename] = null;
      }
    }

    // 4. Detect stack
    const stack = detectStack(keyFiles);

    // 5. Detect git state
    const gitState = await detectGitState(resolved);

    // 6. Generate manifest
    const manifest = generateManifest(resolved, tree, keyFiles, stack, gitState);

    // 7. Store
    const workspaceData = {
      path: resolved,
      manifest,
      tree,
      keyFiles,
      activeFiles: new Map(), // path -> { content, lastAccessed }
      createdAt: Date.now(),
    };
    this.workspaces.set(userId, workspaceData);

    return {
      success: true,
      manifest,
      formatted: formatManifestForPrompt(manifest),
    };
  }

  getWorkspace(userId = 'default') {
    return this.workspaces.get(userId) || null;
  }

  ensureWorkspace(userId = 'default', workspacePath = null) {
    if (this.workspaces.has(userId)) return this.workspaces.get(userId);
    const targetPath = workspacePath || path.join(this.baseDir || lunaConfig.PATHS.workspaceBase, userId);
    // bootstrap is async but returns a promise that resolves to {success, manifest, formatted}
    // Synchronously create the dir and a minimal manifest so callers can use it immediately.
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }
    const workspaceData = {
      path: targetPath,
      manifest: {
        root: targetPath,
        path: targetPath,
        name: userId,
        detectedStack: {
          frontend: {},
          backend: {},
          database: {},
          devops: {},
          mobile: {},
        },
        keyFiles: {},
        summary: `Workspace isolado para ${userId}`,
        gitState: { isRepo: false },
        treeSummary: { totalFiles: 0, totalDirs: 0, keyDirs: [] },
        tree: [],
      },
      tree: [],
      keyFiles: {},
      activeFiles: new Map(),
      createdAt: Date.now(),
    };
    this.workspaces.set(userId, workspaceData);
    return workspaceData;
  }

  getManifest(userId = 'default') {
    const ws = this.workspaces.get(userId);
    return ws ? ws.manifest : null;
  }

  getFormattedManifest(userId = 'default') {
    const manifest = this.getManifest(userId);
    return manifest ? formatManifestForPrompt(manifest) : null;
  }

  addActiveFile(userId, filePath, content) {
    const ws = this.workspaces.get(userId);
    if (!ws) return false;
    ws.activeFiles.set(filePath, {
      content,
      lastAccessed: Date.now(),
    });
    return true;
  }

  getActiveFile(userId, filePath) {
    const ws = this.workspaces.get(userId);
    if (!ws) return null;
    const entry = ws.activeFiles.get(filePath);
    return entry ? entry.content : null;
  }

  getActiveFilesContext(userId, maxTokens = 15000) {
    const ws = this.workspaces.get(userId);
    if (!ws) return '';

    // Sort by last accessed (LRU)
    const sorted = [...ws.activeFiles.entries()]
      .sort((a, b) => b[1].lastAccessed - a[1].lastAccessed);

    const lines = ['📂 Arquivos ativos nesta sessão:'];
    let totalChars = 0;

    for (const [filePath, entry] of sorted) {
      const relPath = path.relative(ws.path, filePath);
      const header = `\n--- ${relPath} ---\n`;
      const ext = path.extname(filePath).toLowerCase();
      // v8.5-fix: Don't inject raw code file contents into context — causes HTML/JSX leak
      const isCodeFile = ['.jsx', '.tsx', '.html', '.css', '.scss', '.vue', '.svelte'].includes(ext);
      let chunk;
      if (isCodeFile) {
        chunk = header + `[Arquivo de código ${ext} — conteúdo omitido do contexto. Use readFile se precisar ver.]\n`;
      } else {
        const content = entry.content;
        chunk = header + content + '\n';
      }

      if (totalChars + chunk.length > maxTokens * 2) { // rough estimate: 2 chars/token
        lines.push('\n... (mais arquivos no cache, peça para ler se necessário)');
        break;
      }

      lines.push(chunk);
      totalChars += chunk.length;
    }

    return lines.join('\n');
  }

  evictOldActiveFiles(userId, maxFiles = 20) {
    const ws = this.workspaces.get(userId);
    if (!ws) return;
    while (ws.activeFiles.size > maxFiles) {
      let oldest = null;
      let oldestTime = Infinity;
      for (const [path, entry] of ws.activeFiles) {
        if (entry.lastAccessed < oldestTime) {
          oldestTime = entry.lastAccessed;
          oldest = path;
        }
      }
      if (oldest) ws.activeFiles.delete(oldest);
    }
  }

  hasWorkspace(userId = 'default') {
    return this.workspaces.has(userId);
  }

  listWorkspaces() {
    const result = [];
    for (const [userId, ws] of this.workspaces) {
      result.push({
        userId,
        path: ws.path,
        name: ws.manifest?.name || path.basename(ws.path),
        createdAt: ws.createdAt,
      });
    }
    return result;
  }

  removeActiveFile(userId, filePath) {
    const ws = this.workspaces.get(userId);
    if (!ws) return false;
    return ws.activeFiles.delete(filePath);
  }

  clearWorkspace(userId = 'default') {
    this.workspaces.delete(userId);
  }
}

// Singleton export
const workspaceManager = new WorkspaceManager();

module.exports = {
  WorkspaceManager,
  workspaceManager,
  parseGitignore,
  matchesGitignore,
  scanTree,
  detectStack,
  detectGitState,
  generateManifest,
  formatManifestForPrompt,
};
