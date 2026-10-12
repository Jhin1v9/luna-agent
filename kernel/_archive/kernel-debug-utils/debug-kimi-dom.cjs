const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const kimiPage = pages.find(p => p.url().includes('kimi.com'));
  if (!kimiPage) {
    console.log('Kimi page not found');
    return;
  }
  console.log('URL:', kimiPage.url());

  const result = await kimiPage.evaluate(() => {
    const assistants = document.querySelectorAll('.segment.segment-assistant, .chat-content-item-assistant, [data-message-role="assistant"]');
    const lastAssistant = assistants[assistants.length - 1];
    if (!lastAssistant) return { error: 'no assistant' };

    const thinkContainer = lastAssistant.querySelector('.toolcall-container.thinking-container, .thinking-container, [class*="thinking-container"]');
    return {
      assistantClass: lastAssistant.className,
      assistantTextLength: (lastAssistant.innerText || '').length,
      assistantTextStart: (lastAssistant.innerText || '').slice(0, 200),
      thinkFound: !!thinkContainer,
      thinkClass: thinkContainer ? thinkContainer.className : '',
      thinkInnerTextLength: thinkContainer ? (thinkContainer.innerText || '').length : 0,
      thinkInnerTextStart: thinkContainer ? (thinkContainer.innerText || '').slice(0, 500) : '',
      thinkTextContentLength: thinkContainer ? (thinkContainer.textContent || '').length : 0,
      thinkTextContentStart: thinkContainer ? (thinkContainer.textContent || '').slice(0, 500) : '',
      thinkHtmlStart: thinkContainer ? thinkContainer.outerHTML.slice(0, 2000) : '',
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
