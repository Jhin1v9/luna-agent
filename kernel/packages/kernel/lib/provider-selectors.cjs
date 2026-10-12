'use strict';

/**
 * Provider selector chains (PDS schema v2).
 *
 * A selector value in provider-configs/*.json may be:
 *   - v1: a comma-joined string ("textarea, [contenteditable='true']")
 *   - v2: an ordered array (["#prompt-textarea", "textarea"])
 * Both normalize to an ordered fallback chain. Order matters: the first
 * selector that exists on the page wins; the rest are fallbacks for when a
 * site changes its DOM.
 */

function normalizeChain(value) {
  if (!value) return [];
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return parts.map(s => String(s).trim()).filter(Boolean);
}

/**
 * Ordered chain for a role from a provider config, with hardcoded fallbacks
 * appended (deduped). The fallbacks keep Kimi's pre-v2 selectors working even
 * if a config key is missing.
 */
function resolveChain(providerCfg, role, ...fallbacks) {
  const chain = normalizeChain(providerCfg?.selectors?.[role]);
  for (const fb of fallbacks) {
    for (const sel of normalizeChain(fb)) {
      if (!chain.includes(sel)) chain.push(sel);
    }
  }
  return chain;
}

function providerDisplayName(providerCfg, fallback = 'provider') {
  return providerCfg?.displayName || providerCfg?.name || fallback;
}

/**
 * First selector in the chain that matches on the page. When nothing matches,
 * returns a locator for the first selector (count() === 0) so callers keep a
 * single existence-check path.
 */
async function firstMatchingLocator(page, chain) {
  for (const sel of chain) {
    const locator = page.locator(sel).first();
    if (await locator.count() > 0) return { locator, selector: sel };
  }
  if (chain.length === 0) return { locator: null, selector: null };
  return { locator: page.locator(chain[0]).first(), selector: null };
}

/**
 * Poll the chain until any selector is visible (or attached, per `state`),
 * or `timeout` elapses. Replaces `count()` instant checks that raced against
 * SPA rendering (the DeepSeek input bug).
 */
async function waitForChain(page, chain, { timeout = 15000, pollMs = 250, state = 'visible' } = {}) {
  const deadline = Date.now() + timeout;
  do {
    for (const sel of chain) {
      try {
        const locator = page.locator(sel).first();
        if (await locator.count() > 0) {
          if (state === 'attached' || await locator.isVisible().catch(() => false)) {
            return { locator, selector: sel };
          }
        }
      } catch (e) { /* selector may be invalid mid-navigation — keep polling */ }
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(pollMs);
  } while (Date.now() < deadline);
  return { locator: null, selector: null };
}

module.exports = {
  normalizeChain,
  resolveChain,
  providerDisplayName,
  firstMatchingLocator,
  waitForChain,
};
