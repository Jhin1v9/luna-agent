#Requires -Version 5.1
<#
.SYNOPSIS
  Configura Luna para rodar no Windows localmente.
.DESCRIPTION
  Verifica/instala dependências, configura SQLite, encontra Chrome,
  cria .env e inicia o backend da Luna.
.NOTES
  Execute como Administrador se quiser adicionar Chrome ao PATH global.
  Senão, o script configura PUPPETEER_EXECUTABLE_PATH apenas no .env local.
#>
param(
  [string]$ProjectDir = $PWD.Path,
  [switch]$AddChromeToPath,
  [string]$Port = "3458"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
  Write-Host "`n[>] $msg" -ForegroundColor Cyan
}

function Write-Ok($msg) {
  Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
  Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

function Write-Err($msg) {
  Write-Host "[ERR] $msg" -ForegroundColor Red
}

# -----------------------------------------------------------------------------
Write-Step "Verificando pasta do projeto: $ProjectDir"
if (-not (Test-Path $ProjectDir)) {
  throw "Pasta nao encontrada: $ProjectDir"
}
Set-Location $ProjectDir

# Procura package.json ou luna-server.js
$pkg = Get-ChildItem -Recurse -Filter "package.json" -Depth 3 | Where-Object {
  $_.FullName -like "*luna-kernel*" -or $_.FullName -like "*apps\dashboard*"
} | Select-Object -First 1

if (-not $pkg) {
  $pkg = Get-ChildItem -Recurse -Filter "luna-server.js" -Depth 5 | Select-Object -First 1
}

if ($pkg) {
  $rootDir = $pkg.DirectoryName
  # Se achou luna-server.js dentro de apps/dashboard, sobe para a raiz do kernel
  if ($rootDir -like "*apps\dashboard*") {
    $rootDir = (Get-Item $rootDir).Parent.Parent.FullName
  }
  Write-Ok "Projeto encontrado em: $rootDir"
  Set-Location $rootDir
} else {
  Write-Warn "Nao encontrei luna-kernel automaticamente. Usando: $ProjectDir"
  $rootDir = $ProjectDir
}

# -----------------------------------------------------------------------------
Write-Step "Verificando Node.js"
try {
  $nodeVersion = node --version 2>$null
  Write-Ok "Node.js encontrado: $nodeVersion"
} catch {
  throw "Node.js nao encontrado. Instale o Node.js 18+ antes de continuar."
}

# -----------------------------------------------------------------------------
Write-Step "Verificando npm/pnpm"
$pkgManager = "npm"
try {
  $pnpmVersion = pnpm --version 2>$null
  if ($pnpmVersion) {
    $pkgManager = "pnpm"
    Write-Ok "pnpm encontrado: $pnpmVersion"
  }
} catch {
  Write-Warn "pnpm nao encontrado. Usando npm."
}

# -----------------------------------------------------------------------------
Write-Step "Instalando dependencias (pode demorar)"
if ($pkgManager -eq "pnpm") {
  & pnpm install
} else {
  & npm install
}
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao instalar dependencias."
}
Write-Ok "Dependencias instaladas."

# -----------------------------------------------------------------------------
Write-Step "Procurando Chrome/Chromium"
$chromeCandidates = @(
  "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "${env:LocalAppData}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

$chromePath = $null
foreach ($c in $chromeCandidates) {
  if (Test-Path $c) {
    $chromePath = $c
    break
  }
}

# Tambem procura em Program Files recursivamente (mais lento)
if (-not $chromePath) {
  $chromePath = Get-ChildItem -Path "${env:ProgramFiles}", "${env:ProgramFiles(x86)}", "${env:LocalAppData}" `
    -Recurse -Filter "chrome.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}

if (-not $chromePath) {
  Write-Warn "Chrome nao encontrado. Instalando Chromium via npm..."
  & npm install -g chromium
  $chromePath = (Get-Command chromium -ErrorAction SilentlyContinue).Source
  if (-not $chromePath) {
    $chromePath = Join-Path $env:LOCALAPPDATA "chromium\chrome.exe"
  }
}

if (-not $chromePath -or -not (Test-Path $chromePath)) {
  throw "Nao foi possivel encontrar ou instalar Chrome/Chromium."
}

Write-Ok "Navegador encontrado: $chromePath"

# Adiciona ao PATH se solicitado
if ($AddChromeToPath) {
  $chromeDir = Split-Path $chromePath -Parent
  $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($currentPath -notlike "*$chromeDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$chromeDir", "User")
    Write-Ok "Adicionado ao PATH do usuario: $chromeDir"
  } else {
    Write-Ok "Ja esta no PATH do usuario."
  }
}

# -----------------------------------------------------------------------------
Write-Step "Configurando .env (SQLite + Chrome)"
$envPath = Join-Path $rootDir ".env"
$envLines = @(
  "DATABASE_URL=file:./luna.db",
  "PUPPETEER_EXECUTABLE_PATH=$chromePath",
  "CHROME_PATH=$chromePath",
  "PORT=$Port",
  "HOSTNAME=127.0.0.1",
  "NEXTAUTH_URL=http://localhost:$Port",
  "AUTH_TRUST_HOST=true"
)

if (Test-Path $envPath) {
  $existing = Get-Content $envPath -Raw
  $updated = $false
  foreach ($line in $envLines) {
    $key = ($line -split "=")[0]
    if ($existing -notmatch "^$key=[^`r`n]*" -and $existing -notmatch "`n$key=[^`r`n]*") {
      Add-Content -Path $envPath -Value $line
      $updated = $true
    }
  }
  if ($updated) {
    Write-Ok ".env atualizado com variaveis faltantes."
  } else {
    Write-Ok ".env ja estava configurado."
  }
} else {
  Set-Content -Path $envPath -Value ($envLines -join "`n")
  Write-Ok ".env criado em: $envPath"
}

# -----------------------------------------------------------------------------
Write-Step "Verificando build do frontend web"
$webDir = Join-Path $rootDir "packages\kernel\luna-web"
if (-not (Test-Path $webDir)) {
  $webDir = Join-Path $rootDir "luna-web"
}

if (Test-Path $webDir) {
  Set-Location $webDir
  if (-not (Test-Path "dist")) {
    Write-Warn "dist nao encontrado. Fazendo build do frontend..."
    if ($pkgManager -eq "pnpm") {
      & pnpm run build
    } else {
      & npm run build
    }
    if ($LASTEXITCODE -ne 0) {
      throw "Falha no build do frontend."
    }
    Write-Ok "Frontend buildado."
  } else {
    Write-Ok "Frontend dist ja existe."
  }
  Set-Location $rootDir
}

# -----------------------------------------------------------------------------
Write-Step "Preparando backend (luna-server)"
$serverDir = Join-Path $rootDir "apps\dashboard"
if (-not (Test-Path $serverDir)) {
  $serverDir = Join-Path $rootDir "packages\kernel"
}
if (-not (Test-Path $serverDir)) {
  $serverDir = $rootDir
}

Set-Location $serverDir
Write-Ok "Backend em: $serverDir"

# -----------------------------------------------------------------------------
Write-Step "Iniciando luna-server"
$logDir = Join-Path $rootDir "logs"
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$env:DATABASE_URL = "file:./luna.db"
$env:PUPPETEER_EXECUTABLE_PATH = $chromePath
$env:CHROME_PATH = $chromePath
$env:PORT = $Port
$env:HOSTNAME = "127.0.0.1"
$env:NEXTAUTH_URL = "http://localhost:$Port"
$env:AUTH_TRUST_HOST = "true"

$serverScript = Join-Path $serverDir "luna-server.js"
if (-not (Test-Path $serverScript)) {
  $serverScript = Join-Path $serverDir "server.js"
}

Start-Process -FilePath "node" -ArgumentList $serverScript -NoNewWindow -RedirectStandardOutput (Join-Path $logDir "luna-server.log") -RedirectStandardError (Join-Path $logDir "luna-server.err.log")

Write-Ok "luna-server iniciado em http://localhost:$Port"

# -----------------------------------------------------------------------------
Write-Step "Aguardando backend (10s)"
Start-Sleep -Seconds 10

try {
  $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/system/health" -TimeoutSec 5
  Write-Ok "Health check OK: $($resp | ConvertTo-Json -Compress)"
} catch {
  Write-Warn "Health check ainda nao responde. Verifique logs em: $logDir"
}

Write-Host "`n====================================" -ForegroundColor Green
Write-Host "Luna configurada para Windows!" -ForegroundColor Green
Write-Host "Abra no navegador: http://localhost:$Port" -ForegroundColor Green
Write-Host "Logs: $logDir" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green
