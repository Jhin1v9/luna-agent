const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.join(os.tmpdir(), 'kimi-dom-dump.json');

async function dump(page) {
  return await page.evaluate(() => {
    const cls = (el) => typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
    const describe = (sel) => Array.from(document.querySelectorAll(sel)).slice(0, 15).map(el => ({
      tag: el.tagName,
      class: cls(el).slice(0, 220),
      id: el.id,
      text: (el.innerText || '').slice(0, 400),
      html: el.outerHTML.slice(0, 800),
    }));
    const r = {};
    r.url = location.href;
    r.input = describe('.chat-input-editor, [contenteditable="true"]');
    r.send = describe('.send-button-container, .chat-editor-action');
    r.messageList = describe('.message-list-container, .message-list');
    r.messages = describe('.message-list > *, .message-list-container > *');
    r.assistant = describe('[class*="assistant"], [class*="bot"], [class*="agent"], [class*="model"], [data-message-role="assistant"]');
    r.markdown = describe('.markdown-container, .markdown-body, .prose, [class*="markdown"]');
    r.thinking = describe('[class*="thinking"], [class*="reasoning"], [class*="thought"]');
    r.segment = describe('[class*="segment"]');
    r.code = describe('pre code');
    r.allMessageClasses = Array.from(document.querySelectorAll('.message-list > *, .message-list-container > *')).map(el => cls(el).slice(0, 220));
    return r;
  });
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  let page = context.pages.find(p => p.url().includes('kimi.com'));
  if (!page) {
    page = await context.newPage();
    await page.goto('https://www.kimi.com/en?chat_enter_method=new_chat', { timeout: 60000, waitUntil: 'networkidle' });
  }
  console.log('URL', page.url());

  // Focus and type via keyboard
  const input = page.locator('.chat-input-editor').first();
  await input.click();
  await page.waitForTimeout(300);
  await page.keyboard.type('say hi');
  await page.waitForTimeout(500);

  // Click send
  const send = page.locator('.send-button-container').first();
  await send.click();
  console.log('clicked send');

  // Wait and dump
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(3000);
    const d = await dump(page);
    fs.writeFileSync(OUT, JSON.stringify(d, null, 2));
    console.log('dump', i, 'url', d.url, 'msgs', d.messages.length, 'assistant', d.assistant.length);
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
