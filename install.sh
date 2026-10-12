#!/bin/bash
set -e

REPO_URL="https://github.com/Jhin1v9/luna-kernel.git"
LUNA_DIR="${LUNA_DIR:-$HOME/.luna-kernel}"

echo "🌙 Luna Installer"
echo ""

# Detect OS
if [[ "$OSTYPE" != "linux-gnu"* ]] && [[ "$OSTYPE" != "linux"* ]]; then
  echo "⚠️  Este instalador suporta apenas Linux/WSL no momento."
  exit 1
fi

# Check Node.js
check_node() {
  if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node -v | sed 's/v//')
    MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [[ "$MAJOR" -ge 22 ]]; then
      echo "✅ Node.js v$NODE_VERSION encontrado"
      return 0
    fi
  fi
  return 1
}

install_node() {
  echo "📦 Instalando Node.js 24 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
}

if ! check_node; then
  read -p "Node.js v22+ não encontrado. Instalar? [s/N]: " ans
  if [[ "$ans" =~ ^[Ss]$ ]]; then
    install_node
  else
    echo "❌ Node.js é obrigatório. Abortando."
    exit 1
  fi
fi

# Check pnpm
if ! command -v pnpm >/dev/null 2>&1; then
  echo "📦 Instalando pnpm via corepack..."
  corepack enable
  corepack prepare pnpm@11.9.0 --activate
else
  echo "✅ pnpm encontrado"
fi

# Check PM2
if ! command -v pm2 >/dev/null 2>&1; then
  read -p "PM2 não encontrado. Instalar globalmente? [s/N]: " ans
  if [[ "$ans" =~ ^[Ss]$ ]]; then
    npm install -g pm2
  else
    echo "❌ PM2 é obrigatório. Abortando."
    exit 1
  fi
else
  echo "✅ PM2 encontrado"
fi

# Check Chrome/Chromium
if ! command -v google-chrome >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  read -p "Google Chrome não encontrado. Instalar? [s/N]: " ans
  if [[ "$ans" =~ ^[Ss]$ ]]; then
    sudo apt-get update
    sudo apt-get install -y wget gnupg
    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
    sudo sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list'
    sudo apt-get update
    sudo apt-get install -y google-chrome-stable
  else
    echo "⚠️  Chrome é altamente recomendado. O login no Kimi pode não funcionar sem ele."
  fi
else
  echo "✅ Chrome/Chromium encontrado"
fi

# Clone or update repo
if [[ -d "$LUNA_DIR/.git" ]]; then
  echo "📁 Diretório $LUNA_DIR já existe."
  read -p "Atualizar repo existente? [s/N]: " ans
  if [[ "$ans" =~ ^[Ss]$ ]]; then
    cd "$LUNA_DIR"
    git pull origin main
  else
    echo "❌ Abortando para não sobrescrever $LUNA_DIR"
    exit 1
  fi
else
  if [[ -d "$LUNA_DIR" ]]; then
    echo "❌ $LUNA_DIR existe mas não é um repositório git."
    exit 1
  fi
  echo "📥 Clonando repositório em $LUNA_DIR..."
  git clone "$REPO_URL" "$LUNA_DIR"
fi

# Run Node installer
cd "$LUNA_DIR"
node install.cjs
