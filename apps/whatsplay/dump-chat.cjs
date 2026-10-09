// Abre um chat e faz dump estrutural das mensagens (calibra seletores desta build).
const { chromium } = require('playwright-core');

const NAME = process.argv[2];

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('web.whatsapp.com')) ?? ctx.pages()[0];
  await page.waitForTimeout(1500);

  const search = page.locator('#side [data-testid="search-input"] input, #side [data-testid="search-input"], #side div[contenteditable="true"]').first();
  await search.click().catch(() => {});
  await page.waitForTimeout(400);
  await search.fill('').catch(async () => {
    await search.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
  });
  await page.waitForTimeout(300);
  await search.fill(NAME.slice(0, 20)).catch(async () => {
    await search.pressSequentially ? search.pressSequentially(NAME.slice(0, 20)) : page.keyboard.type(NAME.slice(0, 20));
  });
  await page.waitForTimeout(1500);
  const item = page.locator(`span[title="${NAME}"]`).first();
  await item.click();
  await page.waitForTimeout(2500);

  const dump = await page.evaluate(() => {
    const main = document.querySelector('#main');
    if (!main) return { error: 'sem #main' };
    // procura o container de mensagens
    const container = main.querySelector('[data-testid="conversation-panel-messages"], div[role="application"], div[tabindex="-1"]');
    const candidates = Array.from(main.querySelectorAll('div[data-testid*="msg"], div.message-in, div.message-out')).length;
    // pega todas as divs com copyable-text (mensagens de texto)
    const copyables = Array.from(main.querySelectorAll('.copyable-text')).slice(-12);
    const msgs = copyables.map((el) => {
      const row = el.closest('[class*="message"]') || el.parentElement;
      const cls = row ? row.className.slice(0, 80) : '';
      return {
        out: /message-out/.test(cls) || !!main.querySelector('[data-testid="msg-check"]'),
        cls,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      };
    });
    return { candidates, count: msgs.length, msgs };
  });
  console.log(JSON.stringify(dump, null, 1));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
