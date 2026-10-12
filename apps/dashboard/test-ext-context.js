const http = require('http');
const WebSocket = require('ws');

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

  let contentCtxId = null;

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method === 'Runtime.executionContextCreated') {
      const ctx = msg.params.context;
      if (ctx.origin && ctx.origin.includes('kimi.com')) {
        // Could be content script or page context
        console.log('Context:', ctx.id, ctx.name, ctx.origin);
        if (!contentCtxId && ctx.auxData && ctx.auxData.isDefault === false) {
          // Content script context typically has isDefault: false
          contentCtxId = ctx.id;
          console.log('Found content script context:', ctx.id);
        }
      }
    }
  });

  ws.on('open', async () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    await new Promise(r => setTimeout(r, 1000));

    console.log('Content context ID:', contentCtxId);

    if (contentCtxId) {
      ws.send(JSON.stringify({
        id: 2,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            window.addEventListener('message', function lunaTest(e) {
              if (e.data && e.data.source === 'luna-injected') {
                console.log('[Luna Content TEST] Received:', e.data.type);
              }
            });
            'listener added in content context'
          `,
          contextId: contentCtxId,
          returnByValue: true
        }
      }));
    }

    setTimeout(() => ws.close(), 2000);
  });
}

check().catch(e => console.error(e.message));
