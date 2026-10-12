const http = require('http');

const BASE = 'http://localhost:3458';
const SESSION_ID = 'web-test-response-' + Date.now();

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      BASE + path,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (chunk) => (buf += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            resolve({ raw: buf });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function connectSSE(sessionId, onEvent) {
  return new Promise((resolve, reject) => {
    const url = `${BASE}/api/chat/stream?sessionId=${encodeURIComponent(sessionId)}&lastAck=0`;
    const req = http.request(url, { method: 'GET', headers: { Accept: 'text/event-stream' } }, (res) => {
      let buf = '';
      const handleChunk = (chunk) => {
        buf += chunk;
        // normalize line endings
        const normalized = buf.replace(/\r\n/g, '\n');
        const blocks = normalized.split('\n\n');
        buf = blocks.pop();
        for (const block of blocks) {
          const m = block.match(/^data:\s*(.+)/m);
          if (!m) continue;
          try {
            const ev = JSON.parse(m[1]);
            onEvent(ev);
          } catch (e) {
            // ignore parse errors
          }
        }
      };
      res.on('data', handleChunk);
      res.on('end', () => {
        handleChunk('');
        resolve();
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const events = [];
  const start = Date.now();

  const ssePromise = connectSSE(SESSION_ID, (ev) => {
    ev._receivedAt = Date.now() - start;
    events.push(ev);
    const preview =
      ev.text?.slice(0, 80) ||
      ev.response?.slice(0, 80) ||
      ev.thinking?.slice(0, 80) ||
      JSON.stringify(ev).slice(0, 80);
    console.log(`[${ev._receivedAt}ms] ${ev.type}: ${preview}`);
  });

  // wait a bit for SSE to connect
  await new Promise((r) => setTimeout(r, 800));

  console.log('Sending message to', SESSION_ID);
  const sendRes = await post('/api/chat', {
    sessionId: SESSION_ID,
    message: 'oi luna, me fala o que voce esta pensando agora detalhadamente',
    mode: 'instant',
  });
  console.log('Send response:', sendRes);

  // Keep SSE open for a fixed duration
  await new Promise((r) => setTimeout(r, 60000));

  console.log('\n=== EVENT SUMMARY ===');
  console.log('Total events:', events.length);
  const done = events.find((e) => e.type === 'done');
  if (done) {
    console.log('Done response length:', done.response?.length);
    console.log('Done thinking length:', done.thinking?.length);
    console.log('Done response preview:', done.response?.slice(0, 200));
  }
  const assistant = events.find((e) => e.type === 'assistant');
  if (assistant) {
    console.log('Assistant content length:', assistant.content?.length);
    console.log('Assistant preview:', assistant.content?.slice(0, 200));
  }

  const fs = require('fs');
  const path = require('path');
  const out = path.join(__dirname, `test-api-response-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(events, null, 2));
  console.log('Events saved to', out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
