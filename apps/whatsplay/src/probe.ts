import { writeFileSync, mkdirSync } from 'node:fs';
import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

/**
 * Diagnóstico vivo: sobe o Chrome dedicado, espera o app renderizar de
 * verdade e despeja um relatório de marcadores estruturais do DOM (o que
 * existe vs o que os seletores v0 esperavam). Ferramenta da F1.5 também.
 *
 *   pnpm --filter whatsplay probe
 */

loadDotEnv();
const config = loadConfig();
const log = createLogger({ name: 'whatsplay-probe' });

const userDataDir = config.WHATSAPP_USER_DATA_DIR || join(homedir(), '.luna/chrome-whatsapp');

// Marcadores candidatos — cobertura EN/PT/ES e estruturais (id/class).
const PROBE_SCRIPT = `(() => {
  const count = (s) => document.querySelectorAll(s).length;
  const probes = {
    paneSide: count('#pane-side'),
    chatListTestId: count('[data-testid="chat-list"]'),
    chatListRoleGrid: count('#pane-side [role="grid"], [role="grid"]'),
    landingWrapper: count('.landing-wrapper'),
    landingMain: count('.landing-main'),
    qrTestId: count('[data-testid="qrcode"]'),
    qrRef: count('[data-ref]'),
    canvasTotal: count('canvas'),
    canvasInLanding: count('.landing-wrapper canvas, .landing-main canvas'),
    chatItemTestId: count('[data-testid="cell-frame-container"]'),
    chatRowRole: count('#pane-side [role="row"], [role="row"]'),
    headerChatTitle: count('[data-testid="conversation-info-header-chat-title"]'),
    msgContainer: count('[data-testid="msg-container"]'),
    composeBox: count('[data-testid="conversation-compose-box-input"]'),
    sideHeader: count('#side header, [data-testid="side-header"]'),
  };
  const pane = document.querySelector('#pane-side');
  const ariaLabels = [];
  document.querySelectorAll('[aria-label]').forEach((el) => {
    if (ariaLabels.length < 15) ariaLabels.push(el.getAttribute('aria-label'));
  });
  const titles = [];
  document.querySelectorAll('#pane-side [title]').forEach((el) => {
    if (titles.length < 10) titles.push(el.getAttribute('title'));
  });
  const bodySnippet = document.body.innerText.slice(0, 400);
  return { probes, panePresent: !!pane, ariaLabels, titles, bodySnippet,
           url: location.href, readyState: document.readyState };
})()`;

async function main(): Promise<void> {
  log.info({ userDataDir, headless: config.WHATSAPP_HEADLESS }, 'probe: subindo Chrome dedicado');
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: config.WHATSAPP_CHROME_PATH,
    headless: config.WHATSAPP_HEADLESS,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // A splash screen do WA demora; amostra em tempos crescentes.
  const samples: unknown[] = [];
  for (const wait of [5_000, 10_000, 15_000, 20_000]) {
    await page.waitForTimeout(wait === 5_000 ? 5_000 : 5_000);
    const sample = await page.evaluate(PROBE_SCRIPT).catch((err) => ({ error: String(err) }));
    samples.push({ after_ms: wait, sample });
    const s = sample as { probes?: { paneSide?: number } };
    if (s.probes && s.probes.paneSide) break; // app renderizou
  }

  const evidenceDir = fileURLToPath(new URL('../../../.brain/luna/incidents', import.meta.url));
  mkdirSync(evidenceDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = `${evidenceDir}/probe-${stamp}.json`;
  writeFileSync(reportPath, JSON.stringify(samples, null, 2), 'utf8');
  await page.screenshot({ path: `${evidenceDir}/probe-${stamp}.png` }).catch(() => {});

  console.log(JSON.stringify(samples[samples.length - 1], null, 2));
  log.info({ reportPath }, 'probe concluído');
  await ctx.close();
}

main().catch((err) => {
  log.fatal({ err }, 'probe falhou');
  process.exit(1);
});
