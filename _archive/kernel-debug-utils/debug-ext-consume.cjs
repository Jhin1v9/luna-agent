const path = require('path');
process.env.LUNA_KERNEL_DIR = path.join(__dirname);
const { KimiBridge } = require('./kimi-bridge.cjs');

async function main() {
  const bridge = new KimiBridge({});
  const buffers = global.__lunaExtensionEventBuffers;
  console.log('Buffers size:', buffers ? buffers.size : 0);
  if (!buffers) return;
  for (const [sid, buf] of buffers) {
    console.log('Session', sid, 'events:', buf.length);
    for (const ev of buf) {
      console.log('  ->', ev.eventType, JSON.stringify({ t: (ev.data?.thinking||'').length, r: (ev.data?.response||'').length, url: ev.tabUrl || ev.url }));
    }
  }
  // Try consume with exact URL
  const url = 'https://www.kimi.com/chat/19fc6b0a-07d2-82ef-8000-09b582394a71';
  const events = bridge._consumeExtensionEvents(url);
  console.log('Consumed events:', events.length);
  for (const ev of events) {
    console.log('  ->', ev.type, { t: (ev.thinking||'').length, r: (ev.response||'').length });
  }
}
main().catch(e => console.error(e));
