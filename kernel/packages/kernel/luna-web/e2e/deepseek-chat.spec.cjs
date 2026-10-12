const { test, expect } = require('@playwright/test');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3458';
const SESSION_ID = process.env.SESSION_ID || 'web-mqxqsz77-jwcf';

const screenshot = async (page, name) => {
  const p = path.join('/home/jhin', `luna-e2e-${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log('screenshot:', p);
};

test('deepseek provider chat e2e', async ({ page }) => {
  const messages = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[SSE]') || text.includes('EventSource') || text.includes('error') || text.includes('ERR_')) {
      messages.push(`${msg.type()}: ${text}`);
    }
  });
  page.on('pageerror', err => messages.push(`PAGEERROR: ${err.message}`));
  page.on('requestfailed', req => messages.push(`REQFAIL: ${req.method()} ${req.url()} => ${req.failure()?.errorText}`));

  // 1. login
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="text"], input[name="username"], input[placeholder*="usuário" i], input[placeholder*="email" i]', 'teste');
  await page.fill('input[type="password"]', 'teste123');
  await page.click('button[type="submit"], button:has-text("Entrar")');
  await page.waitForURL(/\?session=|dashboard/, { timeout: 10000 }).catch(() => {});

  // 2. open deepseek session
  await page.goto(`${BASE_URL}/?session=${SESSION_ID}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await screenshot(page, '01-deepseek-session-loaded');

  // 3. check provider label
  const headerText = await page.locator('header, .chat-header, [class*="header"]').first().textContent().catch(() => '');
  console.log('header text:', headerText);
  expect(headerText.toLowerCase()).toContain('deepseek');

  // 4. wait for SSE connected (poll status or console)
  await page.waitForTimeout(3000);

  // 5. send a unique message
  const unique = `teste deepseek e2e ${Date.now()}`;
  const input = page.locator('textarea, input[type="text"]').first();
  await input.fill(unique);
  await input.press('Enter');
  await page.waitForTimeout(2000);
  await screenshot(page, '02-deepseek-message-sent');

  // 6. wait for assistant response (up to 60s)
  const assistant = page.locator('[data-role="assistant"], .assistant-message, .message.assistant, .message:has(.assistant)').last();
  await expect.poll(async () => {
    const txt = await assistant.textContent().catch(() => '');
    return txt.trim().length;
  }, { timeout: 60000 }).toBeGreaterThan(10);

  await screenshot(page, '03-deepseek-response');
  console.log('assistant response:', await assistant.textContent());
  console.log('browser messages:', messages.join('\n'));
});
