const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.goto('http://localhost:3458/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="text"]', 'teste');
    await page.fill('input[type="password"]', 'teste123');
    await page.click('button:has-text("Entrar")');
    await page.waitForTimeout(2000);
    try { await page.locator('button:has-text("Continuar")').click({ timeout: 5000 }); } catch {}

    // Click "Nova Sessão"
    await page.locator('button:has-text("Nova Sessão")').first().click();
    await page.waitForTimeout(2000);

    const providerName = await page.locator('.provider-name').first().textContent({ timeout: 5000 }).catch(() => '');
    console.log('provider name after new session:', JSON.stringify(providerName));

    // Check for [object Object]
    if (providerName.includes('[object Object]')) {
      console.error('BUG: provider shows [object Object]');
      process.exit(1);
    }
    console.log('OK: provider is clean');
  } finally {
    await browser.close();
  }
})();
