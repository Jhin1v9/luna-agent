const WebSocket = require('ws');
const http = require('http');

const TARGET_URL = 'http://127.0.0.1:9222';

async function fetchTargets() {
  return new Promise((resolve, reject) => {
    http.get(`${TARGET_URL}/json/list`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Date.now() + Math.random();
    const handler = (msg) => {
      const data = JSON.parse(msg);
      if (data.id === id) {
        ws.off('message', handler);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluateOnTarget(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  const { result } = await send(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    includeCommandLineAPI: false,
    userGesture: true,
  });

  ws.close();
  return result.value;
}

(async () => {
  const targets = await fetchTargets();
  const page = targets.find(t => t.type === 'page' && t.url.includes('kimi.com/chat'));
  if (!page) {
    console.log('No kimi chat page target found');
    console.log(JSON.stringify(targets.map(t => ({ type: t.type, url: t.url })), null, 2));
    process.exit(1);
  }

  console.log('Target:', page.url);

  const dumpScript = `(() => {
    function allMatches(root, sels) {
      const seen = new Set();
      const out = [];
      for (const sel of sels) {
        for (const el of root.querySelectorAll(sel)) {
          if (!seen.has(el)) { seen.add(el); out.push(el); }
        }
      }
      return out;
    }
    function firstMatch(root, sels) {
      for (const sel of sels) {
        const el = root.querySelector(sel);
        if (el) return el;
      }
      return null;
    }
    const cls = (el) => el ? (typeof el.className === 'string' ? el.className : el.className?.baseVal || '') : '';
    const t = (el) => el ? (el.innerText || '').slice(0, 400) : '';
    const assistants = allMatches(document, ['.chat-content-item.chat-content-item-assistant', '.segment.segment-assistant', '.segment-assistant']);
    return {
      url: location.href,
      assistantCount: assistants.length,
      assistants: assistants.map((a, i) => {
        const thinking = firstMatch(a, ['.toolcall-container.thinking-container', '.thinking-container']);
        const contentBox = firstMatch(a, ['.segment-content-box', '.markdown-container']);
        const mds = contentBox ? allMatches(contentBox, ['.markdown-container']) : [];
        const codes = allMatches(a, ['pre code', '.segment-code']);
        return {
          idx: i,
          className: cls(a),
          thinkingClass: cls(thinking),
          thinkingText: t(thinking),
          markdownCount: mds.length,
          markdowns: mds.map(m => ({ className: cls(m), text: t(m) })),
          codeBlocks: codes.map(c => ({ className: cls(c), text: t(c), parentClass: cls(c.parentElement) }))
        };
      })
    };
  })()`;

  const result = await evaluateOnTarget(page.webSocketDebuggerUrl, dumpScript);
  console.log(JSON.stringify(result, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
