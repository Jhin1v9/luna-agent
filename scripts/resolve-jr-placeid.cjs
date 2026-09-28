/* Busca perfil do Juninho em Sabadell */
const { chromium } = require(require.resolve('playwright-core', { paths: ['apps/whatsplay/src'] }));

const QUERIES = ['Junior Reformas Sabadell', 'JR Reformas Sabadell', 'reformas jr sabadell'];

(async () => {
  const exe = `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1234/chrome-win64/chrome.exe`;
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  try {
    const ctx = await browser.newContext({ locale: 'es-ES' });
    const page = await ctx.newPage();
    for (const q of QUERIES) {
      await page.goto('https://www.google.com/maps/search/' + encodeURIComponent(q), { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(5000);
      if (page.url().includes('consent.google.com')) {
        await page.locator('button:has-text("Aceptar todo"), button:has-text("Accept all")').first().click({ timeout: 8000 });
        await page.waitForTimeout(8000);
      }
      await page.waitForTimeout(5000);
      const html = await page.content();
      const cards = [...html.matchAll(/aria-label="([^"]{3,60})"[^>]*href="[^"]*!1s(0x[0-9a-f]+:0x[0-9a-f]+)/g)];
      const fids = [...new Set(html.match(/0x[0-9a-f]{10,}:0x[0-9a-f]{10,}/g) || [])];
      console.log('===', q, '===');
      if (cards.length) for (const m of cards.slice(0, 8)) console.log('CARD:', m[1], '| fid:', m[2]);
      else console.log('FIDS:', JSON.stringify(fids.slice(0, 8)));
      const phones = [...new Set(html.match(/(658 ?187 ?071|658187071)/g) || [])];
      if (phones.length) console.log('PHONE MATCH 658187071: SIM');
    }
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
