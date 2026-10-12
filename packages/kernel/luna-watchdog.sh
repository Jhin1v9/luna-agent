#!/bin/bash
# Luna Web Watchdog — reinicia serviços se o site estiver offline
# Roda via cron a cada 2 minutos

HEALTH_URL="https://luna-app.duckdns.org:5173/"
LOCAL_URL="http://localhost:3458/health"
PM2_BIN="${HOME}/.npm-global/bin/pm2"
LOG_FILE="${HOME}/.luna-kernel/logs/watchdog.log"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Check local backend first (use /health endpoint — it's lightweight and fast)
if ! curl -s --max-time 10 "$LOCAL_URL" > /dev/null 2>&1; then
  log "⚠️ Backend localhost:3458 OFFLINE — restarting PM2 processes"
  
  # Ensure PM2 daemon is running
  if ! $PM2_BIN status > /dev/null 2>&1; then
    log "PM2 daemon not running — starting it"
  fi
  
  # Restart processes
  cd "${HOME}/NEXO_DASHBOARD_PRO/backend"
  $PM2_BIN start luna-server.js --name luna-server 2>/dev/null || $PM2_BIN restart luna-server 2>/dev/null
  $PM2_BIN start server.js --name nexo-dashboard 2>/dev/null || $PM2_BIN restart nexo-dashboard 2>/dev/null
  $PM2_BIN save > /dev/null 2>&1
  
  log "✅ PM2 processes restarted"
else
  # Backend is fine, check if PM2 has the processes registered
  if ! $PM2_BIN status | grep -q "luna-server"; then
    log "⚠️ luna-server running but not in PM2 — registering"
    cd "${HOME}/NEXO_DASHBOARD_PRO/backend"
    $PM2_BIN start luna-server.js --name luna-server 2>/dev/null
    $PM2_BIN save > /dev/null 2>&1
  fi
fi

# Check Caddy
if ! ss -tlnp 2>/dev/null | grep -q ':5173 '; then
  log "⚠️ Caddy not listening on 5173 — restarting"
  pkill -f "caddy run" 2>/dev/null || true
  sleep 1
  nohup /usr/bin/caddy run --config "${HOME}/.config/caddy/Caddyfile" > /dev/null 2>&1 &
  log "✅ Caddy restarted"
fi

# Keep log file small (max 1000 lines)
if [ -f "$LOG_FILE" ]; then
  tail -n 1000 "$LOG_FILE" > "$LOG_FILE.tmp" 2>/dev/null && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
