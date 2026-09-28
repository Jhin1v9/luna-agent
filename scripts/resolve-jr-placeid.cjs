/* Debug: abre busca Maps, tira print e faz dump do que aparece */
const { chromium } = require(require.resolve('playwright-core', { paths: ['apps/whatsplay/src'] }));

(async () => {
  const exe = `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1234/chrome-win64/chrome.exe`;
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  try {
    const ctx = await browser.newContext({ locale: 'es-ES' });
    const page = await ctx.newPage();
    await page.goto('https://www.google.com/maps/search/JR+Reformas+Integrales', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);
    if (page.url().includes('consent.google.com')) {
      await page.locator('button:has-text("Aceptar todo"), button:has-text("Accept all")').first().click({ timeout: 8000 });
      await page.waitForTimeout(8000);
    }
    console.log('URL:', page.url().slice(0, 180));
    await page.screenshot({ path: 'tmp/maps-debug.png' });
    const html = await page.content();
    console.log('SIZE:', html.length);
    const ids = [...new Set(html.match(/ChIJ[A-Za-z0-9_-]{10,}/g) || [])];
    console.log('PLACEIDS:', JSON.stringify(ids.slice(0, 6)));
    const titles = [...new Set((html.match(/aria-label="([^"]{3,60})"/g) || []).map(s => s.slice(12, -1)))].filter(t => /reforma|junior|jr/i.test(t));
    console.log('LABELS:', JSON.stringify(titles.slice(0, 10)));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
