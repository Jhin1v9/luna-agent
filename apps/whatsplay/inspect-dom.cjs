const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('web.whatsapp.com')) ?? ctx.pages()[0];
  await page.screenshot({ path: 'tmp/state-now.png' });
  const info = await page.evaluate(() => {
    const ce = Array.from(document.querySelectorAll('div[contenteditable="true"]')).map((e) => ({
      ph: e.getAttribute('data-placeholder') || e.getAttribute('placeholder') || '',
      testid: e.getAttribute('data-testid') || '',
      id: e.id || '',
      parent: e.parentElement?.getAttribute('data-testid') || e.parentElement?.id || '',
      visible: e.offsetHeight > 0,
    }));
    const searchEls = Array.from(document.querySelectorAll('[data-testid*="search" i]')).map((e) => ({
      tag: e.tagName, testid: e.getAttribute('data-testid'), hasInput: !!e.querySelector('input'),
    })).slice(0, 6);
    return { contenteditables: ce, searchEls, side: !!document.querySelector('#side'), main: !!document.querySelector('#main'), app: !!document.querySelector('#app') };
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
