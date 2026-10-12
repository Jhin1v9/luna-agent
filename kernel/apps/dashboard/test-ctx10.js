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
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params?.args?.map(a => a.value).join(' ');
      if (text && text.includes('Luna')) console.log('Console:', text);
    }
  });

  ws.on('open', async () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    await new Promise(r => setTimeout(r, 500));

    // Get execution context IDs
    ws.send(JSON.stringify({ id: 2, method: 'Runtime.getProperties', params: { objectId: 'dummy' } }));

    // Try contextId 10 directly
    ws.send(JSON.stringify({
      id: 3,
      method: 'Runtime.evaluate',
      params: {
        expression: `window.postMessage({source:'luna-injected',type:'ctx10-test',data:{a:1}},'*'); 'ctx10-posted'`,
        contextId: 10,
        returnByValue: true
      }
    }));

    setTimeout(() => ws.close(), 3000);
  });
}

check().catch(e => console.error(e.message));
