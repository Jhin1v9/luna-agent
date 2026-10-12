const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.join(os.tmpdir(), 'kimi-dom-dump.json');

async function dump(page) {
  return await page.evaluate(() => {
    const cls = (el) => typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
    const describe = (sel) => Array.from(document.querySelectorAll(sel)).slice(0, 10).map(el => ({
      tag: el.tagName,
      class: cls(el).slice(0, 200),
      id: el.id,
      placeholder: el.placeholder,
      text: (el.innerText || '').slice(0, 300),
      html: el.outerHTML.slice(0, 600),
    }));
    const r = {};
    r.url = location.href;
    r.input = describe('.chat-input-editor, [contenteditable="true"]');
    r.send = describe('.send-button-container');
    r.messageList = describe('.message-list, .message-list-container');
    r.messages = describe('.message-list > *, .message-list-container > *');
    r.assistant = describe('[class*="assistant"], [class*="bot"], [class*="model"]');
    r.markdown = describe('.markdown-container, .markdown-body, .prose');
    r.thinking = describe('[class*="thinking"], [class*="reasoning"]');
    r.segment = describe('[class*="segment"]');
    r.code = describe('pre code');
    r.allMessageClasses = Array.from(document.querySelectorAll('.message-list > *, .message-list-container > *')).map(el => cls(el).slice(0, 200));
    return r;
  });
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  await page.goto('https://www.kimi.com/en?chat_enter_method=new_chat', { timeout: 60000, waitUntil: 'networkidle' });
  console.log('loaded', page.url());

  // Dump initial state
  fs.writeFileSync(OUT, JSON.stringify(await dump(page), null, 2));

  // Type and send
  const input = page.locator('.chat-input-editor').first();
  await input.click();
  await input.fill('hi');
  await page.waitForTimeout(500);
  const send = page.locator('.send-button-container').first();
  await send.click();
  console.log('sent');

  // Wait and dump periodically
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(3000);
    const d = await dump(page);
    fs.writeFileSync(OUT, JSON.stringify(d, null, 2));
    console.log('dump', i, 'url', d.url, 'messages', d.messages.length, 'assistant', d.assistant.length);
  }

  // Keep alive
  console.log('keeping alive...');
  setInterval(async () => {
    try {
      const d = await dump(page);
      fs.writeFileSync(OUT, JSON.stringify(d, null, 2));
      console.log('heartbeat messages', d.messages.length);
    } catch (e) { console.error('heartbeat err', e.message); }
  }, 5000);
})().catch(e => { console.error(e); process.exit(1); });
