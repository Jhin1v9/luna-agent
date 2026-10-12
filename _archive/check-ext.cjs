const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  for (const p of pages) {
    const url = p.url();
    if (url.includes('kimi.com')) {
      console.log('Kimi page:', url);
      try {
        const version = await p.evaluate(() => window.__lunaObserverVersion || 'NOT PRESENT');
        const observer = await p.evaluate(() => !!window.__lunaDomObserver);
        const ultraLight = await p.evaluate(() => !!window.__lunaUltraLightObserver);
        const script = await p.evaluate(() => !!document.getElementById('__luna-dom-observer-script'));
        console.log('  __lunaObserverVersion:', version);
        console.log('  __lunaDomObserver:', observer);
        console.log('  __lunaUltraLightObserver:', ultraLight);
        console.log('  script present:', script);

        // Send a test postMessage that the content script should forward to the server
        await p.evaluate(() => {
          window.postMessage({ source: 'luna-injected', type: 'luna_test_ping', data: { ts: Date.now() }, timestamp: Date.now(), url: window.location.href }, '*');
        });
        console.log('  sent test ping');
      } catch (e) {
        console.log('  error:', e.message);
      }
    }
  }
  await browser.close();
})();
