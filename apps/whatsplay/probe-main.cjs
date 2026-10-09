const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('web.whatsapp.com')) ?? ctx.pages()[0];
  await page.screenshot({ path: 'tmp/current-chat.png' });
  const info = await page.evaluate(() => {
    const main = document.querySelector('#main');
    if (!main) return { main: false };
    const rows = Array.from(main.querySelectorAll('div[role="row"]')).length;
    const testids = {};
    main.querySelectorAll('[data-testid]').forEach((e) => {
      const t = e.getAttribute('data-testid');
      testids[t] = (testids[t] || 0) + 1;
    });
    return { main: true, rows, testids };
  });
  console.log(JSON.stringify(info, null, 1).slice(0, 2000));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
