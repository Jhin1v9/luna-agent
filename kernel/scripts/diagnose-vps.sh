#!/bin/bash
echo "=== Diagnostico Luna VPS ==="
echo ""

# 1. Check PM2 status
echo "--- PM2 Status ---"
pm2 status 2>/dev/null || echo "PM2 not found"

# 2. Check Chrome/Brave with CDP
echo ""
echo "--- Chrome/Brave CDP ---"
if command -v brave-browser &>/dev/null; then
  echo "Brave found: $(which brave-browser)"
elif command -v google-chrome &>/dev/null; then
  echo "Chrome found: $(which google-chrome)"
elif command -v chromium-browser &>/dev/null; then
  echo "Chromium found: $(which chromium-browser)"
else
  echo "No Chrome/Brave/Chromium found in PATH"
fi
echo "Processes with remote-debugging-port:"
ps aux | grep 'remote-debugging-port=9222' | grep -v grep || echo "  None running"

# 3. Check CDP port
echo ""
echo "--- CDP Port 9222 ---"
ss -tlnp 2>/dev/null | grep 9222 || netstat -tlnp 2>/dev/null | grep 9222 || echo "  Port 9222 not listening"

# 4. Check cookies
echo ""
echo "--- Kimi Cookies ---"
COOKIE_DIR="/home/noke/Documents/Nexo/Luna/luna-kernel/packages/kernel/cookies"
if [ -f "$COOKIE_DIR/kimi-master-cookies.json" ]; then
  echo "Kimi cookies: $(wc -c < "$COOKIE_DIR/kimi-master-cookies.json") bytes"
  grep -o '"name":"[^"]*"' "$COOKIE_DIR/kimi-master-cookies.json" | head -10
else
  echo "Kimi cookies: NOT FOUND"
fi

# 5. Check .env
echo ""
echo "--- .env ---"
ENV_FILE="/home/noke/Documents/Nexo/Luna/luna-kernel/packages/kernel/.env"
if [ -f "$ENV_FILE" ]; then
  grep -v '^#' "$ENV_FILE" | grep -v '^$' || echo "  No active config"
  echo "---"
  echo "LUNA_DEFAULT_MODE=$(grep LUNA_DEFAULT_MODE "$ENV_FILE" 2>/dev/null || echo 'not set')"
else
  echo ".env NOT FOUND"
fi

# 6. Luna API health
echo ""
echo "--- Luna API Health ---"
curl -sk https://vps.nexo-digital.app:3601/api/system/health 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  API not reachable"

# 7. Check extensions
echo ""
echo "--- Chrome Extension ---"
EXT_DIR="/home/noke/Documents/Nexo/Luna/luna-kernel/packages/kernel/luna-extension"
if [ -f "$EXT_DIR/manifest.json" ]; then
  echo "Extension manifest: FOUND"
  grep '"version"' "$EXT_DIR/manifest.json"
else
  echo "Extension NOT FOUND"
fi

echo ""
echo "=== Fin del diagnostico ==="