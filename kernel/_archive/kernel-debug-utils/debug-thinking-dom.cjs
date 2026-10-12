const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.join(os.tmpdir(), 'kimi-thinking-dump.jsonl');

const CDP_PORTS = [9222, 9223, 9224, 9225];

async function probePort(port) {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1500 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data.includes('Browser') || data.includes('WebKit')));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function findCdpUrl() {
  for (const port of CDP_PORTS) {
    if (await probePort(port)) return `http://127.0.0.1:${port}`;
  }
  return null;
}

function log(line) {
  fs.appendFileSync(OUT, JSON.stringify(line) + '\n');
  console.log(JSON.stringify(line, null, 2).slice(0, 500));
}

async function main() {
  const cdpUrl = await findCdpUrl();
  if (!cdpUrl) {
    console.error('Nenhuma porta CDP encontrada');
    process.exit(1);
  }
  console.log('CDP URL:', cdpUrl);

  fs.writeFileSync(OUT, '');

  const browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();
  let kimiPage = null;
  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      if (page.url().includes('kimi.com')) {
        kimiPage = page;
        break;
      }
    }
    if (kimiPage) break;
  }

  if (!kimiPage) {
    console.error('Página Kimi não encontrada');
    process.exit(1);
  }

  console.log('Página Kimi:', kimiPage.url());

  // Limpa logs anteriores
  fs.writeFileSync(OUT, '');

  const msg = 'explique em 3 parágrafos detalhados como funciona um sistema de mirror agent';

  // Envia a mensagem
  await kimiPage.evaluate((text) => {
    function findInput() {
      const candidates = document.querySelectorAll('[contenteditable="true"], textarea');
      for (const el of candidates) {
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const cls = (el.className || '').toLowerCase();
        if (placeholder.includes('ask') || placeholder.includes('pergunte') || cls.includes('chat-input') || cls.includes('composer')) return el;
      }
      return candidates[candidates.length - 1] || null;
    }
    function findSendButton() {
      const candidates = document.querySelectorAll('button, div[role="button"]');
      for (const el of candidates) {
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const cls = (el.className || '').toLowerCase();
        if (aria.includes('send') || cls.includes('send') || cls.includes('submit')) return el;
      }
      return null;
    }
    const input = findInput();
    if (!input) return { ok: false, err: 'input not found' };
    input.focus();
    input.innerText = text;
    input.textContent = text;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => {
      const btn = findSendButton();
      if (btn) btn.click();
    }, 300);
    return { ok: true };
  }, msg);

  console.log('Mensagem enviada:', msg);

  // Faz dump a cada 500ms por 15s
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    const info = await kimiPage.evaluate(() => {
      const cls = (el) => typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
      const describe = (sel, max = 20) => Array.from(document.querySelectorAll(sel)).slice(0, max).map(el => ({
        tag: el.tagName,
        class: cls(el).slice(0, 200),
        text: (el.innerText || '').slice(0, 400),
        html: el.outerHTML.slice(0, 700),
      }));

      const assistants = Array.from(document.querySelectorAll('.segment.segment-assistant, .chat-content-item.chat-content-item-assistant'));
      const lastAssistant = assistants[assistants.length - 1] || null;
      let lastAssistantInfo = null;
      if (lastAssistant) {
        lastAssistantInfo = {
          className: cls(lastAssistant),
          textLength: (lastAssistant.innerText || '').length,
          htmlStart: lastAssistant.outerHTML.slice(0, 1500),
          children: Array.from(lastAssistant.children).map(c => ({
            tag: c.tagName,
            class: cls(c).slice(0, 100),
            textLen: (c.innerText || '').length
          }))
        };
      }

      return {
        url: window.location.href,
        time: Date.now(),
        assistantsCount: assistants.length,
        lastAssistant: lastAssistantInfo,
        thinking: describe('[class*="thinking"], [class*="reasoning"], .toolcall-container'),
        markdown: describe('.markdown-container, .markdown, .segment-content-box'),
        code: describe('pre code, .segment-code'),
        input: describe('[contenteditable="true"], textarea'),
        sendButton: describe('button[type="submit"], .send-button-container, div[role="button"]'),
        stopButton: describe('.stop-button-container, div[role="button"]')
      };
    });
    log({ step: i, ...info });
  }

  await browser.close();
  console.log('Dump salvo em:', OUT);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
