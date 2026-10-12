const { chromium } = require('playwright');
(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const context = browser.contexts()[0];
    const pages = context.pages();
    const kimiPage = pages.find(p => p.url().includes('kimi.com/chat'));
    if (!kimiPage) {
      console.log('No kimi chat page found');
      await browser.close();
      return;
    }
    const result = await kimiPage.evaluate(() => {
      const assistant = document.querySelector('.segment.segment-assistant');
      const thinkingContainer = assistant ? assistant.querySelector('.toolcall-container.thinking-container, .thinking-container, [class*="thinking-container"]') : null;
      const responseContainer = assistant ? assistant.querySelector('.segment-content-box') : null;
      const thinkingText = thinkingContainer ? (thinkingContainer.innerText || '').slice(0, 300) : 'null';
      const responseText = responseContainer ? (responseContainer.innerText || '').slice(0, 300) : 'null';
      return {
        assistantFound: !!assistant,
        thinkingFound: !!thinkingContainer,
        thinkingClass: thinkingContainer?.className,
        responseClass: responseContainer?.className,
        thinkingText,
        responseText
      };
    });
    console.log(JSON.stringify(result, null, 2));
    await browser.close();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
