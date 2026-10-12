#!/bin/bash
# Luna Auto-Sync Script v1.1
# Roda em cada máquina (pai, nonoke, jhin) para manter atualizado com GitHub
# Recomendado: cron a cada 5 minutos: */5 * * * * /home/<user>/luna-sync.sh

set -e

LOG_FILE="/tmp/luna-sync.log"
LUNA_KERNEL_DIR="${HOME}/.luna-kernel"
NEXO_DASHBOARD_DIR="${HOME}/NEXO_DASHBOARD_PRO"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

# Apps managed by this sync script
PM2_APPS_KERNEL=("luna-server")
PM2_APPS_DASHBOARD=("nexo-dashboard" "telegram-bot")

mkdir -p "$(dirname "$LOG_FILE")"

echo "[$DATE] Luna sync started" >> "$LOG_FILE"

# Rotate log if too big (> 5MB)
if [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 5242880 ]; then
  mv "$LOG_FILE" "${LOG_FILE}.old.$(date +%s)"
fi

# Helper: rotate old PM2 logs before restart to avoid stale 409 noise
rotate_pm2_logs() {
  local app="$1"
  for suffix in out error; do
    local logf="${HOME}/.pm2/logs/${app}-${suffix}.log"
    if [ -f "$logf" ]; then
      local size
      size=$(stat -c%s "$logf" 2>/dev/null || echo 0)
      if [ "$size" -gt 2097152 ]; then
        mv "$logf" "${logf}.old.$(date +%s)" 2>/dev/null || true
        : > "$logf" 2>/dev/null || true
      fi
    fi
  done
}

sync_repo() {
  local repo_dir="$1"
  local repo_name="$2"
  local has_changes=0

  if [ ! -d "$repo_dir/.git" ]; then
    echo "[$DATE] SKIP: $repo_name não é um repo git em $repo_dir" >> "$LOG_FILE"
    return
  fi

  cd "$repo_dir"

  # Fetch quietly
  if ! git fetch origin main --quiet 2>/dev/null; then
    echo "[$DATE] ERRO: falha no fetch de $repo_name" >> "$LOG_FILE"
    return
  fi

  local local_hash
  local remote_hash
  local_hash=$(git rev-parse HEAD)
  remote_hash=$(git rev-parse origin/main)

  if [ "$local_hash" != "$remote_hash" ]; then
    echo "[$DATE] UPDATE: $repo_name tem mudanças ($local_hash -> $remote_hash)" >> "$LOG_FILE"
    git pull origin main --quiet
    has_changes=1
  else
    echo "[$DATE] OK: $repo_name está atualizado" >> "$LOG_FILE"
  fi

  # Rebuild frontend if luna-kernel changed
  if [ "$has_changes" -eq 1 ] && [ "$repo_name" == "luna-kernel" ]; then
    if [ -d "$repo_dir/luna-web" ]; then
      echo "[$DATE] BUILD: Rebuildando luna-web..." >> "$LOG_FILE"
      cd "$repo_dir/luna-web"
      npm install >> "$LOG_FILE" 2>&1 || echo "[$DATE] WARN: npm install do luna-web falhou" >> "$LOG_FILE"
      npm run build >> "$LOG_FILE" 2>&1 || echo "[$DATE] WARN: build falhou, tentando continuar" >> "$LOG_FILE"
    fi
  fi

  # Rebuild dashboard frontend if dashboard changed
  if [ "$has_changes" -eq 1 ] && [ "$repo_name" == "nexo-dashboard" ]; then
    if [ -d "$repo_dir/frontend" ]; then
      echo "[$DATE] BUILD: Rebuildando dashboard frontend..." >> "$LOG_FILE"
      cd "$repo_dir/frontend"
      npm install --legacy-peer-deps >> "$LOG_FILE" 2>&1 || echo "[$DATE] WARN: npm install frontend falhou" >> "$LOG_FILE"
      npm run build >> "$LOG_FILE" 2>&1 || echo "[$DATE] WARN: build frontend falhou" >> "$LOG_FILE"
      rm -rf ../backend/public 2>/dev/null || true
      cp -r dist ../backend/public 2>/dev/null || echo "[$DATE] WARN: copy dist falhou" >> "$LOG_FILE"
    fi
    if [ -d "$repo_dir/backend" ]; then
      echo "[$DATE] INSTALL: Atualizando dependências do backend..." >> "$LOG_FILE"
      cd "$repo_dir/backend"
      npm install >> "$LOG_FILE" 2>&1 || echo "[$DATE] WARN: npm install backend falhou" >> "$LOG_FILE"
    fi
  fi

  # Restart PM2 apps when changes detected
  if [ "$has_changes" -eq 1 ]; then
    if command -v pm2 &> /dev/null; then
      local apps=()
      if [ "$repo_name" == "luna-kernel" ]; then
        apps=("${PM2_APPS_KERNEL[@]}")
      else
        apps=("${PM2_APPS_DASHBOARD[@]}")
      fi

      for app in "${apps[@]}"; do
        echo "[$DATE] RESTART: Reiniciando $app via PM2..." >> "$LOG_FILE"
        rotate_pm2_logs "$app"
        pm2 restart "$app" >> "$LOG_FILE" 2>&1 || echo "[$DATE] WARN: pm2 restart $app falhou" >> "$LOG_FILE"
      done
    else
      echo "[$DATE] WARN: PM2 não encontrado, reinicie manualmente" >> "$LOG_FILE"
    fi
  fi
}

sync_repo "$LUNA_KERNEL_DIR" "luna-kernel"
sync_repo "$NEXO_DASHBOARD_DIR" "nexo-dashboard"

echo "[$DATE] Luna sync finished" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"
