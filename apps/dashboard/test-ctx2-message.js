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
      console.log('Console:', text);
    }
  });

  ws.on('open', () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    
    // Send message from content script context (contextId 2)
    setTimeout(() => {
      ws.send(JSON.stringify({
        id: 2,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            chrome.runtime.sendMessage({type:'luna_event',eventType:'ctx2_test',data:{}})
              .then(r => console.log('[Luna Content] BG response:', JSON.stringify(r)))
              .catch(e => console.log('[Luna Content] BG error:', e.message));
            'sent from ctx2'
          `,
          contextId: 2,
          returnByValue: true
        }
      }));
    }, 1000);
  });

  setTimeout(() => {
    ws.close();
  }, 4000);
}

check().catch(e => console.error(e.message));
