const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  console.log('Contexts:', contexts.length);
  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      const url = page.url();
      console.log('Page URL:', url);
      if (url.includes('kimi.com')) {
        console.log('--- Kimi page found ---');
        // Check observer state
        const observerState = await page.evaluate(() => {
          return {
            hasObserver: !!window.__lunaDomObserver,
            version: window.__lunaObserverVersion,
            stats: window.__lunaDomObserver ? window.__lunaDomObserver.stats() : null,
          };
        }).catch(e => ({ error: e.message }));
        console.log('Observer state:', JSON.stringify(observerState, null, 2));

        // Probe DOM for thinking container
        const probe = await page.evaluate(() => {
          const selectors = [
            '.toolcall-container.thinking-container',
            '.thinking-container',
            '[class*="thinking-container"]',
            '[class*="think-container"]',
            '[class*="reasoning-container"]',
            '[class*="thought-container"]',
            '[class*="toolcall-container"][class*="thinking"]',
          ];
          const results = {};
          for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            results[sel] = Array.from(els).map(el => ({
              className: el.className,
              textPreview: (el.innerText || '').slice(0, 200),
              visible: !!(el.offsetParent !== null),
            }));
          }
          // Last assistant
          const assistants = document.querySelectorAll('.chat-content-item.chat-content-item-assistant, .segment.segment-assistant, [data-message-role="assistant"]');
          results.lastAssistant = assistants.length > 0 ? {
            className: assistants[assistants.length - 1].className,
            textPreview: (assistants[assistants.length - 1].innerText || '').slice(0, 300),
          } : null;
          return results;
        }).catch(e => ({ error: e.message }));
        console.log('DOM probe:', JSON.stringify(probe, null, 2));

        // Capture HTML snippet around thinking
        const snippet = await page.evaluate(() => {
          const el = document.querySelector('.toolcall-container.thinking-container, .thinking-container, [class*="thinking-container"]');
          if (!el) return null;
          return el.outerHTML.slice(0, 2000);
        }).catch(e => e.message);
        console.log('Thinking outerHTML snippet:', snippet);
      }
    }
  }
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
