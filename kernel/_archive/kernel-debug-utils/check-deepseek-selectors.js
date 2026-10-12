const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const deepseekPage = pages.find(p => p.url().includes('chat.deepseek.com'));
  
  const info = await deepseekPage.evaluate(() => {
    const textarea = document.querySelector('textarea');
    const container = textarea?.closest('div[class*="aaff8b8f"], div[class*="_9a2f8e4"]') || textarea?.parentElement?.parentElement?.parentElement?.parentElement;
    
    // Find all clickable elements
    const clickable = Array.from(container.querySelectorAll('*')).filter(el => {
      const role = el.getAttribute('role');
      const tabIndex = el.getAttribute('tabindex');
      return role === 'button' || el.tagName === 'BUTTON' || el.tagName === 'A' || tabIndex !== null;
    }).map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      className: el.className?.slice(0, 100),
      ariaLabel: el.getAttribute('aria-label'),
      text: (el.innerText || '').slice(0, 100),
      outerHTML: el.outerHTML.slice(0, 300)
    }));
    
    return { clickableCount: clickable.length, clickable: clickable.slice(-5) };
  });
  
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
