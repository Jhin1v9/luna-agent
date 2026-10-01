// Screenshot da sessão WhatsApp Web + busca "HDM" (só leitura, nada enviado)
const { chromium } = require(require.resolve('playwright-core', { paths: ['apps/whatsplay/src'] }));
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9333');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages().filter(p => p.url().includes('web.whatsapp'));
  if (!pages.length) { console.error('SEM ABA WA'); process.exit(1); }
  const page = pages[0];
  const outDir = path.join(__dirname, '..', '.brain', 'luna', 'analises');
  fs.mkdirSync(outDir, { recursive: true });

  // 1) estado atual
  await page.screenshot({ path: path.join(outDir, 'wa-antes.png') });
  console.log('screenshot 1: wa-antes.png');

  // 2) busca "HDM" no campo de pesquisa
  const searchSel = '[data-testid="chat-list-search"] div[contenteditable="true"], #side div[role="textbox"][contenteditable="true"]';
  try {
    await page.click(searchSel, { timeout: 8000 });
    await page.keyboard.press('ControlOrMeta+a').catch(() => {});
    await page.keyboard.type('HDM', { delay: 60 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(outDir, 'wa-busca-hdm.png') });
    console.log('screenshot 2: wa-busca-hdm.png');
    // extrai resultados visíveis da lista
    const resultados = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#pane-side [role="listitem"]')];
      return items.slice(0, 8).map(li => {
        const title = li.querySelector('span[title]')?.getAttribute('title') || li.innerText.split('\n')[0];
        const preview = li.innerText.split('\n').slice(1, 3).join(' | ');
        return { title, preview: preview.slice(0, 120) };
      });
    });
    console.log('RESULTADOS:', JSON.stringify(resultados, null, 1));
    // limpa a busca (Escape, sem enviar nada)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  } catch (e) {
    console.error('falha na busca:', e.message);
    await page.screenshot({ path: path.join(outDir, 'wa-busca-erro.png') });
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
