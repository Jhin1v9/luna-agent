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
      const thinkingContainer = assistant.querySelector('.toolcall-container.thinking-container, .thinking-container, [class*="thinking-container"]');
      
      // Simulate extension extractResponse
      function safeQuery(selector, root) {
        try { return (root || document).querySelectorAll(selector); }
        catch (e) { return []; }
      }
      function safeText(el) {
        try { return (el.textContent || '').trim(); }
        catch (e) { return ''; }
      }
      function isInsideThinkingContainer(el, thinkingContainer) {
        if (!thinkingContainer || !el) return false;
        return el === thinkingContainer || thinkingContainer.contains(el);
      }
      
      const responseContainer = [
        '.markdown-container .markdown',
        '.markdown-container',
        '.segment-content-box',
        '.segment-text',
        '.message-content',
        '[class*="segment-text"]',
        '[class*="message-content"]'
      ].join(',');
      const toolContainer = '[class*="toolcall"]';
      
      let text = '';
      let skipped = [];
      let included = [];
      for (const node of safeQuery(responseContainer, assistant)) {
        const reason = isInsideThinkingContainer(node, thinkingContainer) ? 'inside-thinking' :
                       (node.closest && node.closest('.toolcall-container.thinking-container, .thinking-container, [class*="thinking-container"]')) ? 'closest-thinking' :
                       (node.closest && node.closest(toolContainer)) ? 'closest-tool' :
                       (thinkingContainer && node !== thinkingContainer && node.contains && node.contains(thinkingContainer)) ? 'contains-thinking' : 'include';
        if (reason === 'include') {
          text += safeText(node) + '\n\n';
          included.push({ class: node.className?.slice(0,100), text: safeText(node).slice(0,100) });
        } else {
          skipped.push({ class: node.className?.slice(0,100), reason });
        }
      }
      
      return {
        thinkingFound: !!thinkingContainer,
        thinkingClass: thinkingContainer?.className,
        responseText: text.trim().slice(0, 400),
        included,
        skipped
      };
    });
    console.log(JSON.stringify(result, null, 2));
    await browser.close();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
