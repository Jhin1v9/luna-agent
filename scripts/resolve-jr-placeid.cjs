/* Valida o g.page oficial: nome, coordenadas e placeid reais */
const { chromium } = require(require.resolve('playwright-core', { paths: ['apps/whatsplay/src'] }));

(async () => {
  const exe = `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1234/chrome-win64/chrome.exe`;
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  try {
    const ctx = await browser.newContext({ locale: 'es-ES' });
    const page = await ctx.newPage();
    await page.goto('https://g.page/r/CRDnWdhQ6ygGEAE/review', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    if (page.url().includes('consent.google.com')) {
      await page.locator('button:has-text("Aceptar todo"), button:has-text("Accept all")').first().click({ timeout: 8000 });
      await page.waitForTimeout(10000);
    }
    await page.waitForTimeout(6000);
    const url = page.url();
    console.log('URL:', url.slice(0, 260));
    const coords = url.match(/!3d(-?[0-9.]+)!4d(-?[0-9.]+)/);
    console.log('COORDS:', coords ? `${coords[1]}, ${coords[2]}` : 'n/d');
    const html = await page.content();
    const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1];
    console.log('TITLE:', title);
    const ids = [...new Set(html.match(/ChIJ[A-Za-z0-9_-]{10,}/g) || [])];
    console.log('PLACEIDS:', JSON.stringify(ids.slice(0, 4)));
    const labels = [...new Set((html.match(/aria-label="([^"]{4,80})"/g) || []).map(s => s.slice(12, -1)))].filter(t => /junior|jr|reforma|reseña|658/i.test(t));
    console.log('LABELS:', JSON.stringify(labels.slice(0, 12)));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
