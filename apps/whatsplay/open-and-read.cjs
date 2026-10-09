const { chromium } = require('playwright-core');
const NAME = process.argv[2];
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('web.whatsapp.com')) ?? ctx.pages()[0];
  await page.waitForTimeout(1200);

  const container = page.locator('[data-testid="chat-list-search-container"]').first();
  await container.click();
  await page.waitForTimeout(500);
  const input = container.locator('input, div[contenteditable="true"]').first();
  await input.fill(NAME.slice(0, 20)).catch(async () => {
    await input.click({ clickCount: 3 });
    await page.keyboard.type(NAME.slice(0, 20), { delay: 40 });
  });
  await page.waitForTimeout(1800);

  const found = await page.evaluate((n) => {
    const els = Array.from(document.querySelectorAll('span[title]'));
    const exact = els.find((e) => e.getAttribute('title') === n);
    if (!exact) return { ok: false, titles: els.slice(0, 8).map((e) => e.getAttribute('title')) };
    exact.click();
    return { ok: true };
  }, NAME);
  console.log('selecao:', JSON.stringify(found));
  if (!found.ok) { await browser.close(); process.exit(0); }
  await page.waitForTimeout(2500);

  const msgs = await page.evaluate(() => {
    const copyables = Array.from(document.querySelectorAll('.copyable-text')).slice(-14);
    return copyables.map((el) => {
      let p = el;
      let out = false;
      for (let i = 0; i < 6 && p; i++) {
        if (/message-out/.test(p.className || '')) { out = true; break; }
        if (/message-in/.test(p.className || '')) break;
        p = p.parentElement;
      }
      return (out ? 'OUT: ' : 'IN: ') + (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 700);
    });
  });
  for (const m of msgs) console.log(m);
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
