const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3458';
const SESSION_ID = process.env.SESSION_ID || 'web-mqxqsz77-jwcf';

const screenshot = async (page, name) => {
  const p = path.join('/home/jhin', `luna-e2e-${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log('screenshot:', p);
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const messages = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[SSE]') || text.includes('EventSource') || text.toLowerCase().includes('error') || text.includes('ERR_')) {
      messages.push(`${msg.type()}: ${text}`);
    }
  });
  page.on('pageerror', err => messages.push(`PAGEERROR: ${err.message}`));
  page.on('requestfailed', req => messages.push(`REQFAIL: ${req.method()} ${req.url()} => ${req.failure()?.errorText}`));

  try {
    // 1. login
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');
    await screenshot(page, '00-login');
    await page.fill('input[type="text"], input[name="username"], input[placeholder*="usuário" i], input[placeholder*="email" i]', 'teste');
    await page.fill('input[type="password"]', 'teste123');
    await page.click('button[type="submit"], button:has-text("Entrar")');
    await page.waitForURL(/\?session=|dashboard/, { timeout: 10000 }).catch(() => {});

    // 1.5 close news modal if present
    try {
      await page.locator('button:has-text("Continuar")').click({ timeout: 5000 });
      await page.waitForTimeout(500);
    } catch (e) {}

    // 2. open deepseek session from sidebar
    await page.locator('.sessions-list, [class*="session"]').locator('text=DeepSeek Test 2').first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await screenshot(page, '01-deepseek-session-loaded');

    // 3. check provider label
    const providerName = await page.locator('.provider-name').first().textContent({ timeout: 5000 }).catch(() => '');
    console.log('provider name:', providerName);
    if (!providerName.toLowerCase().includes('deepseek')) {
      throw new Error(`Expected DeepSeek provider, got: ${providerName}`);
    }

    // 4. wait a bit for SSE
    await page.waitForTimeout(3000);

    // 5. send a unique message
    const unique = `teste deepseek e2e ${Date.now()}`;
    const input = page.locator('.chat-textarea');
    await input.click();
    await input.fill(unique);
    await page.locator('.send-btn').click();
    await page.waitForTimeout(1000);
    await screenshot(page, '02-deepseek-message-sent');

    // 6. wait for assistant response (up to 60s)
    await page.waitForSelector(`.message-content:has-text("${unique}")`, { timeout: 10000 });
    const assistant = page.locator('.assistant-message .message-body').last();
    let lastText = '';
    const start = Date.now();
    while (Date.now() - start < 60000) {
      lastText = await assistant.textContent().catch(() => '');
      if (lastText.trim().length > 10) break;
      await page.waitForTimeout(1000);
    }
    if (lastText.trim().length <= 10) throw new Error('No assistant response rendered');

    await screenshot(page, '03-deepseek-response');
    console.log('assistant response:', lastText);
  } finally {
    console.log('browser messages:', messages.join('\n'));
    await browser.close();
  }
})();
