const { chromium } = require('playwright');
(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const context = browser.contexts()[0];
    const pages = context.pages();
    console.log('Pages:', pages.length);
    for (const p of pages) {
      const url = await p.url();
      console.log('URL:', url);
      if (url.includes('kimi.com')) {
        const html = await p.content();
        // Find thinking containers
        const thinking = await p.$$eval('[class*="thinking"], [class*="think"], [class*="reasoning"], .toolcall-container', els => els.map(el => ({
          tag: el.tagName,
          class: el.className,
          text: el.textContent.slice(0, 200)
        })));
        console.log('Thinking containers:', JSON.stringify(thinking, null, 2));
        // Find last assistant segment
        const assistant = await p.$$eval('.segment-assistant, [data-message-role="assistant"], .chat-content-item-assistant', els => {
          const last = els[els.length - 1];
          return last ? {
            class: last.className,
            html: last.outerHTML.slice(0, 2000)
          } : null;
        });
        console.log('Last assistant:', JSON.stringify(assistant, null, 2));
      }
    }
    await browser.close();
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
