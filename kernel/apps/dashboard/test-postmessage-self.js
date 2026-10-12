const http = require('http');
const WebSocket = require('ws');

async function test() {
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
      console.log('Console:', text);
    }
  });

  ws.on('open', async () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    await new Promise(r => setTimeout(r, 500));

    // Add listener in main world (contextId 3)
    ws.send(JSON.stringify({
      id: 2,
      method: 'Runtime.evaluate',
      params: {
        expression: `
          window.addEventListener('message', function(e) {
            if (e.data && e.data.source === 'luna-injected') {
              console.log('[Main World] Received:', e.data.type);
            }
          });
          'listener added in main world'
        `,
        contextId: 3,
        returnByValue: true
      }
    }));

    await new Promise(r => setTimeout(r, 500));

    // Post message from main world
    ws.send(JSON.stringify({
      id: 3,
      method: 'Runtime.evaluate',
      params: {
        expression: `
          window.postMessage({
            source: 'luna-injected',
            type: 'self_test',
            data: { test: true }
          }, '*');
          'posted'
        `,
        contextId: 3,
        returnByValue: true
      }
    }));
  });

  setTimeout(() => {
    ws.close();
  }, 3000);
}

test().catch(e => console.error(e.message));
