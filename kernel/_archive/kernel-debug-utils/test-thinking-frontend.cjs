const http = require('http');

const BASE = 'http://localhost:3458';
const SESSION_ID = 'web-test-thinking-' + Date.now();

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

async function main() {
  const events = [];
  const start = Date.now();

  // Primeiro conecta SSE
  const ssePromise = new Promise((resolve, reject) => {
    const url = `${BASE}/api/chat/stream?sessionId=${encodeURIComponent(SESSION_ID)}&lastAck=0`;
    const req = http.request(url, { method: 'GET', headers: { Accept: 'text/event-stream' } }, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString();
        const normalized = buf.replace(/\r\n/g, '\n');
        const blocks = normalized.split('\n\n');
        buf = blocks.pop();
        for (const block of blocks) {
          const lines = block.split('\n');
          const dataLines = lines.filter(l => l.startsWith('data:'));
          for (const line of dataLines) {
            const payload = line.slice(5).trim();
            try {
              const ev = JSON.parse(payload);
              ev._receivedAt = Date.now() - start;
              events.push(ev);
              const preview =
                ev.fullText?.slice(0, 80) ||
                ev.text?.slice(0, 80) ||
                ev.response?.slice(0, 80) ||
                ev.content?.slice(0, 80) ||
                JSON.stringify(ev).slice(0, 80);
              console.log(`[${ev._receivedAt}ms] ${ev.type}: ${preview}`);
            } catch {}
          }
        }
      });
      res.on('end', () => resolve());
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });

  await new Promise(r => setTimeout(r, 500));

  console.log('\nEnviando mensagem para', SESSION_ID);
  const sendRes = await post('/api/chat', {
    sessionId: SESSION_ID,
    message: 'oi luna, me fala o que voce esta pensando agora detalhadamente',
    mode: 'instant',
    clientMessageId: 'msg-test-thinking-' + Date.now(),
  });
  console.log('Send response:', sendRes);

  await new Promise(r => setTimeout(r, 60000));

  console.log('\n=== RESUMO ===');
  console.log('Total events:', events.length);
  const thinkingUpdates = events.filter(e => e.type === 'thinking_update');
  const thinkingDeltas = events.filter(e => e.type === 'thinking_delta');
  const thinkingStarts = events.filter(e => e.type === 'thinking_start');
  console.log('thinking_start:', thinkingStarts.length);
  console.log('thinking_update:', thinkingUpdates.length);
  console.log('thinking_delta:', thinkingDeltas.length);
  thinkingUpdates.forEach((e, i) => {
    console.log(`thinking_update #${i}: len=${e.fullText?.length || 0} text=${(e.fullText || '').slice(0, 120)}`);
  });
  const done = events.find(e => e.type === 'done');
  if (done) {
    console.log('done response len:', (done.response || done.result?.response || '').length);
  }

  const fs = require('fs');
  const path = require('path');
  const out = path.join(__dirname, `test-thinking-frontend-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(events, null, 2));
  console.log('\nEventos salvos em', out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
