const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const injectedSrc = fs.readFileSync(path.join(__dirname, 'packages/kernel/luna-extension/injected.js'), 'utf-8');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  for (const p of pages) {
    if (p.url().includes('kimi.com')) {
      console.log('Reloading observer on', p.url());
      await p.evaluate((script) => {
        // Tear down old observer if present
        try {
          if (window.__lunaDomObserver && typeof window.__lunaDomObserver.teardown === 'function') {
            window.__lunaDomObserver.teardown();
          }
        } catch (e) {}
        const old = document.getElementById('__luna-dom-observer-script');
        if (old) old.remove();
        const el = document.createElement('script');
        el.id = '__luna-dom-observer-script';
        el.textContent = script;
        (document.head || document.documentElement).appendChild(el);
      }, injectedSrc);
      await new Promise(r => setTimeout(r, 500));
      const version = await p.evaluate(() => window.__lunaObserverVersion);
      console.log('Observer version after reload:', version);
    }
  }
  await browser.close();
})();
