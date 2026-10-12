const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Find the original logged-in DeepSeek page (not the one we just navigated to)
  // Prefer pages with textarea (logged-in chat interface)
  const deepseekPage = pages.find(p => p.url().includes('chat.deepseek.com'));
  
  if (!deepseekPage) {
    console.error('DeepSeek page not found');
    await browser.close();
    process.exit(1);
  }
  
  const info = await deepseekPage.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    hasInput: !!document.querySelector('textarea'),
    inputPlaceholder: document.querySelector('textarea')?.placeholder,
    inputOuter: document.querySelector('textarea')?.outerHTML?.slice(0, 300),
    sendBtn: !!document.querySelector("button[type='submit']"),
    messageCount: document.querySelectorAll('.ds-message').length,
    bodyText: document.body.innerText.slice(0, 300)
  }));
  
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
