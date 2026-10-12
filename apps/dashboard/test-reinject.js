const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { LUNA_KERNEL_DIR } = require('./lib/resolve-luna.cjs');
const lunaConfig = require(path.join(LUNA_KERNEL_DIR, 'config', 'luna-config'));

async function check() {
  const pageList = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });

  const kimiPage = pageList.find(p => p.url && p.url.includes('kimi'));
  const ws = new WebSocket(kimiPage.webSocketDebuggerUrl);

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params?.args?.map(a => a.value).join(' ');
      if (text && text.includes('Luna')) console.log('Console:', text);
    }
  });

  ws.on('open', async () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    await new Promise(r => setTimeout(r, 500));

    // Read injected.js content
    const fs = require('fs');
    const injectedCode = fs.readFileSync(path.join(LUNA_KERNEL_DIR, 'luna-extension', 'injected.js'), 'utf8');

    // Inject into main world (contextId 10)
    ws.send(JSON.stringify({
      id: 2,
      method: 'Runtime.evaluate',
      params: {
        expression: injectedCode,
        contextId: 10
      }
    }));

    setTimeout(() => {
      ws.send(JSON.stringify({
        id: 3,
        method: 'Runtime.evaluate',
        params: {
          expression: `typeof window.__lunaDomObserver`,
          contextId: 10,
          returnByValue: true
        }
      }));
    }, 1000);

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 3 && msg.result) {
        console.log('After inject, __lunaDomObserver:', msg.result.result?.value);
      }
    });

    setTimeout(() => ws.close(), 3000);
  });
}

check().catch(e => console.error(e.message));
