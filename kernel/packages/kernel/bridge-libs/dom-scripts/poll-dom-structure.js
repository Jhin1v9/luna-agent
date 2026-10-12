'use strict';
/**
 * DOM Structure-based extraction for Kimi Web.
 *
 * W10-T2: converted from an orphan IIFE into a module so the page-level
 * context-limit scanner can be called from the bridge poll loop via
 * page.evaluate(scanPageContextLimit). The functions below run INSIDE the
 * browser — they must not close over Node-side variables.
 *
 * pollDomStructure() returns { thinking, response, detectedTools, source }.
 * scanPageContextLimit() returns { response, isContextLimit, source } | null.
 */

/**
 * Full-page scan for Kimi's context-limit notice ("Your conversation with
 * Kimi is getting too long..."), which may render as a modal/banner OUTSIDE
 * the response bubbles — where the bubble-scoped extraction never sees it.
 *
 * Chat segments are skipped on purpose: assistant bubbles are already covered
 * by _isContextLimitResponse() on the extracted response, and scanning user
 * bubbles would false-positive on messages that merely mention the phrase.
 *
 * NOTE: keep the regex in sync with KimiBridge._isContextLimitResponse().
 */
function scanPageContextLimit() {
  // v11.8-fix: keep in sync with KimiBridge._isContextLimitResponse().
  // Broadened to catch Portuguese/Spanish/English/Chinese variants and newer Kimi UI wording.
  // Kimi's hardcoded context-limit messages in PT/EN/ES/ZH. Kept tight to the exact
  // phrases Kimi emits; broad regexes are intentionally avoided per owner directive.
  const contextLimitRegex = /Você e o Kimi|you and Kimi|t[uú] y Kimi|Tu y Kimi|Kimi conversaram bastante|Kimi have (?:talked|chatted)|han hablado mucho|Tente iniciar um novo chat|Try starting a new chat|Intenta iniciar un nuevo chat|iniciar um novo chat|tente iniciar um novo chat|start a new chat|nuevo chat|new chat|getting too long|conversation.*too long|reached.*(?:context|token|memory|input) limit|memory limit|input limit|try starting a new session|聊得太长|发起一个新会话|会话太长|对话太长|上下文太长|convers[ao].*(?:muito longa|bastante|demais|muitas mensagens)|conversaram bastante|conversamos bastante|muita conversa|muitas mensagens|chegou ao limite|atingiu o limite|atingimos o limite|limite de (?:contexto|tokens|mem[óo]ria).{0,25}(?:atingido|chegado|excedido|atingiu|atingimos|chegou|chegamos|excedeu|excedemos)|começar um novo chat|inicie um novo chat|create a new chat|refresh this chat|nueva sesi[óo]n|sesi[óo]n.*(?:muy larga|muy longa|demasiado larga|demasiado longa|lleg[óo] al l[íi]mite|llegamos al l[íi]mite|llegou ao limite)/i;
  // v2.6.7-fix: broaden element coverage so Kimi's context-limit notice is found
  // whether it renders as a plain div, a banner, a toast, or inside a button/link.
  const allTextElements = document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6, li, button, a, section, article, header, footer, aside, main');
  for (const el of allTextElements) {
    if (el.closest && el.closest('.segment-user, .segment-assistant')) continue;
    const text = (el.innerText || el.textContent || '').trim();
    if (text.length > 20 && text.length < 300 && contextLimitRegex.test(text)) {
      return {
        response: text,
        isContextLimit: true,
        source: 'dom-context-limit'
      };
    }
  }
  return null;
}

/**
 * DOM structure-based extraction of the last assistant segment.
 * Returns { thinking, response, detectedTools, isContextLimit, source } or null.
 */
function pollDomStructure() {
  // ── Detect context limit messages anywhere on the page ──
  const pageLimit = scanPageContextLimit();
  if (pageLimit) {
    return {
      thinking: '',
      response: pageLimit.response,
      detectedTools: [],
      isContextLimit: true,
      source: pageLimit.source
    };
  }

  const assistants = document.querySelectorAll('.segment-assistant');
  const lastAssistant = assistants[assistants.length - 1];
  if (!lastAssistant) return null;

  let thinking = '';
  let response = '';
  const detectedTools = [];

  function tryParseToolJson(text) {
    if (!text || text.length < 10) return null;
    if (!text.includes('"tool"')) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.tool === 'string' && parsed.params && typeof parsed.params === 'object') {
        return { tool: parsed.tool, params: parsed.params };
      }
      if (parsed && typeof parsed.tool === 'string' && (parsed.path || parsed.command || parsed.script || parsed.query)) {
        return { tool: parsed.tool, params: parsed };
      }
    } catch (e) {}
    return null;
  }

  const thinkContainer = lastAssistant.querySelector('.toolcall-container.thinking-container');
  if (thinkContainer) {
    const thinkMd = thinkContainer.querySelector('.markdown-container.toolcall-content-text');
    if (thinkMd) {
      thinking = (thinkMd.innerText || '').trim();
    }
  }

  const thinkStarters = /^(O usu[áa]rio|Vou |Agora |Preciso |Primeiro |Vamos |Ent[aã]o |Deixa |Hmm |Ok |Okay |Let me |I need |I'll |First |Now |So |The user |Hmm |Okay |Pensando|Analisando|Raciocinando|Reasoning|Thinking|Processando|Searching|Buscando|Concluindo|Conclu[íi]do)/i;

  const contentBox = lastAssistant.querySelector('.segment-content-box');
  if (!contentBox) return null;

  // Strategy A: NEW structure
  const markdownContainers = contentBox.querySelectorAll('.markdown-container');
  let rawResponse = '';
  for (const md of markdownContainers) {
    if (thinkContainer && md.closest('.toolcall-container.thinking-container')) continue;

    const codeBlocks = md.querySelectorAll('.segment-code, pre code, [class*="code-block"]');
    for (const cb of codeBlocks) {
      const text = (cb.textContent || cb.innerText || '').trim();
      if (!text) continue;
      const toolAction = tryParseToolJson(text);
      if (toolAction) {
        detectedTools.push(toolAction);
        continue;
      }
      rawResponse += text + '\n\n';
    }
    const paragraphs = md.querySelectorAll('.paragraph, p, [class*="text"]');
    for (const p of paragraphs) {
      const text = (p.innerText || p.textContent || '').trim();
      if (text) rawResponse += text + '\n\n';
    }
  }

  // Strategy B: OLD structure
  if (!rawResponse) {
    const containerBlock = contentBox.querySelector('.container-block');
    const blockItems = containerBlock
      ? containerBlock.querySelectorAll('.block-item')
      : contentBox.querySelectorAll('.block-item');
    for (const item of blockItems) {
      const itemThink = item.querySelector('.toolcall-container.thinking-container');
      if (itemThink) continue;

      const codeBlocks = item.querySelectorAll('.segment-code, pre code, [class*="code-block"]');
      for (const cb of codeBlocks) {
        const text = (cb.textContent || cb.innerText || '').trim();
        if (!text) continue;
        const toolAction = tryParseToolJson(text);
        if (toolAction) {
          detectedTools.push(toolAction);
          continue;
        }
        rawResponse += text + '\n\n';
      }
      const paragraphs = item.querySelectorAll('.paragraph, p, [class*="text"]');
      for (const p of paragraphs) {
        const text = (p.innerText || p.textContent || '').trim();
        if (text) rawResponse += text + '\n\n';
      }
    }
  }

  rawResponse = rawResponse.trim();

  if (thinkContainer && rawResponse) {
    const codeBlockIdx = rawResponse.indexOf('```');
    const jsonStartIdx = rawResponse.search(/\{\s*"/);
    const firstRealIdx = codeBlockIdx >= 0 && jsonStartIdx >= 0
      ? Math.min(codeBlockIdx, jsonStartIdx)
      : (codeBlockIdx >= 0 ? codeBlockIdx : jsonStartIdx);

    if (firstRealIdx > 10) {
      const beforeReal = rawResponse.slice(0, firstRealIdx).trim();
      const afterReal = rawResponse.slice(firstRealIdx).trim();
      if (thinkStarters.test(beforeReal) || beforeReal.length < 400) {
        thinking = thinking ? thinking + '\n\n' + beforeReal : beforeReal;
        response = afterReal;
      } else {
        response = rawResponse;
      }
    } else if (firstRealIdx === 0) {
      response = rawResponse;
    } else if (!rawResponse.includes('```') && !rawResponse.includes('{')) {
      thinking = thinking ? thinking + '\n\n' + rawResponse : rawResponse;
      response = '';
    } else {
      response = rawResponse;
    }
  } else {
    response = rawResponse;
  }

  if (!thinkContainer && response && !thinking) {
    const isThink = thinkStarters.test(response) && response.length < 500 &&
                    !response.includes('"response"') && !response.includes('"tool"');
    if (isThink) {
      thinking = response;
      response = '';
    }
  }

  if (thinking || response || detectedTools.length > 0) {
    return { thinking, response: response.trim(), detectedTools, source: 'dom-structure' };
  }
  return null;
}

// Usable both as a CommonJS module (bridge page.evaluate) and as a plain
// browser script (no module global → just function declarations).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scanPageContextLimit, pollDomStructure };
}
