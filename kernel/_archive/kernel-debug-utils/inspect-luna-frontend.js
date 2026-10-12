const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhYm5lciIsImlhdCI6MTc4MjUzMDM1MSwiZXhwIjoxNzgyNTU5MTUxfQ.FUZreC8x0PcN4C1xCHMTUhA7O41QmzsYC3l1LP702ig';
  // Simulate having a persisted session
  await page.goto('http://localhost:3458', { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    localStorage.setItem('luna_token', t);
    localStorage.setItem('luna_user', JSON.stringify({ id: 'abner', name: 'Abner' }));
    localStorage.setItem('luna_current_session', JSON.stringify({ id: 'web-mqvz9ceq-s2y1' }));
  }, token);
  await page.goto('http://localhost:3458/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  try { await page.click('button:has-text("Continuar")', { timeout: 2000 }); } catch (e) {}
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/luna-home-test.png' });
  const url = page.url();
  console.log('URL after opening /:', url);
  const providerBtn = await page.$('.welcome-provider-btn');
  console.log('Welcome provider button found:', !!providerBtn);
  if (providerBtn) {
    const text = await providerBtn.innerText();
    console.log('Welcome provider text:', text);
    await providerBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/luna-home-dropdown.png' });
    const options = await page.$$eval('.welcome-provider-option', opts => opts.map(o => o.innerText));
    console.log('Welcome provider options:', options);
  }
  await browser.close();
})();
