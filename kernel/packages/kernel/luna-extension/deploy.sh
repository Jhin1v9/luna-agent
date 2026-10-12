#!/bin/bash
# Luna Extension Deploy Script
# Limpa cache do Service Worker, atualiza versão e recarrega extensão via CDP

set -e

EXT_DIR="${HOME}/.luna-kernel/luna-extension"
CHROME_PROFILE="${HOME}/.luna/chrome-profile"
MANIFEST="$EXT_DIR/manifest.json"
BACKEND_DIR="${HOME}/NEXO_DASHBOARD_PRO/backend"

echo "🌙 Luna Extension Deploy v8.1"

# 1. Limpa cache do Service Worker
SW_CACHE=$(find "$CHROME_PROFILE" -type d -name "Service Worker" 2>/dev/null | head -1)
if [ -n "$SW_CACHE" ]; then
    rm -rf "$SW_CACHE"
    echo "✅ Service Worker cache limpo"
else
    echo "⚠️  Nenhum cache de SW encontrado"
fi

# 2. Atualiza versão no manifest (incrementa patch)
if [ -f "$MANIFEST" ]; then
    CURRENT_VERSION=$(grep -o '"version": "[^"]*"' "$MANIFEST" | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+')
    if [ -n "$CURRENT_VERSION" ]; then
        IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
        NEW_PATCH=$((PATCH + 1))
        NEW_VERSION="$MAJOR.$MINOR.$NEW_PATCH"
        sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" "$MANIFEST"
        echo "✅ Versão atualizada: $CURRENT_VERSION → $NEW_VERSION"
    else
        echo "⚠️  Não conseguiu ler versão atual, usando timestamp"
        TS=$(date +%s)
        sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"2.0.$TS\"/" "$MANIFEST"
    fi
else
    echo "❌ manifest.json não encontrado"
    exit 1
fi

# 3. Recarrega extensão via CDP
echo "🔄 Recarregando extensão via CDP..."
cd "$BACKEND_DIR"
node -e "
const http = require('http');
const WebSocket = require('ws');

async function reload() {
    const pageList = await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9222/json/list', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });

    const sw = pageList.find(p => p.type === 'service_worker');
    if (!sw) {
        console.log('⚠️  Service Worker não encontrado. Extensão pode não estar carregada.');
        return;
    }

    const ws = new WebSocket(sw.webSocketDebuggerUrl);
    ws.on('open', () => {
        ws.send(JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression: 'chrome.runtime.reload()', returnByValue: true }
        }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === 1) {
            console.log('✅ Extensão recarregada');
            ws.close();
        }
    });

    setTimeout(() => ws.close(), 3000);
}

reload().catch(e => console.error('❌ Erro:', e.message));
" 2>/dev/null || echo "⚠️  CDP não disponível. Reinicie o Chrome manualmente."

echo "🚀 Deploy completo!"
