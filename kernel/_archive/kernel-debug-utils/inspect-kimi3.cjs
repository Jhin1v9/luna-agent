const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  try {
    const code = fs.readFileSync('luna-extension/injected.js', 'utf8');
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const context = browser.contexts()[0];
    const pages = context.pages();
    for (const p of pages) {
      const url = await p.url();
      if (url.includes('kimi.com')) {
        // Check if Luna observer is already injected
        const hasObserver = await p.evaluate(() => !!window.__lunaDomObserver);
        console.log('Has Luna observer:', hasObserver, 'version:', await p.evaluate(() => window.__lunaObserverVersion));
        // Force re-inject our current version
        await p.evaluate((src) => { eval(src); }, code);
        await new Promise(r => setTimeout(r, 300));
        const result = await p.evaluate(() => {
          return new Promise((resolve) => {
            let events = [];
            const handler = (e) => {
              if (e.data && e.data.source === 'luna-injected') {
                events.push(...e.data.events);
              }
            };
            window.addEventListener('message', handler);
            // Trigger a manual detect after a short delay
            setTimeout(() => {
              window.removeEventListener('message', handler);
              resolve(events);
            }, 500);
          });
        });
        console.log('Events from fresh observer:', JSON.stringify(result, null, 2));
      }
    }
    await browser.close();
  } catch (e) {
    console.error('Error:', e.message, e.stack);
  }
})();
