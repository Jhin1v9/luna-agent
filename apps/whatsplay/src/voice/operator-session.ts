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

  /**
   * Garante uma aba do chatgpt.com aberta (reusa existente) E a ancora no
   * chat FIXO do Operador (OPERATOR_CHAT_URL no .env — decreto owner 2026-
   * 09-23: sempre o MESMO chat pra o ChatGPT manter o contexto acumulado da
   * Luna entre chamadas, nunca conversa nova por chamada). Se a aba estiver
   * em outra conversa, navega pro chat fixo antes de qualquer ação.
   */
  async ensureChatGptTab(): Promise<import('playwright-core').Page | null> {
    if (!this.browser) return null;
    const ctx = this.browser.contexts()[0];
    const fixedUrl = process.env.OPERATOR_CHAT_URL?.trim();
    const page = ctx?.pages().find((p) => p.url().includes('chatgpt.com'));
    if (page) {
      if (fixedUrl && !page.url().includes(fixedUrl.replace(/^https?:\/\//, ''))) {
        this.say(`aba do ChatGPT fora do chat fixo do Operador — navegando p/ ${fixedUrl}`);
        await page.goto(fixedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
      } else {
        this.say(fixedUrl ? 'aba do ChatGPT já está no chat fixo do Operador ✅' : 'aba do ChatGPT já está aberta — reutilizo');
      }
      return page;
    }
    this.say('aba do ChatGPT não existe — abrindo uma nova');
    const p = await ctx?.newPage().catch(() => null);
    if (!p) return null;
    await p.goto(fixedUrl ?? 'https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
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

  /**
   * Injeção INSTANTÂNEA no composer (decreto owner 2026-09-24: "isso dá pra
   * fazer em 2 segundos"): digitar um prompt de ~2.000 chars com keyboard.type
   * (delay 3-4ms) leva 6-8s — inaceitável com a pessoa já na linha. Aqui o
   * texto entra via document.execCommand('insertText') (dispara os eventos
   * que o React precisa) e o envio segue no clique normal. Teclado físico
   * fica só de fallback.
   */
  async sendTextFast(page: import('playwright-core').Page, text: string): Promise<void> {
    const composer = page.locator(COMPOSER_SEL).first();
    await composer.click({ timeout: 4_000 });
    await page.waitForTimeout(150);
    const injected = await page
      .evaluate((t) => {
        const el = (document.querySelector('#prompt-textarea') as HTMLElement | null) ??
          document.querySelector('div[contenteditable="true"]');
        if (!el) return false;
        el.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false); // cursor no fim (não sobrescreve rascunho)
        sel?.removeAllRanges();
        sel?.addRange(range);
        return document.execCommand('insertText', false, t);
      }, text)
      .catch(() => false);
    await page.waitForTimeout(250);
    if (!injected) {
      this.say('insertText falhou — caindo no teclado (lento, mas funciona)');
      await page.keyboard.type(text, { delay: 3 });
    }
    const send = page.locator(SEND_SEL).first();
    const sent = await send.click({ timeout: 3_000 }).then(() => true).catch(() => false);
    if (!sent) await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  }

  /**
   * Lê as CAPTIONS/transcrição ao vivo do voice mode (decreto owner
   * 2026-09-24: "se assegure de estar lendo as transcrições ativamente").
   * LIMITAÇÃO conhecida (2ª chamada ao vivo, 2026-09-23): no voice mode a
   * fala NÃO vira mensagem no thread de texto — vive em aria-live/captions.
   * Leitura multi-seletor best-effort: aria-live regions + containers com
   * caption/transcript na classe. Falso-positivo (legendas de vídeo etc.)
   * é descartado pela conductora com bom senso — melhor ler demais que
   * continuar surda.
   */
  async readVoiceCaptions(
    page: import('playwright-core').Page,
  ): Promise<Array<{ source: string; text: string }>> {
    const r = (await page
      .evaluate(`(() => {
        const visible = (e) => !!(e && e.offsetParent !== null && e.getClientRects().length > 0);
        const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const out = [];
        const seen = new Set();
        const push = (source, el) => {
          const t = clean(el.textContent);
          if (t.length < 4 || seen.has(t)) return;
          seen.add(t);
          out.push({ source, text: t.slice(0, 600) });
        };
        document.querySelectorAll('[aria-live]').forEach((el) => { if (visible(el)) push('aria-live', el); });
        document.querySelectorAll('[class*="caption" i], [class*="transcript" i]').forEach((el) => { if (visible(el)) push('caption', el); });
        return out.slice(-8);
      })()`)
      .catch(() => [])) as Array<{ source: string; text: string }>;
    return Array.isArray(r) ? r : [];
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

  /**
   * Voice mode ativo? (bug da 2ª chamada ao vivo: o prompt foi injetado em
   * modo TEXTO — a voz nunca entrou. Decreto owner: entrar em modo de voz
   * ANTES de injetar.) Marcadores best-effort: caption "escutando/listening",
   * overlay do voice mode, ou o composer substituído pela UI de voz.
   */
  private async isVoiceModeActive(page: import('playwright-core').Page): Promise<boolean> {
    const r = await page
      .evaluate(`(() => {
        const visible = (e) => !!(e && e.offsetParent !== null && e.getClientRects().length > 0);
        const body = (document.body.innerText || '').slice(0, 4000);
        if (/tô escutando|ta escutando|listening|ouvindo você|i'm listening|escuchando|te escucha/i.test(body)) return true;
        // probe 2026-09-23: a UI em espanhol expõe o orb como "voice-floating-orb"
        const overlay = document.querySelector('[data-testid*="voice-mode" i], [data-testid*="voice_mode" i], [class*="voice-mode" i], [data-testid="voice-floating-orb"]');
        if (overlay && visible(overlay)) return true;
        // marcador FORTE (probe real 2026-09-23): botões da sessão de voz ativa
        // (UI PT + ES — sessão do owner caiu em espanhol e "Finalizar Voz"
        // escapava de todos os padrões, travando o pré-voo das chamadas)
        const voiceButtons = Array.from(document.querySelectorAll('button')).some((b) =>
          visible(b) && /encerrar voz|finalizar voz|terminar voz|desativar microfone|desactivar micrófono|configuraci.n de voz|end voice|stop voice|mute microphone|desativar voz/i.test(b.getAttribute('aria-label') || ''));
        if (voiceButtons) return true;
        return false;
      })()`)
      .catch(() => false);
    return r === true;
  }

  /** Garante o ChatGPT em MODO DE VOZ (clique no ícone de ondas, à direita
   *  do composer). Falha explícita se não conseguir entrar — o caller NÃO
   *  disca (nunca ligar com operador que não consegue falar). */
  async ensureVoiceMode(page: import('playwright-core').Page): Promise<void> {
    if (await this.isVoiceModeActive(page)) {
      this.say('voice mode já está ativo ✅ — não clico de novo');
      return;
    }
    // 🆕 2026-09-23 (bug ao vivo, 3ª tentativa de chamada): com RASCUNHO no
    // composer, o botão azul vira "Enviar prompt" e o "Iniciar Voz" (ES:
    // 'Iniciar Voz' — o botão de ondas à direita do composer) NÃO EXISTE no
    // DOM. O rascunho de uma sessão anterior travava o pré-voo inteiro.
    // O prompt do Operador é injetado DEPOIS (ordem do pré-voo), então
    // limpar o composer aqui é seguro.
    await page
      .locator('#prompt-textarea')
      .first()
      .click({ timeout: 2_000 })
      .then(async () => {
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(600);
        this.say('composer limpo (rascunho anterior descartado) — procurando o botão de voz');
      })
      .catch(() => this.say('composer não focável — seguindo pro scan dos seletores'));
    this.say('voice mode INATIVO — clicando no ícone de voz (lado direito do composer)');
    const candidates = [
      'button[data-testid="voice-mode-entry-button"]',
      'button[aria-label*="Start voice" i]',
      'button[aria-label*="modo de voz" i]',
      'button[aria-label*="voice mode" i]',
      'button[aria-label*="Iniciar voz" i]',
      'button[aria-label="Iniciar Voz"]', // ES exato (sessão do owner cai em espanhol)
      'button[aria-label*="Comenzar voz" i]',
    ];
    for (const sel of candidates) {
      const ok = await page
        .locator(sel)
        .first()
        .click({ timeout: 2_000 })
        .then(() => true)
        .catch(() => false);
      if (!ok) {
        this.say(`seletor não casou: ${sel}`);
        continue;
      }
      this.say(`cliquei no ícone de voz (${sel}) — verificando`);
      if (await this.waitVoiceModeActive(page, 12_000)) {
        this.say('voice mode ativo ✅');
        return;
      }
      this.say('clique não ativou o modo de voz — tentando próximo seletor');
    }
    // último recurso: clique por posição (último botão visível à direita do composer)
    const fallback = await page
      .evaluate(`(() => {
        const composer = document.querySelector('#prompt-textarea')?.closest('div');
        const scope = composer ? composer.parentElement : document;
        const btns = Array.from(scope.querySelectorAll('button')).filter((b) => b.offsetParent !== null);
        const last = btns[btns.length - 1];
        if (last) { last.click(); return true; }
        return false;
      })()`)
      .catch(() => false);
    if (fallback === true) {
      if (await this.waitVoiceModeActive(page, 12_000)) {
        this.say('voice mode ativo ✅ (fallback posicional)');
        return;
      }
    }
    throw new Error('não consegui entrar em modo de voz no ChatGPT — NÃO vou discar (operador não conseguiria falar)');
  }

  /** Poll de ativação do modo voz: a UI demora 3-8s pra montar (cria a
   *  conversa, conecta na sessão de voz) — checar uma vez após 1.8s era
   *  cedo demais e abortava chamadas que ESTAVAM ativando (bug ao vivo
   *  2026-09-23: o clique funcionou, o aborto deixou a voz ligada). */
  private async waitVoiceModeActive(page: import('playwright-core').Page, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isVoiceModeActive(page)) return true;
      await page.waitForTimeout(1_500);
    }
    return false;
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
