# Luna Tools v3.1 — Windows Git Bash Fix Auto-Patcher
# Execute como: .\luna-patch.ps1

$ErrorActionPreference = "Stop"

Write-Host "🌙 Luna Windows Git Bash Fix — Auto Patcher" -ForegroundColor Cyan
Write-Host "═════════════════════════════════════════════" -ForegroundColor Cyan

# Detectar Git Bash
$gitBashPaths = @(
    "C:\Program Files\Git\bin\bash.exe",
    "C:\Program Files (x86)\Git\bin\bash.exe",
    "C:\Git\bin\bash.exe",
    "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe",
    "$env:USERPROFILE\scoop\apps\git\current\bin\bash.exe",
    "$env:USERPROFILE\scoop\shims\bash.exe"
)

$gitBash = $null
foreach ($p in $gitBashPaths) {
    if (Test-Path $p) {
        try {
            $test = & $p -c "echo luna-test" 2>$null
            if ($test -eq "luna-test") {
                $gitBash = $p
                break
            }
        } catch { continue }
    }
}

if (-not $gitBash) {
    # Tentar no PATH
    try {
        $test = & bash.exe -c "echo luna-test" 2>$null
        if ($test -eq "luna-test") {
            $gitBash = "bash.exe"
        }
    } catch {}
}

if (-not $gitBash) {
    Write-Host "❌ Git Bash NÃO ENCONTRADO!" -ForegroundColor Red
    Write-Host "   Baixe e instale: https://git-scm.com/download/win" -ForegroundColor Yellow
    Write-Host "   Ou execute: winget install Git.Git" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Git Bash encontrado: $gitBash" -ForegroundColor Green

# Path do arquivo
$lunaTools = "C:\Users\Abner\Documents\luna-kernel\packages\kernel\luna-tools.cjs"
if (-not (Test-Path $lunaTools)) {
    Write-Host "❌ Arquivo não encontrado: $lunaTools" -ForegroundColor Red
    Write-Host "   Ajuste o path no script se necessário." -ForegroundColor Yellow
    exit 1
}

Write-Host "📄 Arquivo: $lunaTools" -ForegroundColor Cyan

# Backup
$backup = "$lunaTools.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $lunaTools $backup
Write-Host "💾 Backup criado: $backup" -ForegroundColor Gray

$content = Get-Content $lunaTools -Raw

# FIX 1: Adicionar detecção de Git Bash após o require de build-detect
$detectionCode = @"

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
        execSync(`"\${candidate}" -c "echo luna-bash-test"`, { 
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

console.log(`[LUNA] Platform: \${process.platform} | Git Bash: \${HAS_GIT_BASH ? GIT_BASH_PATH : 'NOT FOUND'} | Shell: \${DEFAULT_SHELL}`);
"@

if ($content -notmatch "WINDOWS GIT BASH DETECTION") {
    $content = $content -replace "(const \{ resolveShellTimeout \} = require\('\./lib/build-detect\.cjs'\);)", "`$1$detectionCode"
    Write-Host "✅ FIX 1: Detecção de Git Bash adicionada" -ForegroundColor Green
} else {
    Write-Host "⚠️ FIX 1: Já aplicado (pulando)" -ForegroundColor Yellow
}

# FIX 2: Substituir spawn('/bin/bash' no executeShell
if ($content -match "spawn\('/bin/bash', \['-c', command\]" -and $content -notmatch "shellCmd = IS_WINDOWS") {
    $content = $content -replace "spawn\('/bin/bash', \['-c', command\], \{ cwd, env: process\.env \}\)", 
        "spawn(DEFAULT_SHELL, [DEFAULT_SHELL_FLAG, command], { cwd, env: process.env })"
    Write-Host "✅ FIX 2: spawn('/bin/bash') → spawn(DEFAULT_SHELL)" -ForegroundColor Green
} else {
    Write-Host "⚠️ FIX 2: Já aplicado ou padrão diferente (pulando)" -ForegroundColor Yellow
}

# FIX 3: safeExec com execOpts.shell para Windows
if ($content -match "const output = execSync\(finalCmd, \{" -and $content -notmatch "execOpts\.shell = GIT_BASH_PATH") {
    $content = $content -replace "(const output = execSync\(finalCmd, \{)", "`$1`n      shell: IS_WINDOWS ? GIT_BASH_PATH : undefined,"
    Write-Host "✅ FIX 3: safeExec com shell Git Bash" -ForegroundColor Green
} else {
    Write-Host "⚠️ FIX 3: Já aplicado (pulando)" -ForegroundColor Yellow
}

# FIX 4: langMap bash executor
if ($content -match "bash: \{ ext: 'sh', executor: 'bash'" -and $content -notmatch "IS_WINDOWS && HAS_GIT_BASH \? GIT_BASH_PATH : 'bash'") {
    $content = $content -replace "bash: \{ ext: 'sh', executor: 'bash', shell: true \}", 
        "bash: { ext: 'sh', executor: IS_WINDOWS && HAS_GIT_BASH ? GIT_BASH_PATH : 'bash', shell: true }"
    $content = $content -replace "sh: \{ ext: 'sh', executor: 'bash', shell: true \}", 
        "sh: { ext: 'sh', executor: IS_WINDOWS && HAS_GIT_BASH ? GIT_BASH_PATH : 'bash', shell: true }"
    $content = $content -replace "shell: \{ ext: 'sh', executor: 'bash', shell: true \}", 
        "shell: { ext: 'sh', executor: IS_WINDOWS && HAS_GIT_BASH ? GIT_BASH_PATH : 'bash', shell: true }"
    Write-Host "✅ FIX 4: langMap bash executors atualizados" -ForegroundColor Green
} else {
    Write-Host "⚠️ FIX 4: Já aplicado (pulando)" -ForegroundColor Yellow
}

# Salvar
Set-Content $lunaTools $content -NoNewline
Write-Host ""
Write-Host "🎉 PATCH APLICADO COM SUCESSO!" -ForegroundColor Green
Write-Host "   Reinicie a Luna para aplicar as mudanças." -ForegroundColor Cyan
Write-Host ""
