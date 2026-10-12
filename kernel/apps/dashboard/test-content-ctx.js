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

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method === 'Runtime.executionContextCreated') {
      const ctx = msg.params.context;
      console.log('New context:', ctx.id, ctx.name, ctx.origin);
    }
  });

  ws.on('open', () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    
    // Evaluate in context 3 to check if chrome.runtime exists
    ws.send(JSON.stringify({
      id: 2,
      method: 'Runtime.evaluate',
      params: {
        expression: `typeof chrome`,
        contextId: 3,
        returnByValue: true
      }
    }));

    // Evaluate in context 1
    ws.send(JSON.stringify({
      id: 3,
      method: 'Runtime.evaluate',
      params: {
        expression: `typeof chrome`,
        contextId: 1,
        returnByValue: true
      }
    }));
  });

  setTimeout(() => {
    ws.close();
  }, 3000);
}

check().catch(e => console.error(e.message));
