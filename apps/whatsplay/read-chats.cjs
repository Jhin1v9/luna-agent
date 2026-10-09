// Abre chats via CDP, extrai últimas mensagens e tira print de cada.
// Uso: node read-chats.cjs <nome1> <nome2> ...
const { chromium } = require('playwright-core');

const CHATS = process.argv.slice(2);

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('web.whatsapp.com')) ?? ctx.pages()[0];
  await page.waitForTimeout(1500);

  for (const name of CHATS) {
    try {
      // busca o chat (seletor oficial do whatsplay: search-input)
      const search = page.locator('[data-testid="search-input"] input, [data-testid="search-input"], input[placeholder*="Buscar" i], input[placeholder*="Pesquisar" i]').first();
      await search.click();
      await search.fill('');
      await page.waitForTimeout(300);
      await search.fill(name.slice(0, 20));
      await page.waitForTimeout(1200);
      const item = page.locator(`span[title="${name}"]`).first();
      if (!(await item.count())) {
        console.log(`== "${name}": NAO ENCONTRADO NA LISTA`);
        await page.keyboard.press('Escape');
        continue;
      }
      await item.click();
      await page.waitForTimeout(1800);
      const msgs = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('div.message-in, div.message-out')).slice(-15);
        return rows.map((r) => {
          const text = (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220);
          return (r.classList.contains('message-out') ? 'OUT: ' : 'IN: ') + text;
        });
      });
      console.log(`== "${name}":`);
      for (const m of msgs) console.log('  ', m);
      const safe = name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
      await page.screenshot({ path: `tmp/chat-${safe}.png` });
    } catch (e) {
      console.log(`== "${name}": ERRO ${e.message.slice(0, 100)}`);
    }
  }
  // fecha o painel (decreto: nunca deixar chat aberto)
  await page.keyboard.press('Escape');
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
