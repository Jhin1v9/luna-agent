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
      if (text && (text.includes('Luna Content') || text.includes('Luna Injected'))) {
        console.log('Console:', text);
      }
    }
  });

  ws.on('open', async () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    await new Promise(r => setTimeout(r, 1000));

    // Post message from main world (contextId 3)
    ws.send(JSON.stringify({
      id: 2,
      method: 'Runtime.evaluate',
      params: {
        expression: `
          window.postMessage({
            source: 'luna-injected',
            type: 'postmsg_test',
            data: { test: true },
            timestamp: Date.now(),
            url: window.location.href,
            version: '2.0.1-v8.1'
          }, '*');
          'posted from main world'
        `,
        contextId: 3,
        returnByValue: true
      }
    }));

    // Also add a listener in the content script context to verify
    setTimeout(() => {
      ws.send(JSON.stringify({
        id: 3,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            window.addEventListener('message', function testListener(e) {
              if (e.data && e.data.source === 'luna-injected') {
                console.log('[Luna Content TEST] Received postMessage:', e.data.type);
              }
            });
            'listener added'
          `,
          contextId: 2,
          returnByValue: true
        }
      }));
    }, 500);
  });

  setTimeout(() => {
    ws.close();
  }, 4000);
}

test().catch(e => console.error(e.message));
