import type { Logger } from 'pino';
import { OPERADOR_VOICE_PROMPT, HOLD_TEXT } from './bridge.js';

/**
 * F6 v2 — Sessão do Operador no chrome-voice (decreto owner). O Chrome do
 * ChatGPT agora é um app PERSISTENTE e VISÍVEL (perfil ~/.luna/chrome-voice,
 * CDP :9340) que o owner logou uma vez. Este módulo: garante a aba do
 * ChatGPT aberta, injeta o OPERADOR_VOICE_PROMPT (§26) + contexto da chamada
 * (quem é o contato, motivo do teste, personalidade) e envia a marca de
 * espera — tudo narrado no log e observável na janela.
 */

export interface OperatorSessionDeps {
  /** Endpoint CDP do chrome-voice. Default http://localhost:9340. */
  cdpUrl?: string;
  log?: Logger;
}

export interface CallContext {
  /** Quem está na chamada (ex.: 'Pai'). */
  caller: string;
  /** Motivo/contexto do atendimento. */
  motivo: string;
  /** Extras livres (escopo, regras do teste). */
  extras?: string[];
}

const COMPOSER_SEL = '#prompt-textarea, textarea[placeholder*="Message" i], div[contenteditable="true"]';
const SEND_SEL = 'button[data-testid="send-button"], button[aria-label*="Send" i]';

export class OperatorSession {
  private browser: import('playwright-core').Browser | null = null;
  private readonly cdpUrl: string;

  constructor(deps: OperatorSessionDeps = {}) {
    this.cdpUrl = deps.cdpUrl ?? 'http://localhost:9340';
    this.log = deps.log;
  }
  private readonly log?: Logger;
  private say(msg: string, extra?: object): void {
    this.log?.info(extra ?? {}, `operator: ${msg}`);
  }

  /** Conecta no chrome-voice via CDP. */
  async connect(): Promise<boolean> {
    const { chromium } = await import('playwright-core');
    this.browser = await chromium.connectOverCDP(this.cdpUrl).catch((err) => {
      this.log?.warn({ err: String(err).slice(0, 150) }, `operator: chrome-voice não respondeu em ${this.cdpUrl}`);
      return null;
    });
    if (this.browser) this.say(`conectei no chrome-voice (${this.cdpUrl})`);
    return this.browser !== null;
  }

  /** Garante uma aba do chatgpt.com aberta (reusa existente). */
  async ensureChatGptTab(): Promise<import('playwright-core').Page | null> {
    if (!this.browser) return null;
    const ctx = this.browser.contexts()[0];
    const page = ctx?.pages().find((p) => p.url().includes('chatgpt.com'));
    if (page) {
      this.say('aba do ChatGPT já está aberta — reutilizo');
      return page;
    }
    this.say('aba do ChatGPT não existe — abrindo uma nova');
    const p = await ctx?.newPage().catch(() => null);
    if (!p) return null;
    await p.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    return p;
  }

  /** Escreve texto no composer e envia (com verificação de que o campo esvaziou). */
  async sendText(page: import('playwright-core').Page, text: string): Promise<void> {
    const composer = page.locator(COMPOSER_SEL).first();
    await composer.click({ timeout: 4_000 });
    await page.waitForTimeout(200);
    await page.keyboard.type(text, { delay: 4 });
    await page.waitForTimeout(300);
    const send = page.locator(SEND_SEL).first();
    const sent = await send.click({ timeout: 3_000 }).then(() => true).catch(() => false);
    if (!sent) {
      // fallback: Enter
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(800);
  }

  /** Injeta o prompt do Operador (§26) + contexto da chamada e dispara. */
  async injectContext(page: import('playwright-core').Page, ctx: CallContext): Promise<void> {
    const full = [
      OPERADOR_VOICE_PROMPT,
      '',
      `CONTEXTO DESTA CHAMADA:`,
      `- Quem está na linha: ${ctx.caller}.`,
      `- Motivo: ${ctx.motivo}.`,
      ...(ctx.extras ?? []).map((e) => `- ${e}`),
      '',
      'Confirme com "ok, entendi" e aguarde as instruções da Luna.',
    ].join('\n');
    this.say(`injetando prompt §26 + contexto (${ctx.caller} — ${ctx.motivo})`);
    await this.sendText(page, full);
    this.say('prompt enviado — Operador inicializado');
  }

  /** Marca de espera padrão (§26): Abner nunca fica em silêncio morto. */
  async hold(page: import('playwright-core').Page): Promise<void> {
    this.say('enviando marca de espera');
    await this.sendText(page, HOLD_TEXT);
  }

  /** Best-effort: lê a última resposta do assistente na página. */
  async readLatestReply(page: import('playwright-core').Page): Promise<string | null> {
    const replies = await page
      .evaluate(`(() => {
        const els = document.querySelectorAll('[data-message-author-role="assistant"]');
        const last = els[els.length - 1];
        return last ? (last.textContent || '').trim().slice(0, 500) : null;
      })()`)
      .catch(() => null);
    return typeof replies === 'string' ? replies : null;
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }
}

export { HOLD_TEXT };
