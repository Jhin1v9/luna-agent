# ═══════════════════════════════════════════════════════════════════════════
# LUNA INSTALLER — Windows (PowerShell nativo)
# Um comando: irm https://raw.githubusercontent.com/Jhin1v9/luna-agent/main/scripts/install/install.ps1 | iex
# Instala: luna-agent + luna-kernel + Postgres + stack pm2 + pareamento WhatsApp
# Sem paths hardcoded — tudo derivado do diretório escolhido.
# ═══════════════════════════════════════════════════════════════════════════
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$LUNA_VERSION = "1.0.0"
$AGENT_REPO = if ($env:LUNA_AGENT_REPO) { $env:LUNA_AGENT_REPO } else { "https://github.com/Jhin1v9/luna-agent.git" }
$KERNEL_REPO = if ($env:LUNA_KERNEL_REPO) { $env:LUNA_KERNEL_REPO } else { "https://github.com/Jhin1v9/luna-kernel.git" }

function Step-Msg($m) { Write-Host "▸ $m" -ForegroundColor Cyan -Bold:$false }
function Ok($m)      { Write-Host "✔ $m" -ForegroundColor Green }
function Warn($m)    { Write-Host "⚠ $m" -ForegroundColor Yellow }
function Die($m)     { Write-Host "✘ ERRO: $m" -ForegroundColor Red; exit 1 }
function Ask($q, $def) {
  $s = if ($def) { "$q [$def]: " } else { "$q`: " }
  $r = Read-Host $s
  if ([string]::IsNullOrWhiteSpace($r)) { return $def } else { return $r }
}

Write-Host @"
  ╦  ╦ ╔╗╔ ╔═╗ ╔═╗  ╗
  ║  ║ ║║║ ║╣  ╠═╣  🌙  Luna Installer v$LUNA_VERSION
  ╚═╝╚═╝╝╚╝ ╚═╝ ╩ ╩  CTO virtual da Nexo Digital
"@ -ForegroundColor Cyan

# ── 1. Dependências ──
Step-Msg "Verificando dependências"
$missing = @()
foreach ($c in @('git', 'node', 'docker')) {
  if (Get-Command $c -ErrorAction SilentlyContinue) { Ok "${c}: $((Get-Command $c).Source)" } else { Warn "$c NÃO encontrado"; $missing += $c }
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue) -and -not (Get-Command corepack -ErrorAction SilentlyContinue)) {
  Warn "pnpm/corepack não encontrado"; $missing += 'pnpm'
} else { Ok "pnpm/corepack ok" }
if (Get-Command pm2 -ErrorAction SilentlyContinue) { Ok "pm2 ok" } else { Warn "pm2 não encontrado (vou instalar via npm -g)" }

$nodeMajor = 0
try { $nodeMajor = [int]((& node -e "console.log(process.version)") -replace 'v(\d+).*', '$1') } catch {}
if ($nodeMajor -ge 22) { Ok "Node v$nodeMajor" } else { Warn "Node v$nodeMajor — recomendado >= 22" }

if ($missing.Count -gt 0) {
  Write-Host ""
  Warn "Faltam: $($missing -join ', ')"
  Write-Host "  → Git: https://git-scm.com/download/win"
  Write-Host "  → Node 22+: https://nodejs.org (marque 'Add to PATH')"
  Write-Host "  → Docker Desktop: https://www.docker.com/products/docker-desktop"
  Die "Instale as dependências e rode de novo."
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Step-Msg "Ativando corepack (pnpm)"
  try { corepack enable | Out-Null } catch { npm i -g pnpm@9 | Out-Null }
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Die "pnpm não disponível após corepack" }
}
Ok "pnpm: $(pnpm -v)"

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Step-Msg "Instalando pm2"
  npm i -g pm2 | Out-Null
  if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) { Die "falha ao instalar pm2" }
}
Ok "pm2: $(pm2 -v)"

# ── 2. Diretório de instalação ──
Write-Host ""
$defaultDir = Join-Path $env:USERPROFILE 'luna'
$INSTALL_DIR = Ask "📁 Diretório de instalação" $defaultDir
New-Item -ItemType Directory -Force -Path $INSTALL_DIR | Out-Null
Ok "Instalando em: $INSTALL_DIR"
$AGENT_DIR = Join-Path $INSTALL_DIR 'luna-agent'
$KERNEL_DIR = Join-Path $INSTALL_DIR 'luna-kernel'

# ── 3. Clone dos repos ──
Step-Msg "Baixando luna-agent"
if (Test-Path (Join-Path $AGENT_DIR '.git')) {
  Warn "luna-agent já existe — git pull"
  git -C $AGENT_DIR pull --ff-only -q 2>$null; if ($LASTEXITCODE -ne 0) { Warn "pull falhou — seguindo com o que está lá" }
} else {
  git clone --depth 1 $AGENT_REPO $AGENT_DIR; if ($LASTEXITCODE -ne 0) { Die "falha ao clonar luna-agent" }
}
Ok "luna-agent em $AGENT_DIR"

Step-Msg "Baixando luna-kernel"
if (Test-Path (Join-Path $KERNEL_DIR '.git')) {
  Warn "luna-kernel já existe — git pull"
  git -C $KERNEL_DIR pull --ff-only -q 2>$null; if ($LASTEXITCODE -ne 0) { Warn "pull falhou — seguindo com o que está lá" }
} else {
  git clone --depth 1 $KERNEL_REPO $KERNEL_DIR; if ($LASTEXITCODE -ne 0) { Die "falha ao clonar luna-kernel" }
}
Ok "luna-kernel em $KERNEL_DIR"

# ── 4. Configuração (.env) — importar ou gerar ──
Write-Host ""
Step-Msg "Configuração"
$import = Ask "📥 Importar .env + roda de providers de uma instalação que já funciona? (s/n)" "n"

if ($import -match '^[sS]') {
  $src = Ask "Caminho da instalação existente (pasta que contém luna-agent)" ""
  $srcAgent = Join-Path $src 'luna-agent'
  if (-not (Test-Path $srcAgent)) { Die "pasta inválida: $srcAgent não existe" }
  if (-not (Test-Path (Join-Path $srcAgent '.env'))) { Die "não achei $srcAgent\.env" }
  Copy-Item (Join-Path $srcAgent '.env') (Join-Path $AGENT_DIR '.env') -Force
  Ok ".env do agent importado"
  foreach ($cand in @((Join-Path $src 'luna-kernel\roda\providers.json'), (Join-Path $src 'roda\providers.json'))) {
    if (Test-Path $cand) { New-Item -ItemType Directory -Force -Path (Join-Path $KERNEL_DIR 'roda') | Out-Null; Copy-Item $cand (Join-Path $KERNEL_DIR 'roda\providers.json') -Force; Ok "roda/providers.json importada"; break }
  }
  foreach ($cand in @((Join-Path $src 'luna-agent\config\providers.json'), (Join-Path $src 'config\providers.json'))) {
    if (Test-Path $cand) { New-Item -ItemType Directory -Force -Path (Join-Path $AGENT_DIR 'config') | Out-Null; Copy-Item $cand (Join-Path $AGENT_DIR 'config\providers.json') -Force; Ok "config/providers.json importado"; break }
  }
  foreach ($cand in @((Join-Path $src 'luna-kernel\.env'), (Join-Path $src '.env.kernel'))) {
    if (Test-Path $cand) { Copy-Item $cand (Join-Path $KERNEL_DIR '.env') -Force; Ok ".env do kernel importado"; break }
  }
  # Perfil do Chrome do WhatsApp (sessão pareada)
  $waSrc = Join-Path $env:USERPROFILE '.luna\chrome-whatsapp'
  $altSrc = Join-Path $src '.luna\chrome-whatsapp'
  if ((Test-Path $waSrc) -or (Test-Path $altSrc)) {
    $cpy = Ask "Encontrei sessão WhatsApp pareada — copiar? (s/n)" "s"
    if ($cpy -match '^[sS]') {
      $from = if (Test-Path $waSrc) { $waSrc } else { $altSrc }
      New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE '.luna') | Out-Null
      Copy-Item $from (Join-Path $env:USERPROFILE '.luna\chrome-whatsapp') -Recurse -Force
      Ok "perfil WhatsApp copiado (sem QR de novo!)"
    }
  }
} else {
  Step-Msg "Gerando .env interativo (baseado no .env.example)"
  $example = Join-Path $AGENT_DIR '.env.example'
  if (-not (Test-Path $example)) { Die ".env.example não encontrado no repo" }
  Copy-Item $example (Join-Path $AGENT_DIR '.env') -Force
  $dbMode = Ask "Banco de dados: (l)ocal via Docker Postgres ou (e)xterno" "l"
  $envFile = Join-Path $AGENT_DIR '.env'
  if ($dbMode -eq 'e') {
    $extUrl = Ask "DATABASE_URL externo" "postgres://user:pass@host:5432/luna"
    (Get-Content $envFile -Raw) -replace '(?m)^DATABASE_URL=.*', "DATABASE_URL=$extUrl" | Set-Content $envFile -NoNewline
  }
  $allow = Ask "WhatsApp — allowlist (nomes/números separados por vírgula)" "Abner"
  $content = Get-Content $envFile -Raw
  if ($content -match '(?m)^WHATSAPP_INGEST_ALLOWLIST=') {
    $content = $content -replace '(?m)^WHATSAPP_INGEST_ALLOWLIST=.*', "WHATSAPP_INGEST_ALLOWLIST=$allow"
    $content = $content -replace '(?m)^WHATSAPP_OUTBOUND_ALLOWLIST=.*', "WHATSAPP_OUTBOUND_ALLOWLIST=$allow"
  } else {
    $content += "`nWHATSAPP_INGEST_ALLOWLIST=$allow`nWHATSAPP_OUTBOUND_ALLOWLIST=$allow`n"
  }
  Set-Content $envFile $content -NoNewline
  Ok ".env gerado em $envFile (ajuste keys de API quando quiser)"
}

# ── 5. Postgres local ──
$dbUrl = ((Get-Content (Join-Path $AGENT_DIR '.env') | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) -replace '^DATABASE_URL=', '')
if ($dbUrl -match 'localhost|127\.0\.0\.1') {
  Step-Msg "Subindo Postgres local (Docker, porta 5433)"
  docker ps *> $null
  if ($LASTEXITCODE -ne 0) {
    Warn "Docker não responde — abrindo Docker Desktop…"
    $dd = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dd) { Start-Process $dd }
    Die "Aguarde o Docker iniciar (bandeja fica verde) e rode este instalador de novo."
  }
  bash (Join-Path $AGENT_DIR 'scripts\start-postgres.sh')
  if ($LASTEXITCODE -ne 0) { Die "falha ao subir postgres" }
} else {
  Ok "Usando banco externo"
}

# ── 6. Dependências node ──
Step-Msg "Instalando dependências (luna-agent)"
Push-Location $AGENT_DIR
pnpm install --prefer-offline 2>&1 | Select-Object -Last 2
if ($LASTEXITCODE -ne 0) { Pop-Location; Die "pnpm install falhou no luna-agent" }
Pop-Location
Ok "luna-agent deps ok"

Step-Msg "Instalando dependências (luna-kernel)"
Push-Location $KERNEL_DIR
corepack pnpm install --prefer-offline 2>&1 | Select-Object -Last 2
if ($LASTEXITCODE -ne 0) { Warn "pnpm install do kernel falhou — tente manual: cd $KERNEL_DIR; pnpm install" }
Pop-Location

# ── 7. Migrações ──
Step-Msg "Rodando migrações do banco"
Push-Location $AGENT_DIR
pnpm migrate 2>&1 | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { Pop-Location; Die "migrações falharam (banco de pé? DATABASE_URL certa?)" }
Pop-Location
Ok "migrações aplicadas"

# ── 8. Builds ──
Step-Msg "Build do painel (:3101)"
Push-Location $AGENT_DIR
pnpm --filter painel build 2>&1 | Select-Object -Last 2
if ($LASTEXITCODE -ne 0) { Warn "build do painel falhou — 'pnpm --filter painel build' depois" }
Pop-Location

Step-Msg "Build do luna-web (frontend)"
$lw = Join-Path $KERNEL_DIR 'packages\kernel\luna-web'
if (Test-Path (Join-Path $lw 'package.json')) {
  Push-Location $lw
  pnpm build 2>&1 | Select-Object -Last 2
  if ($LASTEXITCODE -ne 0) { Warn "build do luna-web falhou" }
  Pop-Location
} else { Warn "luna-web não encontrado no kernel — pulando" }

# ── 9. Ecosystem pm2 ──
Step-Msg "Gerando ecosystem pm2 da stack"
$ecosystem = Join-Path $INSTALL_DIR 'luna-stack.ecosystem.config.js'
$esc = $INSTALL_DIR -replace '\\', '/'
@"
// Gerado pelo Luna Installer — NÃO edite à mão; rode o instalador de novo.
const path = require('path');
const ROOT = '$esc';
const AGENT = path.join(ROOT, 'luna-agent');
const KERNEL = path.join(ROOT, 'luna-kernel');
const mk = (name, args, cwd, extraEnv, extra) => ({
  name, cwd, script: 'pnpm.cmd', args,
  exec_mode: 'fork', instances: 1, autorestart: true, watch: false,
  max_memory_restart: '1G', max_restarts: 50, min_uptime: '10s',
  restart_delay: 3000, kill_timeout: 8000, vizion: false,
  env: { NODE_ENV: 'production', ...(extraEnv || {}) },
  ...(extra || {}),
});
module.exports = {
  apps: [
    mk('luna-orchestrator', ['--dir', AGENT, '--filter', 'orchestrator', 'start'], AGENT),
    mk('luna-worker', ['--dir', AGENT, '--filter', 'worker', 'start'], AGENT),
    mk('luna-whatsplay', ['--dir', AGENT, '--filter', 'whatsplay', 'start'], AGENT, {}, { max_memory_restart: '512M' }),
    mk('painel-luna', ['--dir', AGENT, '--filter', 'painel', 'start'], AGENT, {}, { listen_timeout: 30000 }),
    { name: 'luna-server', cwd: path.join(KERNEL, 'apps', 'dashboard'), script: path.join(KERNEL, 'apps', 'dashboard', 'luna-server.js'),
      exec_mode: 'fork', autorestart: true, watch: false, max_memory_restart: '1G',
      env: { NODE_ENV: 'production', LUNA_KERNEL_DIR: path.join(KERNEL, 'packages', 'kernel'), LUNA_HOME: process.env.USERPROFILE } },
    { name: 'nexo-dashboard', cwd: path.join(KERNEL, 'apps', 'dashboard'), script: path.join(KERNEL, 'apps', 'dashboard', 'server.js'),
      exec_mode: 'fork', autorestart: true, watch: false, max_memory_restart: '1G',
      env: { NODE_ENV: 'production', PORT: 3456, DASHBOARD_PORT: 3456, LUNA_KERNEL_DIR: path.join(KERNEL, 'packages', 'kernel'), LUNA_HOME: process.env.USERPROFILE } },
  ],
};
"@ | Set-Content $ecosystem -NoNewline
Ok "ecosystem: $ecosystem"

Step-Msg "Subindo a stack (pm2)"
pm2 delete luna-stack 2>$null | Out-Null
pm2 start $ecosystem 2>&1 | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { Die "pm2 start falhou" }
pm2 save 2>$null | Out-Null
Ok "stack no ar"

# ── 10. WhatsApp — pareamento ──
Write-Host ""
Step-Msg "WhatsApp"
$chrome = $null
foreach ($c in @("C:\Program Files\Google\Chrome\Application\chrome.exe", "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe")) {
  if (Test-Path $c) { $chrome = $c; break }
}
if (-not $chrome) { Warn "Chrome não encontrado — instale o Google Chrome (o whatsplay precisa dele)" }

$waProfile = Join-Path $env:USERPROFILE '.luna\chrome-whatsapp'
$already = (Test-Path $waProfile) -and (Test-Path (Join-Path $waProfile 'Default'))
if ($already) {
  Ok "Perfil WhatsApp encontrado em $waProfile — pareamento provavelmente desnecessário"
} else {
  Write-Host ""
  Write-Host "📱 PAREAMENTO DO WHATSAPP" -ForegroundColor Yellow
  Write-Host "  Vou abrir o WhatsApp Web por 3 minutos com o QR code."
  Write-Host "  Abra o WhatsApp no celular → Aparelhos conectados → Conectar aparelho"
  Write-Host "  e escaneie o QR que vai aparecer na janela do Chrome."
  $pair = Ask "Começar o pareamento agora? (s/n)" "s"
  if ($pair -match '^[sS]') {
    Push-Location $AGENT_DIR
    $env:WHATSAPP_HEALTH_DISABLED = 'true'
    pnpm --filter whatsplay login
    Remove-Item Env:WHATSAPP_HEALTH_DISABLED
    Pop-Location
  } else {
    Write-Host "  Depois rode: cd $AGENT_DIR; pnpm --filter whatsplay login"
  }
}

# ── 11. Health checks ──
Write-Host ""
Step-Msg "Verificando saúde da stack"
Start-Sleep -Seconds 6
function Check($name, $url) {
  try { Invoke-RestMethod -Uri $url -TimeoutSec 8 | Out-Null; Ok "$name ($url)" }
  catch { Warn "$name NÃO respondeu ainda ($url) — dê mais alguns segundos: pm2 status" }
}
Check "orchestrator /health" "http://127.0.0.1:3100/health"
Check "orchestrator /ready" "http://127.0.0.1:3100/ready"
Check "painel" "http://127.0.0.1:3101/"
Check "nexo-dashboard" "http://127.0.0.1:3456/"

# ── 12. Resumo ──
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  🌙 LUNA INSTALADA" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Instalação : $INSTALL_DIR"
Write-Host "  Agent      : $AGENT_DIR (orchestrator :3100 · painel :3101)"
Write-Host "  Kernel     : $KERNEL_DIR (dashboard :3456)"
Write-Host "  Banco      : $dbUrl"
Write-Host ""
Write-Host "  Comandos do dia a dia:"
Write-Host "    pm2 status                — ver tudo que está rodando"
Write-Host "    pm2 logs luna-whatsplay   — ver o WhatsApp trabalhando"
Write-Host "    pm2 restart luna-web      — reiniciar algo"
Write-Host "    cd $AGENT_DIR; pnpm --filter whatsplay login   — parear WhatsApp de novo"
Write-Host ""
Write-Host "  Próximos passos:"
Write-Host "  1. Preencha as API keys em $AGENT_DIR\.env (GEMINI_API_KEY, OPENROUTER_API_KEY…)"
Write-Host "     e restart: pm2 restart all --update-env"
Write-Host "  2. Abra o painel: http://localhost:3101"
Write-Host "  3. Converse com a Luna: http://localhost:3456"
Write-Host ""
Write-Host "  Dica: guarde o .env e o ~/.luna/chrome-whatsapp — com eles você" -ForegroundColor Yellow
Write-Host "  migra a Luna pra qualquer PC em minutos (opção de importar do instalador)." -ForegroundColor Yellow
