#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# LUNA INSTALLER — Linux / macOS / Git-Bash (Windows)
# Um comando: curl -fsSL https://raw.githubusercontent.com/Jhin1v9/luna-agent/main/scripts/install/install.sh | bash
# Instala: luna-agent + luna-kernel + Postgres + stack pm2 + pareamento WhatsApp
# Sem paths hardcoded — tudo derivado do diretório escolhido.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

LUNA_VERSION="1.0.0"
AGENT_REPO="${LUNA_AGENT_REPO:-https://github.com/Jhin1v9/luna-agent.git}"
KERNEL_REPO="${LUNA_KERNEL_REPO:-https://github.com/Jhin1v9/luna-kernel.git}"

# ── Cores / log ──
if [ -t 1 ]; then
  C_G=$'\e[32m'; C_Y=$'\e[33m'; C_R=$'\e[31m'; C_B=$'\e[36m'; C_0=$'\e[0m'; C_BOLD=$'\e[1m'
else
  C_G='' C_Y='' C_R='' C_B='' C_0='' C_BOLD=''
fi
step()  { echo "${C_B}${C_BOLD}▸ $*${C_0}"; }
ok()    { echo "${C_G}✔ $*${C_0}"; }
warn()  { echo "${C_Y}⚠ $*${C_0}"; }
die()   { echo "${C_R}✘ ERRO: $*${C_0}" >&2; exit 1; }
ask()   { local _d="$2"; local _r; read -r -p "${C_B}$1${_d:+ [$_d]}: ${C_0}" _r; echo "${_r:-$_d}"; }

banner() {
  echo "${C_BOLD}${C_B}"
  echo '  ╦  ╦ ╔╗╔ ╔═╗ ╔═╗  ╗'
  echo '  ║  ║ ║║║ ║╣  ╠═╣  🌙  Luna Installer v'"$LUNA_VERSION"
  echo '  ╚═╝╚═╝╝╚╝ ╚═╝ ╩ ╩  CTO virtual da Nexo Digital'
  echo "${C_0}"
}

# ── 0. Sistema operativo ──
banner
OS="$(uname -s 2>/dev/null || echo Windows)"
IS_WINDOWS=false
case "$OS" in
  MINGW*|MSYS*|CYGWIN*|Windows) IS_WINDOWS=true ;;
esac
ok "Sistema: $OS"

# ── 1. Dependências ──
step "Verificando dependências"
MISSING=()
need_cmd() { command -v "$1" >/dev/null 2>&1 && ok "$1: $(command -v "$1")" || { warn "$1 NÃO encontrado"; MISSING+=("$1"); }; }
need_cmd git
need_cmd node
need_cmd docker
command -v pnpm >/dev/null 2>&1 || command -v corepack >/dev/null 2>&1 && ok "pnpm/corepack ok" || { warn "pnpm não encontrado"; MISSING+=("pnpm"); }
command -v pm2 >/dev/null 2>&1 && ok "pm2 ok" || warn "pm2 não encontrado (vou instalar via npm -g)"

NODE_MAJOR="$(node -e 'console.log(process.version)' 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0)"
[ "${NODE_MAJOR:-0}" -ge 22 ] && ok "Node v$NODE_MAJOR" || warn "Node v$NODE_MAJOR — recomendado >= 22"

if [ ${#MISSING[@]} -gt 0 ]; then
  echo
  warn "Faltam: ${MISSING[*]}"
  if $IS_WINDOWS; then
    echo "  → Instale Git for Windows + Node 22+ de https://nodejs.org e Docker Desktop."
    echo "  → Depois rode este instalador de novo (Git Bash)."
  else
    echo "  Debian/Ubuntu: sudo apt install -y git curl docker.io"
    echo "  Node 22:       curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash && sudo apt install -y nodejs"
  fi
  die "Instale as dependências e rode de novo."
fi

# pnpm disponível?
if ! command -v pnpm >/dev/null 2>&1; then
  step "Ativando corepack (pnpm)"
  corepack enable 2>/dev/null || npm i -g pnpm@9 >/dev/null 2>&1
  command -v pnpm >/dev/null 2>&1 || die "pnpm não disponível após corepack"
fi
ok "pnpm: $(pnpm -v 2>/dev/null)"

# pm2 disponível?
if ! command -v pm2 >/dev/null 2>&1; then
  step "Instalando pm2"
  npm i -g pm2 >/dev/null 2>&1 || die "falha ao instalar pm2 (npm i -g pm2)"
fi
ok "pm2: $(pm2 -v 2>/dev/null | head -1)"

# ── 2. Diretório de instalação ──
echo
DEFAULT_DIR="$HOME/luna"
$IS_WINDOWS && DEFAULT_DIR="${USERPROFILE:-$HOME}/luna"
INSTALL_DIR="$(ask "📁 Diretório de instalação" "$DEFAULT_DIR")"
INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"
mkdir -p "$INSTALL_DIR" || die "não consegui criar $INSTALL_DIR"
ok "Instalando em: $INSTALL_DIR"
AGENT_DIR="$INSTALL_DIR/luna-agent"
KERNEL_DIR="$INSTALL_DIR/luna-kernel"

# ── 3. Clone dos repos ──
step "Baixando luna-agent"
if [ -d "$AGENT_DIR/.git" ]; then
  warn "luna-agent já existe — git pull"
  git -C "$AGENT_DIR" pull --ff-only -q || warn "pull falhou (mudanças locais?) — seguindo com o que está lá"
else
  git clone --depth 1 "$AGENT_REPO" "$AGENT_DIR" || die "falha ao clonar luna-agent"
fi
ok "luna-agent em $AGENT_DIR"

step "Baixando luna-kernel"
if [ -d "$KERNEL_DIR/.git" ]; then
  warn "luna-kernel já existe — git pull"
  git -C "$KERNEL_DIR" pull --ff-only -q || warn "pull falhou — seguindo com o que está lá"
else
  git clone --depth 1 "$KERNEL_REPO" "$KERNEL_DIR" || die "falha ao clonar luna-kernel"
fi
ok "luna-kernel em $KERNEL_DIR"

# ── 4. Configuração (.env) — importar ou gerar ──
echo
step "Configuração"
IMPORT="$(ask "📥 Importar .env + roda de providers de uma instalação que já funciona? (s/n)" "n")"

if [ "$IMPORT" = "s" ] || [ "$IMPORT" = "S" ]; then
  SRC="$(ask "Caminho da instalação existente (pasta que contém luna-agent)" "")"
  [ -n "$SRC" ] && [ -d "$SRC/luna-agent" ] || die "pasta inválida: $SRC/luna-agent não existe"
  [ -f "$SRC/luna-agent/.env" ] || die "não achei $SRC/luna-agent/.env"
  cp "$SRC/luna-agent/.env" "$AGENT_DIR/.env"
  ok ".env do agent importado"
  # providers (roda) — kernel pode estar fora da pasta fonte; tenta os dois lugares
  for cand in "$SRC/luna-kernel/roda/providers.json" "$SRC/roda/providers.json"; do
    if [ -f "$cand" ]; then mkdir -p "$KERNEL_DIR/roda"; cp "$cand" "$KERNEL_DIR/roda/providers.json"; ok "roda/providers.json importada de $cand"; break; fi
  done
  for cand in "$SRC/luna-agent/config/providers.json" "$SRC/config/providers.json"; do
    if [ -f "$cand" ]; then mkdir -p "$AGENT_DIR/config"; cp "$cand" "$AGENT_DIR/config/providers.json"; ok "config/providers.json importado"; break; fi
  done
  # .env do kernel (keys de APIs)
  for cand in "$SRC/luna-kernel/.env" "$SRC/.env.kernel"; do
    if [ -f "$cand" ]; then cp "$cand" "$KERNEL_DIR/.env"; ok ".env do kernel importado"; break; fi
  done
  # perfil do Chrome do WhatsApp (sessão pareada) — opcional, copia se existir
  WA_SRC=""
  for cand in "$HOME/.luna/chrome-whatsapp" "$SRC/.luna/chrome-whatsapp"; do
    [ -d "$cand" ] && WA_SRC="$cand" && break
  done
  if [ -n "$WA_SRC" ]; then
    CPY="$(ask "Encontrei sessão WhatsApp pareada em $WA_SRC — copiar? (s/n)" "s")"
    if [ "$CPY" = "s" ]; then mkdir -p "$HOME/.luna"; cp -r "$WA_SRC" "$HOME/.luna/chrome-whatsapp" 2>/dev/null && ok "perfil WhatsApp copiado (sem QR de novo!)"; fi
  fi
else
  step "Gerando .env interativo (baseado no .env.example)"
  [ -f "$AGENT_DIR/.env.example" ] || die ".env.example não encontrado no repo"
  cp "$AGENT_DIR/.env.example" "$AGENT_DIR/.env"
  DB_MODE="$(ask "Banco de dados: (l)ocal via Docker Postgres ou (e)xterno (DATABASE_URL)" "l")"
  if [ "$DB_MODE" = "e" ]; then
    EXT_URL="$(ask "DATABASE_URL externo" "postgres://user:pass@host:5432/luna")"
    sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=$EXT_URL|" "$AGENT_DIR/.env"
  fi
  ALLOW="$(ask "WhatsApp — allowlist (nomes/números separados por vírgula)" "Abner")"
  # append das allowlists (podem não existir no example)
  grep -q '^WHATSAPP_INGEST_ALLOWLIST=' "$AGENT_DIR/.env" \
    && sed -i.bak "s|^WHATSAPP_INGEST_ALLOWLIST=.*|WHATSAPP_INGEST_ALLOWLIST=$ALLOW|" "$AGENT_DIR/.env" \
    || printf 'WHATSAPP_INGEST_ALLOWLIST=%s\nWHATSAPP_OUTBOUND_ALLOWLIST=%s\n' "$ALLOW" "$ALLOW" >> "$AGENT_DIR/.env"
  sed -i.bak "s|^WHATSAPP_OUTBOUND_ALLOWLIST=.*|WHATSAPP_OUTBOUND_ALLOWLIST=$ALLOW|" "$AGENT_DIR/.env" 2>/dev/null
  ok ".env gerado em $AGENT_DIR/.env (ajuste keys de API quando quiser)"
fi
rm -f "$AGENT_DIR/.env.bak" 2>/dev/null

# ── 5. Postgres local (se DATABASE_URL aponta pro localhost) ──
DB_URL="$(grep -E '^DATABASE_URL=' "$AGENT_DIR/.env" | head -1 | cut -d= -f2-)"
if echo "$DB_URL" | grep -qE 'localhost|127\.0\.0\.1'; then
  step "Subindo Postgres local (Docker, porta 5433)"
  if ! docker info >/dev/null 2>&1; then
    warn "Docker não responde."
    if $IS_WINDOWS; then
      echo "  → Abrindo Docker Desktop… (aguarde inicializar e rode 'luna on' depois)"
      [ -f "/c/Program Files/Docker/Docker/Docker Desktop.exe" ] && start "" "/c/Program Files/Docker/Docker/Docker Desktop.exe" 2>/dev/null
    else
      echo "  → suba o serviço: sudo systemctl start docker"
    fi
    die "Docker indisponível — sem banco local não dá pra continuar."
  fi
  bash "$AGENT_DIR/scripts/start-postgres.sh" || die "falha ao subir postgres"
else
  ok "Usando banco externo: $(echo "$DB_URL" | sed 's|//[^@]*@|//***@|')"
fi

# ── 6. Dependências node ──
step "Instalando dependências (luna-agent)"
( cd "$AGENT_DIR" && pnpm install --prefer-offline 2>&1 | tail -2 ) || die "pnpm install falhou no luna-agent"
ok "luna-agent deps ok"

step "Instalando dependências (luna-kernel)"
( cd "$KERNEL_DIR" && corepack pnpm install --prefer-offline 2>&1 | tail -2 ) || warn "pnpm install do kernel falhou — tente manual: cd $KERNEL_DIR && pnpm install"

# ── 7. Migrações ──
step "Rodando migrações do banco"
( cd "$AGENT_DIR" && pnpm migrate 2>&1 | tail -3 ) || die "migrações falharam (banco de pé? DATABASE_URL certa?)"
ok "migrações aplicadas"

# ── 8. Builds ──
step "Build do painel (:3101)"
( cd "$AGENT_DIR" && pnpm --filter painel build 2>&1 | tail -2 ) || warn "build do painel falhou — 'pnpm --filter painel build' depois"
step "Build do luna-web (frontend)"
if [ -d "$KERNEL_DIR/packages/kernel/luna-web" ] && [ -f "$KERNEL_DIR/packages/kernel/luna-web/package.json" ]; then
  ( cd "$KERNEL_DIR/packages/kernel/luna-web" && pnpm build 2>&1 | tail -2 ) || warn "build do luna-web falhou — o dashboard serve o dist antigo se houver"
else
  warn "luna-web não encontrado no kernel — pulando"
fi

# ── 9. Ecosystem pm2 (paths dinâmicos, zero hardcode) ──
step "Gerando ecosystem pm2 da stack"
PM2_BIN="$(command -v pm2 || echo pm2)"
cat > "$INSTALL_DIR/luna-stack.ecosystem.config.js" <<EOF
// Gerado pelo Luna Installer em $(date -Iseconds) — NÃO edite à mão; rode o instalador de novo.
const path = require('path');
const ROOT = '$INSTALL_DIR';
const AGENT = path.join(ROOT, 'luna-agent');
const KERNEL = path.join(ROOT, 'luna-kernel');
const isWin = process.platform === 'win32';
const shell = isWin ? 'cmd.exe' : '/bin/bash';
const pnpmRun = (dir, script) => isWin
  ? { cmd: 'pnpm.cmd', args: ['--dir', dir, script] }
  : { cmd: 'pnpm', args: ['--dir', dir, script] };

const mk = (name, dir, script, extraEnv, extra) => {
  const r = pnpmRun(dir, script);
  return {
    name, cwd: dir, script: r.cmd, args: r.args,
    exec_mode: 'fork', instances: 1, autorestart: true, watch: false,
    max_memory_restart: '1G', max_restarts: 50, min_uptime: '10s',
    restart_delay: 3000, kill_timeout: 8000, vizion: false,
    env: { NODE_ENV: 'production', ...(extraEnv || {}) },
    ...(extra || {}),
  };
};

module.exports = {
  apps: [
    mk('luna-orchestrator', AGENT, '--filter orchestrator start', { PATH: process.env.PATH }),
    mk('luna-worker', AGENT, '--filter worker start', { PATH: process.env.PATH }),
    mk('luna-whatsplay', AGENT, '--filter whatsplay start', { PATH: process.env.PATH }, { max_memory_restart: '512M' }),
    mk('painel-luna', AGENT, '--filter painel start', { PATH: process.env.PATH }, { listen_timeout: 30000 }),
    {
      name: 'luna-server', cwd: path.join(KERNEL, 'apps', 'dashboard'),
      script: path.join(KERNEL, 'apps', 'dashboard', 'luna-server.js'),
      exec_mode: 'fork', autorestart: true, watch: false, max_memory_restart: '1G',
      env: { NODE_ENV: 'production', LUNA_KERNEL_DIR: path.join(KERNEL, 'packages', 'kernel'), LUNA_HOME: process.env.HOME || process.env.USERPROFILE },
    },
    {
      name: 'nexo-dashboard', cwd: path.join(KERNEL, 'apps', 'dashboard'),
      script: path.join(KERNEL, 'apps', 'dashboard', 'server.js'),
      exec_mode: 'fork', autorestart: true, watch: false, max_memory_restart: '1G',
      env: { NODE_ENV: 'production', PORT: 3456, DASHBOARD_PORT: 3456, LUNA_KERNEL_DIR: path.join(KERNEL, 'packages', 'kernel'), LUNA_HOME: process.env.HOME || process.env.USERPROFILE },
    },
  ],
};
EOF
ok "ecosystem: $INSTALL_DIR/luna-stack.ecosystem.config.js"

step "Subindo a stack (pm2)"
pm2 delete luna-stack 2>/dev/null
pm2 start "$INSTALL_DIR/luna-stack.ecosystem.config.js" 2>&1 | tail -3 || die "pm2 start falhou"
pm2 save >/dev/null 2>&1 || true
ok "stack no ar"

# ── 10. WhatsApp — pareamento ──
echo
step "WhatsApp"
WA_PROFILE="${WHATSAPP_USER_DATA_DIR:-$HOME/.luna/chrome-whatsapp}"
if $IS_WINDOWS; then WA_PROFILE="${WHATSAPP_USER_DATA_DIR:-$USERPROFILE/.luna/chrome-whatsapp}"; fi
# perfil importado na etapa 4? então provavelmente já está logado
ALREADY=false
[ -d "$WA_PROFILE" ] && grep -rqs '"https://web.whatsapp.com"' "$WA_PROFILE/Default/Cookies" 2>/dev/null && ALREADY=true

# Chrome presente?
CHROME_HINT=""
if $IS_WINDOWS; then
  for c in "/c/Program Files/Google/Chrome/Application/chrome.exe" "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"; do
    [ -f "$c" ] && CHROME_HINT="$c" && break
  done
else
  for c in /usr/bin/google-chrome /usr/bin/chromium /usr/bin/chromium-browser; do
    [ -f "$c" ] && CHROME_HINT="$c" && break
  done
fi
if [ -z "$CHROME_HINT" ]; then
  warn "Chrome não encontrado. Instale o Google Chrome (o whatsplay precisa dele)."
  $IS_WINDOWS || echo "  Debian/Ubuntu: wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && sudo apt install -y ./google-chrome-stable_current_amd64.deb"
fi

if [ "$ALREADY" = "true" ]; then
  ok "Perfil WhatsApp com sessão encontrado — pareamento provavelmente desnecessário"
else
  echo
  echo "${C_Y}${C_BOLD}📱 PAREAMENTO DO WHATSAPP${C_0}"
  echo "  Vou abrir o WhatsApp Web por 3 minutos com o QR code."
  echo "  ${C_BOLD}Abra o WhatsApp no celular → Aparelhos conectados → Conectar aparelho${C_0}"
  echo "  e escaneie o QR que vai aparecer na janela do Chrome."
  PAIR="$(ask "Começar o pareamento agora? (s/n)" "s")"
  if [ "$PAIR" = "s" ]; then
    ( cd "$AGENT_DIR" && WHATSAPP_HEALTH_DISABLED=true pnpm --filter whatsplay login ) || warn "login falhou — rode depois: cd $AGENT_DIR && pnpm --filter whatsplay login"
  else
    echo "  Depois rode: cd $AGENT_DIR && pnpm --filter whatsplay login"
  fi
fi

# ── 11. Health checks ──
echo
step "Verificando saúde da stack"
sleep 6
check() { # name url
  if curl -fsS --max-time 8 "$2" >/dev/null 2>&1; then ok "$1 ($2)"; else warn "$1 NÃO respondeu ainda ($2) — dê mais alguns segundos e cheque: pm2 status"; fi
}
check "orchestrator /health" "http://127.0.0.1:3100/health"
check "orchestrator /ready"  "http://127.0.0.1:3100/ready"
check "painel"               "http://127.0.0.1:3101/"
check "nexo-dashboard"       "http://127.0.0.1:3456/"

# ── 12. Resumo ──
echo
echo "${C_G}${C_BOLD}═══════════════════════════════════════════════════════════${C_0}"
echo "${C_G}${C_BOLD}  🌙 LUNA INSTALADA${C_0}"
echo "${C_G}${C_BOLD}═══════════════════════════════════════════════════════════${C_0}"
echo "  Instalação : $INSTALL_DIR"
echo "  Agent      : $AGENT_DIR (orchestrator :3100 · painel :3101)"
echo "  Kernel     : $KERNEL_DIR (dashboard :3456)"
echo "  Banco      : $DB_URL"
echo
echo "  Comandos do dia a dia:"
echo "    pm2 status                — ver tudo que está rodando"
echo "    pm2 logs luna-whatsplay   — ver o WhatsApp trabalhando"
echo "    pm2 restart luna-web      — reiniciar algo"
echo "    cd $AGENT_DIR && pnpm --filter whatsplay login   — parear WhatsApp de novo"
echo
echo "  Próximos passos:"
echo "  1. Preencha as API keys no $AGENT_DIR/.env (GEMINI_API_KEY, OPENROUTER_API_KEY…)"
echo "     e restart: pm2 restart all --update-env"
echo "  2. Abra o painel: http://localhost:3101"
echo "  3. Converse com a Luna: http://localhost:3456 (ou pela web do kernel)"
echo
echo "${C_Y}  Dica: guarde o .env e o ~/.luna/chrome-whatsapp — com eês você"
echo "  migra a Luna pra qualquer PC em minutos (opção de importar do instalador).${C_0}"
