/**
 * DomExtractor — Extracts Kimi responses from the page DOM.
 *
 * Strategies (in order):
 *   1. JS-injected stream interceptor (window.__lunaStream) — PRIMARY
 *   2. Snapshot diff (preSendSnapshot vs current DOM) — FALLBACK
 *   3. Unified DOM extraction (last assistant) — LAST RESORT
 *
 * REMOVED: React Fiber traversal, getComputedStyle heuristics, TreeWalker.
 */

class DomExtractor {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Extract the new response text since preSendSnapshot.
   * Tries interceptor first, then DOM diff, then unified DOM fallback.
   *
   * @param {Page} page — Playwright page
   * @param {string[]} preSendSnapshot — texts captured before sending
   * @param {number} [targetAssistantIndex] — preferred assistant index
   * @returns {Promise<string>}
   */
  async extractDiff(page, preSendSnapshot, targetAssistantIndex) {
    // ── Strategy 1: Interceptor (most reliable) ──
    try {
      const intercepted = await page.evaluate(() => {
        const s = window.__lunaStream;
        if (s && s.active && s.content) {
          return Array.isArray(s.content) ? s.content.join('') : (s.content || '');
        }
        return null;
      });
      if (intercepted && intercepted.trim()) {
        this.logger?.info?.(`[DomExtractor] Extracted via interceptor: ${intercepted.length} chars`);
        return intercepted.trim();
      }
    } catch (e) {
      this.logger?.debug?.(`[DomExtractor] Interceptor check failed: ${e.message}`);
    }

    // ── Strategy 2: Snapshot diff ──
    if (preSendSnapshot && preSendSnapshot.length > 0) {
      try {
        const postSnapshot = await page.evaluate(() => {
          const assistants = document.querySelectorAll('.segment-assistant');
          return Array.from(assistants).map((el) => {
            let text = '';
            const contentBox = el.querySelector('.segment-content-box');
            if (contentBox) {
              const codeBlocks = contentBox.querySelectorAll('.segment-code, pre code, [class*="code-block"]');
              for (const cb of codeBlocks) {
                const t = (cb.innerText || cb.textContent || '').trim();
                if (t) text += t + '\n\n';
              }
              const paragraphs = contentBox.querySelectorAll('.paragraph, p, [class*="text"]');
              for (const p of paragraphs) {
                const t = (p.innerText || p.textContent || '').trim();
                if (t) text += t + '\n\n';
              }
            }
            return text.trim();
          });
        });

        let newContent = '';
        const sources = [];

        // New assistants appeared after send
        for (let i = preSendSnapshot.length; i < postSnapshot.length; i++) {
          const text = postSnapshot[i];
          if (text && text.length > 0) {
            newContent += text + '\n\n';
            sources.push(`new-assistant-${i}`);
          }
        }

        // Existing assistants changed significantly
        for (let i = 0; i < Math.min(preSendSnapshot.length, postSnapshot.length); i++) {
          const preText = preSendSnapshot[i] || '';
          const postText = postSnapshot[i] || '';
          if (postText.length > preText.length + 10) {
            const newPart = postText.slice(preText.length).trim();
            if (newPart.length > 10) {
              newContent += newPart + '\n\n';
              sources.push(`changed-assistant-${i}`);
            }
          }
        }

        newContent = newContent.trim();
        if (newContent.length > 0) {
          this.logger?.info?.(`[DomExtractor] Extracted via snapshot-diff (${sources.join(', ')}): ${newContent.length} chars`);
          return newContent;
        }

        // No diff — fallback to last assistant
        const last = postSnapshot[postSnapshot.length - 1];
        if (last && last.length > 0) {
          this.logger?.warn?.(`[DomExtractor] No diff detected, falling back to last assistant (${last.length} chars)`);
          return last;
        }
      } catch (e) {
        this.logger?.warn?.(`[DomExtractor] Snapshot diff failed: ${e.message}`);
      }
    }

    // ── Strategy 3: Unified DOM extraction ──
    try {
      const domResult = await page.evaluate((prefIdx) => {
        const assistants = document.querySelectorAll('.segment-assistant');
        if (!assistants.length) return null;

        let assistant = assistants[assistants.length - 1];
        if (prefIdx !== undefined && prefIdx >= 0 && prefIdx < assistants.length) {
          assistant = assistants[prefIdx];
        }

        let thinking = '';
        let response = '';

        const thinkContainer = assistant.querySelector('.toolcall-container.thinking-container');
        if (thinkContainer) {
          const thinkMd = thinkContainer.querySelector('.markdown-container.toolcall-content-text');
          if (thinkMd) thinking = (thinkMd.innerText || '').trim();
        }

        const thinkStarters = /^(O usuário|Vou |Agora |Preciso |Primeiro |Vamos |Então |Deixa |Hmm |Ok |Okay |Let me |I need |I'll |First |Now |So |The user |Hmm |Okay )/i;
        const contentBox = assistant.querySelector('.segment-content-box');
        if (!contentBox) return null;

        // NEW structure
        const markdownContainers = contentBox.querySelectorAll('.markdown-container');
        let rawResponse = '';
        for (const md of markdownContainers) {
          if (thinkContainer && md.closest('.toolcall-container.thinking-container')) continue;
          const codeBlocks = md.querySelectorAll('.segment-code, pre code, [class*="code-block"]');
          for (const cb of codeBlocks) {
            const text = (cb.innerText || cb.textContent || '').trim();
            if (text) {
              if (text.startsWith('{') && text.includes('"tool"')) {
                // skip tool JSON blocks
              } else {
                rawResponse += text + '\n\n';
              }
            }
          }
          const paragraphs = md.querySelectorAll('.paragraph, p, [class*="text"]');
          for (const p of paragraphs) {
            const text = (p.innerText || p.textContent || '').trim();
            if (text) rawResponse += text + '\n\n';
          }
        }

        // OLD structure fallback
        if (!rawResponse) {
          const containerBlock = contentBox.querySelector('.container-block');
          const blockItems = containerBlock
            ? containerBlock.querySelectorAll('.block-item')
            : contentBox.querySelectorAll('.block-item');
          for (const item of blockItems) {
            if (item.querySelector('.toolcall-container.thinking-container')) continue;
            const codeBlocks = item.querySelectorAll('.segment-code, pre code, [class*="code-block"]');
            for (const cb of codeBlocks) {
              const text = (cb.textContent || cb.innerText || '').trim();
              if (text) rawResponse += text + '\n\n';
            }
            const paragraphs = item.querySelectorAll('.paragraph, p, [class*="text"]');
            for (const p of paragraphs) {
              const text = (p.innerText || p.textContent || '').trim();
              if (text) rawResponse += text + '\n\n';
            }
          }
        }

        rawResponse = rawResponse.trim();

        // Separate thinking from response
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

        // Safety net for leaked thinking
        if (!thinkContainer && response && !thinking) {
          const isThink = thinkStarters.test(response) && response.length < 500 &&
                          !response.includes('"response"') && !response.includes('"tool"');
          if (isThink) {
            thinking = response;
            response = '';
          }
        }

        return { thinking: thinking || '', response: response || '' };
      }, targetAssistantIndex);

      if (domResult && domResult.response) {
        this.logger?.info?.(`[DomExtractor] Extracted via dom-unified: ${domResult.response.length} chars`);
        return domResult.response.trim();
      }
    } catch (e) {
      this.logger?.warn?.(`[DomExtractor] DOM unified extraction failed: ${e.message}`);
    }

    throw new Error('EXTRACTION_FAILED: No response found');
  }

  /**
   * Poll the DOM structure until content is found or timeout.
   * Returns thinking, response, and detected tools.
   *
   * @param {Page} page — Playwright page
   * @param {number} timeoutMs — max time to wait (default 60s)
   * @returns {Promise<{thinking: string, response: string, tools: Array}>}
   */
  async pollDomStructure(page, timeoutMs = 60000) {
    const start = Date.now();
    const interval = 400;

    while (Date.now() - start < timeoutMs) {
      const result = await page.evaluate(() => {
        const assistants = document.querySelectorAll('.segment-assistant');
        const lastAssistant = assistants[assistants.length - 1];
        if (!lastAssistant) return null;

        let thinking = '';
        let response = '';
        const tools = [];

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
          } catch (e) {
            // Not valid JSON
          }
          return null;
        }

        const thinkContainer = lastAssistant.querySelector('.toolcall-container.thinking-container');
        if (thinkContainer) {
          const thinkMd = thinkContainer.querySelector('.markdown-container.toolcall-content-text');
          if (thinkMd) thinking = (thinkMd.innerText || '').trim();
        }

        const thinkStarters = /^(O usuário|Vou |Agora |Preciso |Primeiro |Vamos |Então |Deixa |Hmm |Ok |Okay |Let me |I need |I'll |First |Now |So |The user |Hmm |Okay )/i;
        const contentBox = lastAssistant.querySelector('.segment-content-box');
        if (!contentBox) return null;

        // NEW structure
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
              tools.push(toolAction);
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

        // OLD structure fallback
        if (!rawResponse) {
          const containerBlock = contentBox.querySelector('.container-block');
          const blockItems = containerBlock
            ? containerBlock.querySelectorAll('.block-item')
            : contentBox.querySelectorAll('.block-item');
          for (const item of blockItems) {
            if (item.querySelector('.toolcall-container.thinking-container')) continue;
            const codeBlocks = item.querySelectorAll('.segment-code, pre code, [class*="code-block"]');
            for (const cb of codeBlocks) {
              const text = (cb.textContent || cb.innerText || '').trim();
              if (!text) continue;
              const toolAction = tryParseToolJson(text);
              if (toolAction) {
                tools.push(toolAction);
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

        // Separate thinking from response
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

        // Safety net
        if (!thinkContainer && response && !thinking) {
          const isThink = thinkStarters.test(response) && response.length < 500 &&
                          !response.includes('"response"') && !response.includes('"tool"');
          if (isThink) {
            thinking = response;
            response = '';
          }
        }

        if (thinking || response || tools.length > 0) {
          return { thinking, response: response.trim(), tools };
        }
        return null;
      });

      if (result) {
        this.logger?.info?.(
          `[DomExtractor] pollDomStructure found: response=${result.response.length}, thinking=${result.thinking.length}, tools=${result.tools.length}`
        );
        return result;
      }

      await new Promise(r => setTimeout(r, interval));
    }

    this.logger?.warn?.(`[DomExtractor] pollDomStructure timed out after ${timeoutMs}ms`);
    return { thinking: '', response: '', tools: [] };
  }

  /**
   * Extract a structured result from a complete JSON wrapper.
   *
   * @param {string} text
   * @returns {{type: string, text?: string, tool?: string, params?: object, script?: string} | null}
   */
  extractFromJson(text) {
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed.response !== undefined && typeof parsed.response === 'string') {
        return { type: 'response', text: parsed.response };
      }
      if (parsed.tool !== undefined) {
        return { type: 'tool', tool: parsed.tool, params: parsed.params || {} };
      }
      if (parsed.script !== undefined) {
        return { type: 'script', script: parsed.script };
      }
    } catch {}
    // Fallback regex extraction for malformed but complete JSON
    try {
      const respMatch = text.match(/"response"\s*:\s*"([\s\S]*?)"\s*[,}]/);
      if (respMatch) {
        return {
          type: 'response',
          text: respMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
        };
      }
    } catch {}
    return null;
  }

  /**
   * Detect UI state: canSteer (send button active) and isGenerating (stop button visible).
   * This replaces the inline _detectUiState from kimi-bridge.cjs.
   */
  async detectUiState(page) {
    try {
      return await page.evaluate(() => {
        const sendBtnSelectors = [
          'button[class*="send"]:not([disabled])',
          '[class*="send-button"]:not([disabled])',
          'button[type="submit"]',
          '.send-btn',
          '[aria-label*="send"]',
          '[data-testid*="send"]'
        ];
        let canSteer = false;
        for (const sel of sendBtnSelectors) {
          const btn = document.querySelector(sel);
          if (btn) {
            canSteer = !btn.disabled && !btn.className.includes('disabled') && btn.offsetParent !== null;
            if (canSteer) break;
          }
        }

        const stopBtnSelectors = [
          'button[class*="stop"]:not([disabled])',
          '[class*="stop-button"]:not([disabled])',
          '.stop-btn',
          '[aria-label*="stop"]',
          '[data-testid*="stop"]'
        ];
        let isGenerating = false;
        for (const sel of stopBtnSelectors) {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null) {
            isGenerating = true;
            break;
          }
        }
        if (!isGenerating && !canSteer) {
          const anySend = document.querySelector('.send-button-container, [class*="send"]');
          if (!anySend || anySend.offsetParent === null) isGenerating = true;
        }
        return { canSteer, isGenerating };
      });
    } catch (e) {
      this.logger?.warn?.(`[DomExtractor] detectUiState failed: ${e.message}`);
      return { canSteer: false, isGenerating: false };
    }
  }
}

// ── JSON Accumulation Buffer helpers ──

function looksLikeJsonStart(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trimStart();
  return t.startsWith('{') && (t.includes('"response"') || t.includes('"tool"') || t.includes('"script"'));
}

function isJsonComplete(text) {
  if (!text) return false;
  let depth = 0;
  let inString = false;
  let escape = false;
  let foundFirstBrace = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (c === '{') { depth++; foundFirstBrace = true; }
      else if (c === '}') depth--;
    }
  }
  return foundFirstBrace && depth === 0;
}

module.exports = { DomExtractor, looksLikeJsonStart, isJsonComplete };
