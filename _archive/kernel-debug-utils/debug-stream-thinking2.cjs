const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.join(os.tmpdir(), 'kimi-stream-thinking2.jsonl');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const contexts = browser.contexts();
  let page;
  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      if (p.url().includes('kimi.com')) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.error('no kimi page'); process.exit(1); }

  fs.writeFileSync(OUT, '');

  const msg = 'explique detalhadamente o conceito de mirror agent em 3 parágrafos';

  // Usa content script approach para preencher contenteditable
  await page.evaluate((text) => {
    const input = document.querySelector('.chat-input-editor');
    if (!input) return { ok: false };
    input.focus();
    input.innerHTML = '';
    const lines = text.split('\n');
    for (const line of lines) {
      if (line) input.appendChild(document.createTextNode(line));
      input.appendChild(document.createElement('br'));
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Enter para enviar
    setTimeout(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    }, 200);
    return { ok: true };
  }, msg);

  console.log('mensagem enviada via Enter');

  const SELECTORS = {
    thinkingContainer: '.toolcall-container.thinking-container,.thinking-container,[class*="thinking-container"]',
    thinkingText: '.toolcall-container.thinking-container .markdown-container,.toolcall-container.thinking-container .markdown,.thinking-container .markdown-container,.thinking-container .markdown,[class*="thinking-container"] .markdown-container'
  };

  let prevLen = 0;
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 100));
    const info = await page.evaluate((sels) => {
      function safeText(el) { return (el.textContent || '').trim(); }
      function className(el) { return (el.className || '').toLowerCase(); }
      function isCopyButton(el) {
        const text = (el.textContent || '').toLowerCase();
        const cls = className(el);
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        return text.includes('copy') || cls.includes('copy') || aria.includes('copy');
      }
      function isCodeElement(el) {
        const tag = (el.tagName || '').toLowerCase();
        const cls = className(el);
        return tag === 'pre' || tag === 'code' || cls.includes('code') || cls.includes('language-');
      }
      function collectText(root) {
        let text = '';
        const walk = (node) => {
          if (node.nodeType === Node.TEXT_NODE) { text += node.textContent || ''; return; }
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          if (isCopyButton(node)) return;
          if (isCodeElement(node)) {
            const cls = className(node);
            const isJsonBlock = cls.includes('json') || /["']tool["']|"response"/.test(node.textContent || '');
            if (!isJsonBlock) return;
          }
          for (const child of node.childNodes) walk(child);
        };
        walk(root);
        return text.trim();
      }
      function stripHeader(t) {
        return t.replace(/^\s*(Think|Thinking|Pensando|Analisando|Raciocínio|Raciocinando|Concluído|Concluindo|Reasoning|Processando|Searching|Buscando)\s*[.:]?\s*/i, '').trim();
      }
      function extractThinking(container) {
        if (!container) return '';
        let combined = '';
        const nodes = container.querySelectorAll(sels.thinkingText);
        const keep = [];
        for (const node of nodes) {
          const hasDescendant = Array.from(nodes).some(other => other !== node && node.contains(other));
          if (!hasDescendant) keep.push(node);
        }
        for (const node of keep) {
          const t = collectText(node);
          if (t) combined += t + '\n\n';
        }
        if (combined) return stripHeader(combined);
        return stripHeader(collectText(container));
      }

      const assistants = Array.from(document.querySelectorAll('.segment.segment-assistant, .chat-content-item.chat-content-item-assistant'));
      const lastAssistant = assistants[assistants.length - 1];
      const thinkingContainer = lastAssistant?.querySelector(sels.thinkingContainer);
      const thinking = thinkingContainer ? extractThinking(thinkingContainer) : '';
      return {
        assistantsCount: assistants.length,
        lastAssistantClass: lastAssistant?.className,
        thinkingFound: !!thinkingContainer,
        thinkingLen: thinking.length,
        thinking: thinking.slice(0, 400)
      };
    }, SELECTORS);
    fs.appendFileSync(OUT, JSON.stringify({ step: i, time: Date.now(), ...info }) + '\n');
    if (info.thinkingLen !== prevLen || info.thinkingLen > 0) {
      prevLen = info.thinkingLen;
      console.log(i, 'assistants=' + info.assistantsCount, 'thinkingLen=' + info.thinkingLen, info.thinking.slice(0, 100));
    }
  }

  await browser.close();
  console.log('salvo em', OUT);
}

main().catch(e => { console.error(e); process.exit(1); });
