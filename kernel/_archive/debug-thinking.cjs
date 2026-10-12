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
        // Trigger a detect and inspect internal state / extracted text.
        const result = await p.evaluate(() => {
          // The observer internals are inside the IIFE closure; expose a debug helper
          // by re-running the detect path and capturing what the page itself sends.
          const lastAssistant = window.__lunaDomObserver && window.__lunaDomObserver.stats
            ? window.__lunaDomObserver.stats()
            : null;
          return {
            version: window.__lunaObserverVersion,
            stats: lastAssistant,
            // Snapshot the thinking container HTML so we can inspect selector overlap
            assistantHtml: (() => {
              const segs = document.querySelectorAll('.segment.segment-assistant, .chat-content-item.chat-content-item-assistant, [data-message-role="assistant"]');
              const last = segs[segs.length - 1];
              if (!last) return null;
              const tc = last.querySelector('.thinking-container, [class*="thinking-container"]');
              return tc ? tc.outerHTML.slice(0, 2000) : last.outerHTML.slice(0, 2000);
            })()
          };
        });
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        console.log('error:', e.message);
      }
    }
  }
  await browser.close();
})();
