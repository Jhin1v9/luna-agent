const path = require('path');
const { LUNA_KERNEL_DIR } = require(path.join('C:', 'Users', 'Abner', 'Documents', 'luna-kernel', 'apps', 'dashboard', 'lib', 'resolve-luna.cjs'));
const { KimiBridge } = require(path.join(LUNA_KERNEL_DIR, 'kimi-bridge.cjs'));
(async () => {
  const bridge = new KimiBridge({});
  await bridge.connect();
  const userId = 'debug-user';
  const stream = bridge.sendMessageStream(userId, 'oi', { mode: 'instant', newChat: true }, 'kimi');
  const timeout = setTimeout(() => { console.log('timeout'); dump(); }, 45000);
  let done = false;
  for await (const ev of stream) {
    if (['thinking_delta','response_delta','action_detected','done','error'].includes(ev.type)) {
      console.log('EVENT', ev.type, JSON.stringify(ev).slice(0, 300));
    }
    if (ev.type === 'done' || ev.type === 'error') {
      clearTimeout(timeout);
      await dump();
      process.exit(0);
    }
  }
  async function dump() {
    const page = bridge.userSessions.get(userId).page;
    const info = await page.evaluate(() => {
      const assistants = Array.from(document.querySelectorAll('.segment.segment-assistant, .chat-content-item.chat-content-item-assistant'));
      const last = assistants[assistants.length - 1];
      if (!last) return 'none';
      const think = last.querySelector('.toolcall-container.thinking-container');
      const segments = [];
      last.querySelectorAll('.segment-code').forEach((b, i) => {
        const langEl = b.querySelector('.segment-code-lang');
        segments.push({
          idx: i,
          class: b.className,
          lang: langEl ? langEl.innerText : '',
          text: (b.innerText || '').slice(0, 400),
        });
      });
      const toolcalls = [];
      last.querySelectorAll('.toolcall-container').forEach((b, i) => {
        toolcalls.push({
          idx: i,
          class: b.className,
          text: (b.innerText || '').slice(0, 400),
        });
      });
      const markdowns = [];
      last.querySelectorAll('.markdown-container, .markdown').forEach((b, i) => {
        markdowns.push({ idx: i, class: b.className, text: (b.innerText || '').slice(0, 400) });
      });
      const containerBlocks = [];
      last.querySelectorAll('.container-block').forEach((b, i) => {
        containerBlocks.push({ idx: i, html: b.outerHTML.slice(0, 5000) });
      });
      return {
        url: window.location.href,
        lastAssistantText: (last.innerText || '').slice(0, 800),
        thinkClass: think ? think.className : 'no-think',
        thinkText: think ? think.innerText.slice(0, 300) : '',
        segmentCodes: segments,
        toolcalls,
        markdowns,
        containerBlocks,
        fullHtml: last.outerHTML.slice(0, 50000)
      };
    });
    console.log('---DOM INFO---');
    console.log(JSON.stringify(info, null, 2));
  }
})().catch(e => { console.error(e); process.exit(1); });
