const { chromium } = require('playwright');
(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const context = browser.contexts()[0];
    const pages = context.pages();
    for (const p of pages) {
      const url = await p.url();
      if (url.includes('kimi.com')) {
        const result = await p.evaluate(() => {
          const assistant = document.querySelector('.segment.segment-assistant');
          if (!assistant) return { error: 'no assistant' };
          const thinkContainer = assistant.querySelector('.toolcall-container.thinking-container');
          const responseBlocks = assistant.querySelectorAll('.block-item');
          const blocks = [];
          responseBlocks.forEach((block, idx) => {
            const isThink = block.querySelector('.toolcall-container.thinking-container') !== null;
            const code = block.querySelector('pre code, .segment-code');
            const paragraphs = Array.from(block.querySelectorAll('p, .paragraph, .markdown')).map(el => el.textContent);
            blocks.push({ idx, isThink, text: block.textContent.slice(0, 300), code: code ? code.textContent.slice(0, 300) : null, paragraphs });
          });
          return {
            thinkHtml: thinkContainer ? thinkContainer.outerHTML : null,
            thinkText: thinkContainer ? thinkContainer.textContent : null,
            blocks
          };
        });
        console.log(JSON.stringify(result, null, 2));
      }
    }
    await browser.close();
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
