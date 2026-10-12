// luna-windows-fix.js — Aplica o patch automaticamente no luna-tools.cjs
// Execute: node luna-windows-fix.js

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🌙 Luna Windows Git Bash Fix — Auto Patcher');
console.log('═════════════════════════════════════════════');

// Detectar Git Bash
function findGitBash() {
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Git\\bin\\bash.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs\\Git\\bin\\bash.exe'),
    path.join(process.env.USERPROFILE || '', 'scoop\\apps\\git\\current\\bin\\bash.exe'),
    'bash.exe',
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        execSync(`"${candidate}" -c "echo luna-test"`, { 
          encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore']
        });
        return candidate;
      }
    } catch { continue; }
  }
  return null;
}

const gitBash = findGitBash();
if (!gitBash) {
  console.error('❌ Git Bash NÃO ENCONTRADO!');
  console.error('   Baixe e instale: https://git-scm.com/download/win');
  console.error('   Ou execute: winget install Git.Git');
  process.exit(1);
}

console.log('✅ Git Bash encontrado:', gitBash);

// Path do arquivo
const lunaTools = path.join(process.env.USERPROFILE, 'Documents', 'luna-kernel', 'packages', 'kernel', 'luna-tools.cjs');
if (!fs.existsSync(lunaTools)) {
  console.error('❌ Arquivo não encontrado:', lunaTools);
  console.error('   Ajuste o path no script se necessário.');
  process.exit(1);
}

console.log('📄 Arquivo:', lunaTools);

// Backup
const backup = lunaTools + '.backup-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(lunaTools, backup);
console.log('💾 Backup:', backup);

let content = fs.readFileSync(lunaTools, 'utf8');
let changes = 0;

// FIX 1: Adicionar detecção de Git Bash
const detectionCode = `
// ═══════════════════════════════════════════════════════════════════════════
// WINDOWS GIT BASH DETECTION (v3.1-fix)
// ═══════════════════════════════════════════════════════════════════════════

const IS_WINDOWS = process.platform === 'win32';

function findGitBash() {
  if (!IS_WINDOWS) return '/bin/bash';
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Git\\bin\\bash.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs\\Git\\bin\\bash.exe'),
    path.join(process.env.USERPROFILE || '', 'scoop\\apps\\git\\current\\bin\\bash.exe'),
    'bash.exe',
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        execSync(\`"\${candidate}" -c "echo luna-bash-test"\`, { 
          encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore']
        });
        return candidate;
      }
    } catch { continue; }
  }
  return null;
}

const GIT_BASH_PATH = findGitBash();
const HAS_GIT_BASH = !!GIT_BASH_PATH;
const DEFAULT_SHELL = IS_WINDOWS ? (HAS_GIT_BASH ? GIT_BASH_PATH : 'cmd.exe') : '/bin/bash';
const DEFAULT_SHELL_FLAG = (IS_WINDOWS && !HAS_GIT_BASH) ? '/c' : '-c';

console.log(\`[LUNA] Platform: \${process.platform} | Git Bash: \${HAS_GIT_BASH ? GIT_BASH_PATH : 'NOT FOUND'} | Shell: \${DEFAULT_SHELL}\`);
`;

if (!content.includes('WINDOWS GIT BASH DETECTION')) {
  content = content.replace(
    "const { resolveShellTimeout } = require('./lib/build-detect.cjs');",
    "const { resolveShellTimeout } = require('./lib/build-detect.cjs');" + detectionCode
  );
  changes++;
  console.log('✅ FIX 1: Detecção de Git Bash adicionada');
} else {
  console.log('⚠️ FIX 1: Já aplicado');
}

// FIX 2: spawn('/bin/bash') → spawn(DEFAULT_SHELL)
if (content.includes("spawn('/bin/bash', ['-c', command], { cwd, env: process.env })") && 
    !content.includes('spawn(DEFAULT_SHELL')) {
  content = content.replace(
    "spawn('/bin/bash', ['-c', command], { cwd, env: process.env })",
    "spawn(DEFAULT_SHELL, [DEFAULT_SHELL_FLAG, command], { cwd, env: process.env })"
  );
  changes++;
  console.log('✅ FIX 2: spawn atualizado para DEFAULT_SHELL');
} else {
  console.log('⚠️ FIX 2: Já aplicado ou padrão diferente');
}

// FIX 3: safeExec com shell
if (content.includes('const output = execSync(finalCmd, {') && 
    !content.includes('shell: IS_WINDOWS ? GIT_BASH_PATH : undefined')) {
  content = content.replace(
    'const output = execSync(finalCmd, {',
    `const output = execSync(finalCmd, {
      shell: IS_WINDOWS ? GIT_BASH_PATH : undefined,`
  );
  changes++;
  console.log('✅ FIX 3: safeExec com shell Git Bash');
} else {
  console.log('⚠️ FIX 3: Já aplicado');
}

// FIX 4: langMap bash executors
if (content.includes("bash: { ext: 'sh', executor: 'bash', shell: true }") &&
    !content.includes("IS_WINDOWS && HAS_GIT_BASH ? GIT_BASH_PATH : 'bash'")) {
  content = content.replace(
    /bash: \{ ext: 'sh', executor: 'bash', shell: true \}/g,
    "bash: { ext: 'sh', executor: IS_WINDOWS && HAS_GIT_BASH ? GIT_BASH_PATH : 'bash', shell: true }"
  );
  content = content.replace(
    /sh: \{ ext: 'sh', executor: 'bash', shell: true \}/g,
    "sh: { ext: 'sh', executor: IS_WINDOWS && HAS_GIT_BASH ? GIT_BASH_PATH : 'bash', shell: true }"
  );
  content = content.replace(
    /shell: \{ ext: 'sh', executor: 'bash', shell: true \}/g,
    "shell: { ext: 'sh', executor: IS_WINDOWS && HAS_GIT_BASH ? GIT_BASH_PATH : 'bash', shell: true }"
  );
  changes++;
  console.log('✅ FIX 4: langMap bash executors atualizados');
} else {
  console.log('⚠️ FIX 4: Já aplicado');
}

// Salvar
fs.writeFileSync(lunaTools, content);
console.log('');
console.log('🎉 PATCH APLICADO! Total de alterações:', changes);
console.log('   Reinicie a Luna para aplicar as mudanças.');
