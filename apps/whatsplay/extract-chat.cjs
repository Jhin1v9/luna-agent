// Extrai texto completo das mensagens visíveis no chat aberto.
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('web.whatsapp.com')) ?? ctx.pages()[0];
  await page.waitForTimeout(2500);
  const msgs = await page.evaluate(() => {
    // build atual: mensagens são div[role="row"] com message-in/message-out em algum nível
    const rows = Array.from(document.querySelectorAll('#main div[role="row"]')).filter((r) =>
      r.querySelector('[data-testid="msg-container"], .copyable-text, [data-pre-plain-text]'));
    return rows.slice(-12).map((r) => {
      const isOut = !!r.querySelector('[data-testid="msg-check"], [data-testid="msg-dblcheck"]') || /message-out/.test(r.innerHTML.slice(0, 400));
      const copyable = r.querySelector('.copyable-text');
      let text = copyable ? (copyable.textContent || '') : (r.textContent || '');
      text = text.replace(/\s+/g, ' ').trim();
      return (isOut ? 'OUT: ' : 'IN: ') + text.slice(0, 600);
    });
  });
  for (const m of msgs) console.log(m);
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
