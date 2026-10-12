# PDS Fase 0 — Foundation: provider-config em todos os caminhos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar `provider-configs/*.json` a fonte única de verdade para input/send/stop/new-chat/login no bridge, consertar o login/input do DeepSeek no caminho, e deletar o interceptor CDP morto — sem nenhuma mudança de comportamento para a Kimi (fallbacks preservam os seletores hardcoded atuais).

**Architecture:** Um helper novo (`lib/provider-selectors.cjs`) normaliza seletores v1 (string com vírgulas) e v2 (array ordenado) em fallback chains e resolve/awaita contra uma page Playwright. Cada ponto hardcoded do `kimi-bridge.cjs` passa a chamar o helper com o seletor antigo como fallback final — equivalência byte-a-byte para a Kimi, config-driven para os demais. O `ProviderNetworkInterceptor` perde o ramo CDP-Fetch que sempre lançava exceção (`_buildFetchPatterns` nunca existiu) e passa a filtrar URLs via `apiEndpoints` do config.

**Tech Stack:** Node.js (CommonJS), Playwright, `node --test` (padrão `tests/wave*.test.cjs`), pm2.

**Referência:** spec em `packages/kernel/plans/2026-07-14-provider-discovery-design.md` (seção Fase 0). Bug do DeepSeek: `.brain/bugs.md:22`. Bug do interceptor: `.brain/bugs.md:23`.

---

## File Structure

- **Create:** `packages/kernel/lib/provider-selectors.cjs` — normalização de chains + resolução/wait contra page.
- **Create:** `packages/kernel/tests/wave11-provider-config.test.cjs` — testes do helper, dos configs e do interceptor.
- **Modify:** `packages/kernel/provider-configs/deepseek.json` — adiciona `newChat`; remove `cdpPatterns`. **`kimi.json` NÃO é modificada (diretriz do dono — provider em produção); os defaults da Kimi vivem como fallback no código.**
- **Modify:** `packages/kernel/kimi-bridge.cjs` — 8 pontos de wiring + interceptor + export para testes.
- **Modify:** `packages/kernel/provider-loader.cjs` — remove `getProviderApiPatterns` (dead code).

---

### Task 1: Helper `lib/provider-selectors.cjs` + testes

**Files:**
- Create: `packages/kernel/lib/provider-selectors.cjs`
- Test: `packages/kernel/tests/wave11-provider-config.test.cjs`

- [ ] **Step 1: Escrever os testes que falham**

Criar `packages/kernel/tests/wave11-provider-config.test.cjs`:

```js
// wave11-provider-config.test.cjs — PDS Fase 0 regression tests
// Run: node --test packages/kernel/tests/wave11-provider-config.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeChain,
  resolveChain,
  providerDisplayName,
  firstMatchingLocator,
  waitForChain,
} = require('../lib/provider-selectors.cjs');

// ── normalizeChain ──
test('T1a: normalizeChain aceita string v1 com vírgulas', () => {
  assert.deepStrictEqual(
    normalizeChain('textarea, [contenteditable="true"]'),
    ['textarea', '[contenteditable="true"]']
  );
});

test('T1b: normalizeChain aceita array v2 e preserva ordem', () => {
  assert.deepStrictEqual(normalizeChain(['#a', '.b']), ['#a', '.b']);
});

test('T1c: normalizeChain vazio/undefined retorna []', () => {
  assert.deepStrictEqual(normalizeChain(undefined), []);
  assert.deepStrictEqual(normalizeChain(''), []);
  assert.deepStrictEqual(normalizeChain('  , ,'), []);
});

// ── resolveChain ──
test('T1d: resolveChain lê do config e anexa fallbacks sem duplicar', () => {
  const cfg = { selectors: { input: '#prompt-textarea, textarea' } };
  assert.deepStrictEqual(
    resolveChain(cfg, 'input', 'textarea, [contenteditable="true"]'),
    ['#prompt-textarea', 'textarea', '[contenteditable="true"]']
  );
});

test('T1e: resolveChain sem config usa só os fallbacks', () => {
  assert.deepStrictEqual(resolveChain({}, 'input', '.a, .b'), ['.a', '.b']);
  assert.deepStrictEqual(resolveChain(null, 'input', '.a'), ['.a']);
});

// ── providerDisplayName ──
test('T1f: providerDisplayName prefere displayName, depois name, depois fallback', () => {
  assert.strictEqual(providerDisplayName({ displayName: 'DeepSeek Chat', name: 'deepseek' }), 'DeepSeek Chat');
  assert.strictEqual(providerDisplayName({ name: 'deepseek' }), 'deepseek');
  assert.strictEqual(providerDisplayName(null, 'kimi'), 'kimi');
});

// ── fake page (Playwright mínimo) ──
function fakePage(visibleSelectors = [], appearAfterPolls = 0) {
  let polls = 0;
  const visible = (sel) => polls >= appearAfterPolls && visibleSelectors.includes(sel);
  const loc = (sel) => ({
    first: () => loc(sel),
    count: async () => (visible(sel) ? 1 : 0),
    isVisible: async () => visible(sel),
  });
  return {
    locator: (sel) => loc(sel),
    waitForTimeout: async () => { polls++; },
    _polls: () => polls,
  };
}

// ── firstMatchingLocator ──
test('T1g: firstMatchingLocator respeita a ordem da chain', async () => {
  const page = fakePage(['.b', '.c']);
  const { locator, selector } = await firstMatchingLocator(page, ['.a', '.b', '.c']);
  assert.strictEqual(selector, '.b');
  assert.strictEqual(await locator.count(), 1);
});

// ── waitForChain ──
test('T1h: waitForChain espera o seletor aparecer', async () => {
  const page = fakePage(['#late'], 3);
  const { locator, selector } = await waitForChain(page, ['#nope', '#late'], { timeout: 5000, pollMs: 1 });
  assert.strictEqual(selector, '#late');
  assert.strictEqual(await locator.count(), 1);
});

test('T1i: waitForChain retorna locator null no timeout', async () => {
  const page = fakePage([]);
  const { locator, selector } = await waitForChain(page, ['#never'], { timeout: 5, pollMs: 1 });
  assert.strictEqual(locator, null);
  assert.strictEqual(selector, null);
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd /home/jhin/.luna-kernel/packages/kernel && node --test tests/wave11-provider-config.test.cjs`
Expected: FAIL — `Cannot find module '../lib/provider-selectors.cjs'`

- [ ] **Step 3: Implementar o helper**

Criar `packages/kernel/lib/provider-selectors.cjs`:

```js
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
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd /home/jhin/.luna-kernel/packages/kernel && node --test tests/wave11-provider-config.test.cjs`
Expected: PASS — 9 testes (T1a–T1i)

- [ ] **Step 5: Commit**

```bash
cd /home/jhin/.luna-kernel && git add packages/kernel/lib/provider-selectors.cjs packages/kernel/tests/wave11-provider-config.test.cjs && git commit -m "feat(kernel): PDS Fase 0 - provider-selectors helper (v1/v2 fallback chains, waitForChain)"
```

---

### Task 2: Config v2 do DeepSeek + teste de validação

> **Diretriz do dono (2026-07-14): `kimi.json` NÃO é tocada nesta fase** — provider em
> produção, funcionando. Todos os defaults da Kimi vivem como fallback hardcoded no
> código (Tasks 3-10), então nada no comportamento dela depende do config.

**Files:**
- Modify: `packages/kernel/provider-configs/deepseek.json` (adiciona `newChat`, remove `cdpPatterns`)
- Test: `packages/kernel/tests/wave11-provider-config.test.cjs`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `tests/wave11-provider-config.test.cjs`:

```js
// ── config validation (Task 2) — DeepSeek only; kimi.json is untouched (owner directive) ──
const fs = require('node:fs');
const path = require('node:path');

const CONFIGS_DIR = path.join(__dirname, '..', 'provider-configs');
const REQUIRED_ROLES = ['input', 'sendButton', 'stopButton', 'newChat', 'generatingIndicator', 'loginIndicator', 'appContent'];

test('T2-deepseek: roles obrigatórios presentes e não-vazios', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, 'deepseek.json'), 'utf8'));
  for (const role of REQUIRED_ROLES) {
    assert.ok(normalizeChain(cfg.selectors?.[role]).length > 0, `deepseek.selectors.${role} vazio/ausente`);
  }
});

test('T2-deepseek: apiEndpoints não-vazio, sem cdpPatterns (dead code)', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, 'deepseek.json'), 'utf8'));
  assert.ok(Array.isArray(cfg.apiEndpoints) && cfg.apiEndpoints.length > 0);
  assert.strictEqual(cfg.cdpPatterns, undefined);
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd /home/jhin/.luna-kernel/packages/kernel && node --test tests/wave11-provider-config.test.cjs`
Expected: FAIL — `deepseek.selectors.newChat vazio/ausente`

- [ ] **Step 3: Atualizar deepseek.json**

Em `provider-configs/deepseek.json`, dentro de `"selectors"` (após a linha `"stopButton"`), adicionar:

```json
    "newChat": "a[href='/'], button:has-text('New chat'), button:has-text('Nova conversa')",
```

E deletar o bloco inteiro `"cdpPatterns": [ ... ],` (as 4 linhas após `"selectors"`).

**Não modificar `kimi.json` em hipótese alguma.**

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd /home/jhin/.luna-kernel/packages/kernel && node --test tests/wave11-provider-config.test.cjs`
Expected: PASS — 11 testes (T1a–T1i + 2 do T2)

- [ ] **Step 5: Commit**

```bash
cd /home/jhin/.luna-kernel && git add packages/kernel/provider-configs/deepseek.json packages/kernel/tests/wave11-provider-config.test.cjs && git commit -m "feat(kernel): PDS Fase 0 - deepseek config v2 (newChat, cdpPatterns removido); kimi.json intocada por diretriz do dono"
```

---

### Task 3: Input do `sendMessage` lê do config

**Files:**
- Modify: `packages/kernel/kimi-bridge.cjs:4040-4045`

- [ ] **Step 1: Registrar o import do helper**

No topo de `kimi-bridge.cjs`, após a linha 35 (o `require('./provider-loader.cjs')`), adicionar:

```js
const { resolveChain, providerDisplayName, firstMatchingLocator, waitForChain } = require('./lib/provider-selectors.cjs');
```

- [ ] **Step 2: Substituir o bloco hardcoded**

Substituir (linhas 4040-4045):

```js
      // Use locator (auto-resolves at action time, never stale)
      const inputLocator = page.locator('textarea, [contenteditable="true"]').first();
      const inputCount = await inputLocator.count();
      if (inputCount === 0) {
        throw new Error('Input field not found on Kimi Web');
      }
```

Por:

```js
      // Provider-configured input chain (PDS Fase 0). The hardcoded
      // 'textarea, [contenteditable]' pair stays as the final fallback, so
      // Kimi behaves exactly as before.
      const inputProviderCfg = this._loadProviderConfig(resolvedProvider);
      const inputChain = resolveChain(inputProviderCfg, 'input', 'textarea, [contenteditable="true"]');
      const { locator: inputLocator } = await firstMatchingLocator(page, inputChain);
      const inputCount = await inputLocator.count();
      if (inputCount === 0) {
        throw new Error(`Input field not found on ${providerDisplayName(inputProviderCfg)}`);
      }
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check /home/jhin/.luna-kernel/packages/kernel/kimi-bridge.cjs`
Expected: sem saída (OK)

- [ ] **Step 4: Commit**

```bash
cd /home/jhin/.luna-kernel && git add packages/kernel/kimi-bridge.cjs && git commit -m "refactor(kernel): PDS Fase 0 - sendMessage input via provider config chain"
```

---

### Task 4: Input do `sendMessageStream` com waitFor + LOGIN_REQUIRED (fix DeepSeek)

**Files:**
- Modify: `packages/kernel/kimi-bridge.cjs:7634-7640`

Conserta `.brain/bugs.md:22` itens A (seletor do config + waitFor, erro com provider real) e C (`/sign_in` → LOGIN_REQUIRED).

- [ ] **Step 1: Substituir o bloco hardcoded**

Substituir (linhas 7634-7640):

```js
      log.info(`[DEBUG-LUNA] Step 4: looking for input field`);
      const inputLocator = page.locator('textarea, [contenteditable="true"]').first();
      const inputCount = await inputLocator.count();
      log.info(`[DEBUG-LUNA] Step 4: inputCount=${inputCount}`);
      if (inputCount === 0) {
        throw new Error('Input field not found on Kimi Web');
      }
```

Por:

```js
      log.info(`[DEBUG-LUNA] Step 4: looking for input field`);
      const streamProviderCfg = this._loadProviderConfig(resolvedProvider);
      const streamInputChain = resolveChain(streamProviderCfg, 'input', 'textarea, [contenteditable="true"]');
      // waitForChain (15s) replaces the instant count() that raced SPA
      // rendering — the DeepSeek "inputCount=0 on a logged page" bug.
      const { locator: inputLocator, selector: inputSelectorUsed } = await waitForChain(page, streamInputChain, { timeout: 15000 });
      if (!inputLocator) {
        const currentUrl = page.url();
        if (/\/(sign[_-]?in|login|auth)(\/|$|\?|#)/i.test(currentUrl)) {
          throw new Error(`${String(resolvedProvider).toUpperCase()}_LOGIN_REQUIRED: login page detected (${currentUrl}) — faça login no Chrome da Luna e recapture a sessão`);
        }
        throw new Error(`Input field not found on ${providerDisplayName(streamProviderCfg)}`);
      }
      log.info(`[DEBUG-LUNA] Step 4: input found via '${inputSelectorUsed}'`);
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check /home/jhin/.luna-kernel/packages/kernel/kimi-bridge.cjs`
Expected: sem saída (OK)

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel && git add packages/kernel/kimi-bridge.cjs && git commit -m "fix(kernel): PDS Fase 0 - sendMessageStream input via config + waitForChain + LOGIN_REQUIRED (DeepSeek bugs.md:22 A/C)"
```

---

### Task 5: `injectSteer` lê input e botão de envio do config

**Files:**
- Modify: `packages/kernel/kimi-bridge.cjs:7425-7437`

- [ ] **Step 1: Substituir o bloco**

Substituir (linhas 7425-7437):

```js
      const inputLocator = page.locator('textarea, [contenteditable="true"]').first();
      await this._fillContentEditable(inputLocator, text);
      await page.waitForTimeout(300);

      // Click send or press Enter
      const sendBtn = page.locator('.send-button-container').first();
      const hasSendBtn = await sendBtn.count() > 0;
```

Por:

```js
      const steerCfg = this._loadProviderConfig(this._resolveProvider(userId));
      const steerInputChain = resolveChain(steerCfg, 'input', 'textarea, [contenteditable="true"]');
      const { locator: inputLocator } = await firstMatchingLocator(page, steerInputChain);
      await this._fillContentEditable(inputLocator, text);
      await page.waitForTimeout(300);

      // Click send or press Enter
      const steerSendChain = resolveChain(steerCfg, 'sendButton', '.send-button-container');
      const { locator: sendBtn } = await firstMatchingLocator(page, steerSendChain);
      const hasSendBtn = await sendBtn.count() > 0;
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check /home/jhin/.luna-kernel/packages/kernel/kimi-bridge.cjs`
Expected: sem saída (OK)

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel && git add packages/kernel/kimi-bridge.cjs && git commit -m "refactor(kernel): PDS Fase 0 - injectSteer input/send via provider config chain"
```

---

### Task 6: `_submitWithVerification` config-driven

**Files:**
- Modify: `packages/kernel/kimi-bridge.cjs:3844-3938`

O método já recebe `options.provider` (chamadores passam — `kb:4066` e o equivalente no stream). As três leituras hardcoded (`.segment-assistant`, `.send-button-container`, `.stop-button-container`) viram chains do config com os mesmos seletores como fallback.

- [ ] **Step 1: Chains no topo do método**

Após a linha 3844 (`async _submitWithVerification(page, inputLocator, text, options = {}) {`), adicionar:

```js
    const submitCfg = this._loadProviderConfig(options.provider || 'kimi');
    const submitAssistantChain = resolveChain(submitCfg, 'assistantMessage', '.segment-assistant');
    const submitSendChain = resolveChain(submitCfg, 'sendButton', '.send-button-container');
    const submitStopChain = resolveChain(submitCfg, 'stopButton', '.stop-button-container');
```

- [ ] **Step 2: `readState` parametrizado**

Substituir (linhas 3856-3864):

```js
    const readState = () => page.evaluate(() => {
      const assistants = document.querySelectorAll('.segment-assistant').length;
      const sendBtn = document.querySelector('.send-button-container');
      const sendDisabled = sendBtn
        ? (sendBtn.classList.contains('disabled') || sendBtn.getAttribute('aria-disabled') === 'true')
        : false;
      const generating = !!document.querySelector('.stop-button-container');
      return { assistants, sendDisabled, generating };
    }).catch(() => null);
```

Por:

```js
    const readState = () => page.evaluate(({ assistantChain, sendChain, stopChain }) => {
      const firstMatch = (sels) => {
        for (const s of sels) { const el = document.querySelector(s); if (el) return el; }
        return null;
      };
      const assistants = assistantChain.length
        ? document.querySelectorAll(assistantChain.join(',')).length
        : 0;
      const sendBtn = firstMatch(sendChain);
      const sendDisabled = sendBtn
        ? (sendBtn.classList.contains('disabled') || sendBtn.getAttribute('aria-disabled') === 'true' || sendBtn.disabled === true)
        : false;
      const generating = !!firstMatch(stopChain);
      return { assistants, sendDisabled, generating };
    }, { assistantChain: submitAssistantChain, sendChain: submitSendChain, stopChain: submitStopChain }).catch(() => null);
```

- [ ] **Step 3: Estratégia de clique no botão**

Substituir (linhas 3899-3906):

```js
        } else {
          const sendBtn = page.locator('.send-button-container').first();
          if (await sendBtn.count() > 0) {
            await sendBtn.click({ timeout: 5000 });
          } else {
            log.warn('[_submitWithVerification] .send-button-container not found — click strategy skipped');
          }
        }
```

Por:

```js
        } else {
          const { locator: sendBtn } = await firstMatchingLocator(page, submitSendChain);
          if (await sendBtn.count() > 0) {
            await sendBtn.click({ timeout: 5000 });
          } else {
            log.warn('[_submitWithVerification] send button not found via provider chain — click strategy skipped');
          }
        }
```

- [ ] **Step 4: Erro final com o provider real**

Substituir (linha 3938):

```js
    throw new Error('SEND_NOT_CONFIRMED: texto permanece no input da Kimi — a mensagem digitada não foi enviada após 3 tentativas (Enter sintético, Enter confiável, clique no botão de enviar)');
```

Por:

```js
    throw new Error(`SEND_NOT_CONFIRMED: texto permanece no input do ${providerDisplayName(submitCfg)} — a mensagem digitada não foi enviada após 3 tentativas (Enter sintético, Enter confiável, clique no botão de enviar)`);
```

- [ ] **Step 5: Verificar sintaxe + regressão**

Run: `cd /home/jhin/.luna-kernel/packages/kernel && node --check kimi-bridge.cjs && node --test tests/*.test.cjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `tests 296` / `pass 296` / `fail 0` (285 + 11 novos)

- [ ] **Step 6: Commit**

```bash
cd /home/jhin/.luna-kernel && git add packages/kernel/kimi-bridge.cjs && git commit -m "refactor(kernel): PDS Fase 0 - _submitWithVerification via provider chains (state read, click strategy, provider-aware error)"
```

---

### Task 7: `_openNewChat` usa a chain `newChat` do config

**Files:**
- Modify: `packages/kernel/kimi-bridge.cjs:1040-1061`

- [ ] **Step 1: Substituir o bloco do botão**

Substituir (linhas 1044-1064):

```js
    try {
      // v10.36-fix: Click the native "New Chat" button when available.
      // This preserves login state because it does not reload the origin.
      const newChatBtn = page.locator('.new-chat-btn').first();
      if (await newChatBtn.count() > 0) {
        const isVisible = await newChatBtn.evaluate(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }).catch(() => false);
        if (isVisible) {
          await newChatBtn.click({ timeout: 10000 });
          log.info(`[_openNewChat] Clicked .new-chat-btn for provider=${provider}`);
          await page.waitForTimeout(1500);
          const urlAfterClick = page.url();
          log.info(`[_openNewChat] URL after click: ${urlAfterClick}`);
          return urlAfterClick;
        }
      }
    } catch (e) {
      log.warn(`[_openNewChat] Button click failed: ${e.message} — falling back to goto`);
    }
```

Por:

```js
    try {
      // v10.36-fix: Click the native "New Chat" button when available.
      // This preserves login state because it does not reload the origin.
      // PDS Fase 0: provider-configured chain, .new-chat-btn as final fallback.
      const newChatCfg = this._loadProviderConfig(provider);
      const newChatChain = resolveChain(newChatCfg, 'newChat', '.new-chat-btn');
      const { locator: newChatBtn, selector: newChatSel } = await firstMatchingLocator(page, newChatChain);
      if (newChatSel && await newChatBtn.count() > 0) {
        const isVisible = await newChatBtn.evaluate(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }).catch(() => false);
        if (isVisible) {
          await newChatBtn.click({ timeout: 10000 });
          log.info(`[_openNewChat] Clicked '${newChatSel}' for provider=${provider}`);
          await page.waitForTimeout(1500);
          const urlAfterClick = page.url();
          log.info(`[_openNewChat] URL after click: ${urlAfterClick}`);
          return urlAfterClick;
        }
      }
    } catch (e) {
      log.warn(`[_openNewChat] Button click failed: ${e.message} — falling back to goto`);
    }
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check /home/jhin/.luna-kernel/packages/kernel/kimi-bridge.cjs`
Expected: sem saída (OK)

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel && git add packages/kernel/kimi-bridge.cjs && git commit -m "refactor(kernel): PDS Fase 0 - _openNewChat via provider newChat chain"
```

---

### Task 8: `_checkLoginState` config-driven + detecção de `/sign_in`

**Files:**
- Modify: `packages/kernel/kimi-bridge.cjs:4664-4686` (método), `:4706`, `:4735`, `:4763` (call sites)

Conserta `.brain/bugs.md:22` item C (login preso em `/sign_in` sem ser detectado) e remove o literal `'kimi'` do check de texto.

- [ ] **Step 1: Reescrever o método**

Substituir (linhas 4661-4686):

```js
  /**
   * Check login state on a page using browser-native selectors (no :has-text()).
   */
  async _checkLoginState(page) {
    try {
      return await page.evaluate(() => {
        const bodyText = document.body?.innerText?.toLowerCase() || '';
        // Look for actual login indicators
        const hasLoginBtn = !!(
          document.querySelector('a[href*="login"], a[href*="signin"], button[class*="login"], button[class*="signin"]') ||
          document.querySelector('input[type="password"]')
        );
        const hasChatInput = !!(
          document.querySelector('textarea[placeholder], [contenteditable="true"]') ||
          document.querySelector('div[role="textbox"]')
        );
        const hasLoginText = bodyText.includes('log in') || bodyText.includes('sign in') || bodyText.includes('登录') || bodyText.includes('entrar');
        const hasWelcome = bodyText.includes('welcome') || bodyText.includes('kimi');
        // Consider logged in if we see chat input AND no login text/button
        const loggedIn = hasChatInput && !hasLoginText && !hasLoginBtn;
        return { loggedIn, hasLoginBtn, hasChatInput, hasLoginText, hasWelcome, url: location.href };
      });
    } catch (e) {
      return { loggedIn: false, error: e.message };
    }
  }
```

Por:

```js
  /**
   * Check login state on a page using the provider's loginIndicator/appContent
   * selector chains (PDS Fase 0). A forced-auth URL (/sign_in, /login, /auth)
   * is decisive regardless of DOM content — DeepSeek keeps a textarea-less
   * page on chat.deepseek.com/sign_in when logged out.
   */
  async _checkLoginState(page, provider = 'kimi') {
    try {
      const loginCfg = this._loadProviderConfig(provider);
      const loginChain = resolveChain(loginCfg, 'loginIndicator', 'a[href*="login"], a[href*="signin"]');
      const appChain = resolveChain(loginCfg, 'appContent', 'textarea[placeholder], [contenteditable="true"]');
      return await page.evaluate(({ loginChain, appChain }) => {
        const url = location.href;
        if (/\/(sign[_-]?in|login|auth)(\/|$|\?|#)/i.test(url)) {
          return { loggedIn: false, loginRequired: true, url };
        }
        const firstMatch = (sels) => {
          for (const s of sels) { try { if (document.querySelector(s)) return true; } catch (e) {} }
          return false;
        };
        const hasLoginBtn = firstMatch(loginChain) || !!document.querySelector('input[type="password"]');
        const hasChatInput = firstMatch(appChain) || !!document.querySelector('div[role="textbox"]');
        const bodyText = document.body?.innerText?.toLowerCase() || '';
        const hasLoginText = bodyText.includes('log in') || bodyText.includes('sign in') || bodyText.includes('登录') || bodyText.includes('entrar');
        // Consider logged in if we see chat input AND no login text/button
        const loggedIn = hasChatInput && !hasLoginText && !hasLoginBtn;
        return { loggedIn, hasLoginBtn, hasChatInput, hasLoginText, url };
      }, { loginChain, appChain });
    } catch (e) {
      return { loggedIn: false, error: e.message };
    }
  }
```

- [ ] **Step 2: Atualizar os 3 call sites**

Linha 4706 (dentro de `ensureLogin`, `provider` em escopo):

```js
    const state = await this._checkLoginState(page, provider);
```

Linha 4735 (mesmo método):

```js
    const state2 = await this._checkLoginState(page, provider);
```

Linha 4763 (dentro de `waitForLogin`):

```js
      const state = await this._checkLoginState(page, this._resolveProvider(userId));
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check /home/jhin/.luna-kernel/packages/kernel/kimi-bridge.cjs`
Expected: sem saída (OK)

- [ ] **Step 4: Commit**

```bash
cd /home/jhin/.luna-kernel && git add packages/kernel/kimi-bridge.cjs && git commit -m "fix(kernel): PDS Fase 0 - _checkLoginState via provider chains + /sign_in URL detection (bugs.md:22 C)"
```

---

### Task 9: `connect()` — localStorage per-provider + domínio derivado do baseUrl

**Files:**
- Modify: `packages/kernel/kimi-bridge.cjs:1324-1344` (localStorage), `:4893` (domínio)

- [ ] **Step 1: localStorage per-provider**

Substituir (linhas 1324-1344):

```js
    // v3.9-fix: Also inject localStorage into defaultContext pages
    try {
      const masterLsPath = path.join(__dirname, 'cookies', 'kimi-master-localstorage.json');
      if (fs.existsSync(masterLsPath)) {
        const masterLsData = JSON.parse(fs.readFileSync(masterLsPath, 'utf8'));
        const lsData = masterLsData.data || {};
        const keys = Object.keys(lsData);
        if (keys.length > 0) {
          for (const page of this.defaultContext.pages()) {
            await page.evaluate((items) => {
              for (const [key, value] of Object.entries(items)) {
                try { localStorage.setItem(key, value); } catch (e) {}
              }
            }, lsData).catch(() => {});
          }
          log.info(`Injected ${keys.length} localStorage items into defaultContext pages`);
        }
      }
    } catch (e) {
      log.warn(`Failed to inject MASTER localStorage into defaultContext: ${e.message}`);
    }
```

Por:

```js
    // v3.9-fix: Also inject localStorage into defaultContext pages.
    // PDS Fase 0: per-provider (was hardcoded to the kimi file), and only
    // into pages whose URL matches the provider host — localStorage is
    // per-origin, so injecting anywhere else was a no-op anyway.
    try {
      for (const providerName of listProviders()) {
        const providerCfg = loadProviderConfig(providerName);
        const cookiePaths = getProviderCookies(providerCfg);
        const masterLsPath = cookiePaths.localStorage;
        if (!fs.existsSync(masterLsPath)) continue;
        const masterLsData = JSON.parse(fs.readFileSync(masterLsPath, 'utf8'));
        const lsData = masterLsData.data || {};
        const keys = Object.keys(lsData);
        if (keys.length === 0) continue;
        const providerHost = this._providerDomain(providerName);
        for (const page of this.defaultContext.pages()) {
          if (!page.url().includes(providerHost)) continue;
          await page.evaluate((items) => {
            for (const [key, value] of Object.entries(items)) {
              try { localStorage.setItem(key, value); } catch (e) {}
            }
          }, lsData).catch(() => {});
        }
        log.info(`Injected ${keys.length} localStorage items for ${providerName} into matching defaultContext pages`);
      }
    } catch (e) {
      log.warn(`Failed to inject MASTER localStorage into defaultContext: ${e.message}`);
    }
```

- [ ] **Step 2: domínio derivado do baseUrl**

Em `_syncMasterCookiesFromContext`, substituir (linha 4893):

```js
      const providerDomain = providerCfg.domain || '.kimi.com';
```

Por:

```js
      const providerDomain = providerCfg.domain || '.' + this._providerDomain(providerName).replace(/^www\./, '');
```

(O domínio só afeta o contador do log — o arquivo master recebe todos os cookies do perfil de qualquer forma.)

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check /home/jhin/.luna-kernel/packages/kernel/kimi-bridge.cjs`
Expected: sem saída (OK)

- [ ] **Step 4: Commit**

```bash
cd /home/jhin/.luna-kernel && git add packages/kernel/kimi-bridge.cjs && git commit -m "refactor(kernel): PDS Fase 0 - connect() localStorage per-provider + cookie-sync domain from baseUrl"
```

---

### Task 10: Deletar o ramo CDP-Fetch morto do interceptor + `_isChatUrl` via config

**Files:**
- Modify: `packages/kernel/kimi-bridge.cjs:744-899` (classe), `:8721` (exports), `:35` (import)
- Modify: `packages/kernel/provider-loader.cjs:68-70,82`
- Test: `packages/kernel/tests/wave11-provider-config.test.cjs`

Fecha `.brain/bugs.md:23`: `_buildFetchPatterns` é chamado em `kb:768` e nunca existiu — todo `start()` lançava e caía no fallback Playwright. O fallback vira o único caminho, e `_isChatUrl` passa a usar `apiEndpoints` do config EM UNIÃO com os defaults legados hardcoded (kimi.json intocada; cobertura da Kimi idêntica à pré-refatoração).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `tests/wave11-provider-config.test.cjs`:

```js
// ── ProviderNetworkInterceptor (Task 10) ──
const { ProviderNetworkInterceptor } = require('../kimi-bridge.cjs');

test('T10a: _isChatUrl casa todos os padrões legados mesmo com kimi.json intocada', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, 'kimi.json'), 'utf8'));
  const interceptor = new ProviderNetworkInterceptor(null, cfg);
  for (const url of [
    'https://www.kimi.com/api/chat/abc',
    'https://www.kimi.com/kimi.gateway.chat/x',
    'https://www.kimi.com/apiv2/kimi.chat/y',
    'https://www.kimi.com/kimi.chat.v1.ChatService/ChatCompletion',
  ]) {
    assert.ok(interceptor._isChatUrl(url), `kimi deve casar ${url} (config ∪ defaults legados)`);
  }
  assert.strictEqual(interceptor._isChatUrl('https://www.kimi.com/static/app.js'), false);
});

test('T10b: _isChatUrl usa apiEndpoints do config (deepseek)', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, 'deepseek.json'), 'utf8'));
  const interceptor = new ProviderNetworkInterceptor(null, cfg);
  assert.ok(interceptor._isChatUrl('https://chat.deepseek.com/api/v0/chat/completion'));
  assert.strictEqual(interceptor._isChatUrl('https://chat.deepseek.com/static/app.js'), false);
});

test('T10c: start() não tenta CDP Fetch (ramo morto removido)', async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, 'kimi.json'), 'utf8'));
  let listenerRegistered = false;
  const fakePage = { on: () => { listenerRegistered = true; }, off: () => {} };
  const interceptor = new ProviderNetworkInterceptor(fakePage, cfg);
  await interceptor.start();
  assert.strictEqual(listenerRegistered, true);
  assert.strictEqual(interceptor._cdpSession, null);
  interceptor.stop();
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd /home/jhin/.luna-kernel/packages/kernel && node --test tests/wave11-provider-config.test.cjs`
Expected: FAIL — `ProviderNetworkInterceptor` undefined no require (ou T10c falha porque `start()` tenta CDP)

- [ ] **Step 3: Reescrever `start()` sem o ramo CDP**

Substituir (linhas 758-812):

```js
  async start() {
    if (this._active) return;
    this._active = true;

    // v7.5: Use CDP Fetch domain for real-time response interception
    // This captures SSE chunks as they arrive, not just at the end.
    try {
      this._cdpSession = await this.page.context().newCDPSession(this.page);
      
      // Build patterns from provider config + fallback
      const patterns = this._buildFetchPatterns();
      
      await this._cdpSession.send('Fetch.enable', { patterns });

      this._cdpSession.on('Fetch.requestPaused', async (event) => {
        const { requestId, responseStatusCode, responseHeaders } = event;

        // Only intercept successful responses
        if (responseStatusCode && responseStatusCode >= 200 && responseStatusCode < 300) {
          this._requestId = requestId;
          this.lastActivity = Date.now();

          try {
            // Get response body (may be partial for streaming)
            const bodyResult = await this._cdpSession.send('Fetch.getResponseBody', { requestId });
            if (bodyResult.body) {
              const text = bodyResult.base64Encoded
                ? Buffer.from(bodyResult.body, 'base64').toString('utf-8')
                : bodyResult.body;
              // v8.7-fix: Limit buffer size to prevent memory growth / crash
              if (this._responseBuffer.length > 10 * 1024 * 1024) {
                this._responseBuffer = this._responseBuffer.slice(-5 * 1024 * 1024);
              }
              this._responseBuffer += text;
              this._parseSse(text);
            }
          } catch (e) {
            // Body may not be available yet for streaming responses
          }
        }

        // Always continue the request so the page works normally
        try {
          await this._cdpSession.send('Fetch.continueRequest', { requestId });
        } catch (e) {
          // Request may have been already continued
        }
      });

      log.info('[KimiNetworkInterceptor] Started — listening via CDP Fetch domain');
    } catch (e) {
      log.warn(`[KimiNetworkInterceptor] CDP Fetch failed (${e.message}), falling back to page.on('response')`);
      this._startPlaywrightFallback();
    }
  }
```

Por:

```js
  async start() {
    if (this._active) return;
    this._active = true;
    // PDS Fase 0: the CDP Fetch branch was removed — it depended on
    // _buildFetchPatterns, which never existed, so every start() threw and
    // fell back to the Playwright listener anyway. The listener is now the
    // sole interception path.
    this._startPlaywrightFallback();
    log.info('[ProviderNetworkInterceptor] Started — listening via page.on("response")');
  }
```

- [ ] **Step 4: `_isChatUrl` via config**

Substituir (linhas 862-871):

```js
  _isChatUrl(url) {
    return typeof url === 'string' && (
      url.includes('/api/chat') ||
      url.includes('/ChatService/Chat') ||
      url.includes('/kimi.gateway.chat') ||
      url.includes('/apiv2/kimi.chat') ||
      url.includes('/kimi.chat.v1.ChatService') ||
      url.includes('/ChatService/ChatCompletion')
    );
  }
```

Por:

```js
  _isChatUrl(url) {
    if (typeof url !== 'string') return false;
    // PDS Fase 0: provider-config apiEndpoints UNIONED with the legacy
    // hardcoded defaults — kimi.json stays untouched (owner directive) and
    // Kimi's URL coverage is identical to the pre-refactor hardcoded list.
    const endpoints = this.providerConfig?.apiEndpoints || [];
    const defaults = [
      '/api/chat',
      '/ChatService/Chat',
      '/kimi.gateway.chat',
      '/apiv2/kimi.chat',
      '/kimi.chat.v1.ChatService',
      '/ChatService/ChatCompletion',
    ];
    return endpoints.concat(defaults).some(ep => url.includes(ep));
  }
```

- [ ] **Step 5: Exportar a classe para testes**

Em `module.exports` (linha 8721), adicionar após `KimiLogger,`:

```js
  // PDS Fase 0: exported for unit tests (wave11).
  ProviderNetworkInterceptor,
```

- [ ] **Step 6: Remover `getProviderApiPatterns` (dead code)**

Em `provider-loader.cjs`, deletar a função (linhas 68-70):

```js
function getProviderApiPatterns(providerConfig) {
  return providerConfig.cdpPatterns || [];
}
```

e removê-la do `module.exports` (linha 82). Em `kimi-bridge.cjs:35`, remover `getProviderApiPatterns` da lista de imports (nenhum outro importador existe — verificado por grep).

- [ ] **Step 7: Rodar testes + sintaxe**

Run: `cd /home/jhin/.luna-kernel/packages/kernel && node --check kimi-bridge.cjs && node --check provider-loader.cjs && node --test tests/*.test.cjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `tests 299` / `pass 299` / `fail 0`

- [ ] **Step 8: Commit**

```bash
cd /home/jhin/.luna-kernel && git add packages/kernel/kimi-bridge.cjs packages/kernel/provider-loader.cjs packages/kernel/tests/wave11-provider-config.test.cjs && git commit -m "fix(kernel): PDS Fase 0 - remove dead CDP Fetch branch, config-driven _isChatUrl (bugs.md:23), drop getProviderApiPatterns"
```

---

### Task 11: Regressão completa + restart do serviço

**Files:** nenhum (verificação)

- [ ] **Step 1: Suíte completa**

Run: `cd /home/jhin/.luna-kernel/packages/kernel && node --test tests/*.test.cjs 2>&1 | grep -E "^ℹ (tests|pass|fail|skipped)"`
Expected: `tests 299` / `pass 299` / `fail 0` / `skipped 0`

- [ ] **Step 2: Sintaxe de todos os modificados**

Run: `cd /home/jhin/.luna-kernel && node --check packages/kernel/kimi-bridge.cjs && node --check packages/kernel/provider-loader.cjs && node --check packages/kernel/lib/provider-selectors.cjs && echo OK`
Expected: `OK`

- [ ] **Step 3: Restart do luna-server**

Run: `pm2 restart luna-server && sleep 6 && pm2 jlist | python3 -c "import json,sys; [print(p['name'], p['pm2_env']['status'], 'restarts=' + str(p['pm2_env']['restart_time'])) for p in json.load(sys.stdin) if p['name']=='luna-server']"`
Expected: `luna-server online restarts=<n>` (estável, sem crash-loop)

- [ ] **Step 4: Logs limpos pós-restart**

Run: `tail -5 ~/.pm2/logs/luna-server-error-*.log | tail -5`
Expected: nenhum `TypeError`, `is not a function` ou stack de boot

---

### Task 12: Smoke test manual (dono)

**Files:** nenhum (validação ao vivo)

- [ ] **Step 1: Kimi — turno completo**

Abrir o chat web (:3458 / :5173), enviar uma mensagem no provider Kimi.
Verificar: resposta streama, tools executam, sem regressão vs. antes da Fase 0.

- [ ] **Step 2: DeepSeek — login + sessão + mensagem**

Logar no DeepSeek no Chrome da Luna, rodar a captura de sessão
(`node packages/kernel/save-deepseek-session.js` no PC onde o Chrome roda),
trocar o provider para DeepSeek no pill e enviar uma mensagem.
Verificar: input encontrado via config (log `Step 4: input found via ...`),
nenhum "Input field not found on Kimi Web", resposta chega pelo caminho genérico.

- [ ] **Step 3: Commit do fechamento da fase (atualiza bugs.md)**

Após o smoke passar, marcar em `.brain/bugs.md` o item DeepSeek (`:22`) e o bug
do interceptor (`:23`) como resolvidos nesta fase:

```bash
cd /home/jhin/.luna-kernel && git add packages/kernel/.brain/bugs.md && git commit -m "docs(brain): PDS Fase 0 closes DeepSeek input/login bug + dead CDP interceptor bug"
```

---

## Critérios de saída da Fase 0

- 299/299 testes passando (285 legados + 14 novos).
- Kimi funcionalmente idêntica (fallbacks preservam todos os seletores antigos; `kimi.json` intocada — smoke T12.1).
- DeepSeek loga, encontra input via config e responde (smoke T12.2).
- Zero referências a `_buildFetchPatterns`/`getProviderApiPatterns` no código; `cdpPatterns` removido do deepseek.json (o da kimi.json é inerte — nada mais o lê).
- `bugs.md:22` e `bugs.md:23` fechados.

## Notas para o implementador

- `resolvedProvider` está em escopo em `sendMessage`/`sendMessageStream` (usado em `kb:4033/4066/7599`). Nos pontos onde não há provider resolvido, usar `this._resolveProvider(userId)`.
- `firstMatchingLocator` retorna `selector: null` quando nada casa — o `locator` retornado aponta para o primeiro da chain (count() === 0), mantendo um único caminho de checagem de existência.
- Não tocar em `setMode`/`_detectActualMode` (Kimi-only por design; fora do escopo da Fase 0).
- A extensão (`luna-extension/`) NÃO é tocada nesta fase (Fase 5 da spec).
- Commits seguem a convenção do repo (`fix(kernel):`, `feat(kernel):`, `refactor(kernel):`, `docs(...)`). O hook post-commit atualiza `.brain/` sozinho.
