import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { SELECTORS } from './selectors.js';
import { extractMention } from './rules.js';
import { normalizeName } from './allowlist.js';
import {
  STATE_PROBES_SCRIPT,
  COLLECT_UNREAD_CHATS_SCRIPT,
  READ_PANEL_MESSAGES_SCRIPT,
  READ_CONVERSATION_SCRIPT,
  MUTATION_OBSERVER_SCRIPT,
  OPEN_CHAT_TITLE_SCRIPT,
  ARCHIVED_OPEN_SCRIPT,
  SIMPLIFIED_DOM_SCRIPT,
} from './page-scripts.js';
import { detectStateFromProbes, type StateProbes } from './state.js';
import type {
  ChatSearchResult,
  ConversationMessage,
  SessionState,
  TransportStatus,
  UnreadMessage,
  WhatsAppTransport,
} from './transport.js';

/**
 * WhatsAppWebTransport — implementação Playwright do WhatsAppTransport (§13).
 * Chrome DEDICADO com user-data-dir próprio (sessão persistente, nunca o
 * perfil do Chrome do usuário). Captura por MUTAÇÃO de DOM (zero polling):
 * um MutationObserver na página notifica este processo via binding.
 *
 * v0 = extração ainda não validada em sessão logada real — a descoberta F1.4
 * confirmou launch + detecção de estado (QR_PENDING); mudanças de seletor
 * vão pro selector memory (.brain/luna/selectors/whatsapp.md).
 */

export interface BrowserConfig {
  chromePath: string;
  userDataDir: string;
  headless: boolean;
  /** Logger p/ warns operacionais (resíduo no campo de composição etc.). */
  log?: import('pino').Logger;
  /** Conta mensagens outbound com send_state='queued' (watchdog). */
  outgoingQueueCount?: () => Promise<number>;
  /** Diretório de evidências (screenshot + DOM simplificado). */
  evidenceDir: string;
}

export interface EvidencePaths {
  screenshotPath: string;
  domPath: string;
}

const WA_URL = 'https://web.whatsapp.com';

/**
 * page.evaluate com string NÃO invoca função nem passa argumento — avalia a
 * expressão e devolve seu valor (uma arrow string vira função não chamada,
 * serializada como undefined). Por isso: compomos um IIFE com o argumento
 * embutido como JSON. (Bug achado pelo readcheck ao vivo.)
 */
async function evalWithArg(page: Page, script: string, arg: unknown): Promise<unknown> {
  return page.evaluate(`(${script})(${JSON.stringify(arg)})`);
}

export class WhatsAppWebTransport implements WhatsAppTransport {
  /** Guarda de painel (decreto owner) — setada pelo daemon após o launch. */
  panelGuard: import('./panel-guard.js').PanelGuard | null = null;
  private ctx: BrowserContext | null = null;
  private cdp: import('playwright-core').Browser | null = null;
  private chromeProc: import('node:child_process').ChildProcess | null = null;
  private page: Page | null = null;
  private lastHeartbeatAt = new Date();
  private lastSeenMessageKey = new Map<string, string>();

  constructor(private readonly config: BrowserConfig) {}

  async launch(): Promise<void> {
    mkdirSync(this.config.userDataDir, { recursive: true });
    try {
      this.ctx = await chromium.launchPersistentContext(this.config.userDataDir, {
        executablePath: this.config.chromePath,
        headless: this.config.headless,
        viewport: { width: 1280, height: 800 },
        args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
      });
      this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
      await this.page.goto(WA_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      return;
    } catch {
      // Chrome 153 (2026-09-22): após atualização automática o processo
      // delegado sai com exit 21 e o browser fica órfão sem o pipe do
      // Playwright — launchPersistentContext quebra pra sempre. Fallback:
      // subir o Chrome nós mesmos com --remote-debugging-port e conectar
      // por CDP (mesmo perfil, mesma sessão).
    }
    const port = Number(process.env.WHATSAPP_CDP_PORT ?? 9333);
    this.cdp = await this.connectOrSpawnCdp(port);
    this.ctx = this.cdp.contexts()[0] ?? (await this.cdp.newContext());
    this.page =
      this.ctx.pages().find((p) => p.url().includes('web.whatsapp')) ??
      this.ctx.pages()[0] ??
      (await this.ctx.newPage());
    if (!this.page.url().includes('web.whatsapp.com')) {
      await this.page.goto(WA_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
    // Crash do renderer: não mata o daemon — o health loop (index.ts) detecta
    // e recupera via reload.
    this.page.on('crash', () => {
      this.config.log?.error({}, 'página CRASHOU (renderer) — health loop vai recuperar');
    });
  }

  /** Conecta num Chrome CDP existente ou sobe um novo (detached, sobrevive
   *  ao daemon; fechado no close() do transport). */
  private async connectOrSpawnCdp(port: number): Promise<import('playwright-core').Browser> {
    const endpoint = `http://localhost:${port}`;
    const tryConnect = () => chromium.connectOverCDP(endpoint).catch(() => null);
    let browser = await tryConnect();
    if (browser) return browser;
    this.chromeProc = spawn(
      this.config.chromePath,
      [
        this.config.headless ? '--headless' : '--start-maximized',
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${this.config.userDataDir}`,
        WA_URL,
      ],
      { detached: true, stdio: 'ignore' },
    );
    this.chromeProc.unref();
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      browser = await tryConnect();
      if (browser) return browser;
      await new Promise((r) => setTimeout(r, 1_500));
    }
    throw new Error(`Chrome não respondeu em ${endpoint} (fallback CDP)`);
  }

  private requirePage(): Page {
    if (!this.page || this.page.isClosed()) throw new Error('página WhatsApp não está viva');
    return this.page;
  }

  /**
   * Estado da sessão com heurística pura (state.ts) + polling até estabilizar.
   * A F1.4 ensinou que espera fixa gera falso negativo: a splash/intro do WA
   * Web pode durar mais que 15s; aqui amostramos a cada 2s até sair de
   * LOADING (máx. 30s) antes de concluir.
   */
  async detectSessionState(pollTimeoutMs = 30_000): Promise<SessionState> {
    const page = this.requirePage();
    const deadline = Date.now() + pollTimeoutMs;
    let last: SessionState = 'LOADING';
    try {
      while (Date.now() <= deadline) {
        const probes = (await page.evaluate(STATE_PROBES_SCRIPT)) as Partial<StateProbes>;
        last = detectStateFromProbes(probes);
        if (last !== 'LOADING') return last;
        await page.waitForTimeout(2_000);
      }
      return last;
    } catch {
      return 'UNKNOWN';
    }
  }

  async getStatus(): Promise<TransportStatus> {
    const pageAlive = !!this.page && !this.page.isClosed();
    let outgoingQueued = 0;
    if (this.config.outgoingQueueCount) {
      try {
        outgoingQueued = await this.config.outgoingQueueCount();
      } catch {
        outgoingQueued = -1;
      }
    }
    return {
      state: pageAlive ? await this.detectSessionState() : 'UNKNOWN',
      pageAlive,
      lastHeartbeatAt: this.lastHeartbeatAt.toISOString(),
      outgoingQueued,
    };
  }

  /**
   * Instala o MutationObserver na página (zero polling). Toda mutação relevante
   * dispara o callback com as conversas que ganharam badge de não-lidas.
   */
  async installMutationObserver(onUnread: (unread: UnreadMessage[]) => void): Promise<void> {
    const page = this.requirePage();
    await page.exposeBinding('onWaMutation', (_src, payload: unknown) => {
      this.lastHeartbeatAt = new Date();
      onUnread(payload as UnreadMessage[]);
    });
    await evalWithArg(page, MUTATION_OBSERVER_SCRIPT, SELECTORS);
  }

  /** Só re-injeta o script do observer (pós-reload o binding Node persiste). */
  private async injectObserverScript(): Promise<void> {
    await evalWithArg(this.requirePage(), MUTATION_OBSERVER_SCRIPT, SELECTORS).catch(() => {});
  }

  /**
   * Saúde da página (diagnóstico ao vivo 2026-09-22): a sessão caía
   * intermitentemente pro fallback noscript/splash (21 ocorrências no log —
   * meta refresh _fb_noscript=1, #pane-side ausente) e a automação ficava
   * cega até o próximo restart. Falso = página em fallback ou morta.
   */
  async isPageHealthy(): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    const ok = await this.page
      .evaluate(
        `!document.querySelector('meta[http-equiv="refresh"][content*="noscript"]') && !!document.querySelector('#pane-side')`,
      )
      .catch(() => false);
    return ok === true;
  }

  /** Recupera a página do fallback noscript: reload + espera renderizar +
   *  re-anexa o observer. Retorna true se saudável no fim. */
  async ensurePageHealthy(): Promise<boolean> {
    if (await this.isPageHealthy()) return true;
    const page = this.page;
    if (!page || page.isClosed()) return false;
    this.config.log?.warn({}, 'página caiu pro fallback noscript/splash — recuperando (reload)');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    await page.waitForSelector('#pane-side', { timeout: 60_000 }).catch(() => null);
    const ok = await this.isPageHealthy();
    if (ok) await this.injectObserverScript();
    return ok;
  }

  /**
   * Chats com badge de não-lida: abre cada um e extrai as mensagens novas
   * (v0 — validar em sessão logada).
   */
  async getUnread(): Promise<UnreadMessage[]> {
    const page = this.requirePage();
    if ((await this.detectSessionState()) !== 'LOGGED_IN') return [];

    const chats = (await evalWithArg(page, COLLECT_UNREAD_CHATS_SCRIPT, SELECTORS)) as Array<{
      chat_id: string;
      chat_name: string;
    }>;

    const unread: UnreadMessage[] = [];
    for (const chat of chats.slice(0, 5)) {
      try {
        if (!(await this.openChat(chat.chat_name))) continue;
        await page.waitForSelector(SELECTORS.messagePanel, { timeout: 3_000 }).catch(() => null);
        const messages = (await evalWithArg(page, READ_PANEL_MESSAGES_SCRIPT, SELECTORS)) as Array<{
          direction: string;
          text: string;
          quoted: string | null;
        }>;
        const inboundMsgs = messages.filter((m) => m.direction === 'inbound' && m.text);
        const last = inboundMsgs[inboundMsgs.length - 1];
        if (!last) continue;
        // Idempotência: não repete a última mensagem já vista do chat.
        const key = `${chat.chat_id}:${last.text}`;
        if (this.lastSeenMessageKey.get(chat.chat_id) === key) continue;
        this.lastSeenMessageKey.set(chat.chat_id, key);

        const isGroup = chat.chat_id.includes('@g.us');

        unread.push({
          chat_id: chat.chat_id,
          chat_name: chat.chat_name,
          is_group: isGroup,
          text: last.text,
          external_id: `wa:${chat.chat_id}:${Buffer.from(last.text).toString('base64').slice(0, 24)}`,
          quoted_text: last.quoted,
          quoted_from_luna: false,
          mentioned_luna: extractMention(last.text),
          received_at: new Date().toISOString(),
        });
      } catch {
        // chat que falhou ao abrir não derruba a varredura
      }
    }
    return unread;
  }

  async readConversation(chatId: string, limit = 20): Promise<ConversationMessage[]> {
    const page = this.requirePage();
    const guard = this.panelGuard;
    if (!(await this.isPageHealthy())) await this.ensurePageHealthy();
    await guard?.beginCycle('readConversation'); // painel DEVE estar na lista
    try {
      // NUNCA ler o painel sem conferir o chat: openChat verifica o título.
      // Falhou → retorna vazio (o sweep tenta de novo no próximo ciclo).
      if (!(await this.openChat(chatId))) return [];
      const messages = (await evalWithArg(page, READ_CONVERSATION_SCRIPT, {
        sel: SELECTORS,
        lim: limit,
      })) as ConversationMessage[];
      return messages.filter((m) => m.text);
    } finally {
      try {
        await this.closeCurrentChat(); // decreto: nunca deixar aberto
        await guard?.endCycle('readConversation');
      } catch {
        /* PanelStuckError já reportou via onStuck */
      }
    }
  }

  async sendMessage(chatId: string, text: string, opts?: { inputSelector?: string }): Promise<string> {
    const page = this.requirePage();
    const guard = this.panelGuard;
    // Página no fallback noscript/splash? Recupera AGORA em vez de falhar o
    // envio (evidência ao vivo 2026-09-22: entregas falhando durante
    // episódios de noscript que o health loop só pegava no próximo tick).
    if (!(await this.isPageHealthy())) await this.ensurePageHealthy();
    await guard?.beginCycle('sendMessage');
    try {
      // Idem: sem verificação, o texto iria para o chat ERRADO (bug de
      // roteamento 2026-09-21). Falha explícita > envio no destino errado.
      if (!(await this.openChat(chatId))) {
        throw new Error(`não consegui abrir o chat '${chatId}' — envio ABORTADO para não ir pro chat errado`);
      }
      // Seletor do campo: override vem do auto-reparo (§14); default = SELECTORS.
      // SEGURANÇA (bug ao vivo 2026-09-22): o FAST do auto-reparo sugere
      // seletores da LISTA/resultado de busca (#pane-side …) — clicáveis, mas
      // NÃO são o campo de composição; aplicados aqui travavam o envio até
      // esgotar as 3 tentativas. Só aceita override que exista DENTRO de
      // #main (o painel da conversa, onde fica o campo de digitação).
      let inputSelector: string = SELECTORS.inputBox;
      if (opts?.inputSelector) {
        const inMain = await page
          .locator(`#main ${opts.inputSelector}`)
          .first()
          .count()
          .catch(() => 0);
        if (inMain > 0) inputSelector = opts.inputSelector;
      }
      await page.click(inputSelector);
      await this.composeTypeAndSend(page, inputSelector, text, chatId);
      this.lastHeartbeatAt = new Date();
      return `sent:${chatId}:${Date.now()}`;
    } finally {
      try {
        await this.closeCurrentChat(); // decreto: nunca deixar aberto
        await guard?.endCycle('sendMessage');
      } catch {
        /* PanelStuckError já reportou via onStuck */
      }
    }
  }

  /**
   * Digita no campo de composição e confirma o envio de verdade (decreto
   * owner 2026-09-22): limpa resíduo, exige painel aberto na hora da
   * digitação, e o campo VISÍVEL tem que esvaziar — se não esvaziar após
   * 2× Enter, limpa e FALHA explícita (nunca 'sent' falso).
   * Compartilhado por sendMessage e replyToMessage (v2 citação).
   */
  private async composeTypeAndSend(page: Page, inputSelector: string, text: string, chatId: string): Promise<void> {
    // LIMPEZA DO CAMPO (decreto owner 2026-09-22, "msg esquisita"): abort
    // anterior deixava rascunho no campo e o texto novo concatenava com o
    // resíduo. Sempre limpa antes de digitar; resíduo = warn (indica abort).
    const residue = await this.clearComposeBox(page, inputSelector);
    if (residue > 0) {
      this.config.log?.warn(
        { chars: residue, chat: chatId },
        'campo de composição continha resíduo — limpo (abort anterior provável)',
      );
    }
    await page.waitForTimeout(150);
    // Invariante: o painel tem que estar aberto NA HORA de digitar — se
    // fechou (sweep/guard/reload), aborta ANTES de escrever (senão o
    // texto vira rascunho em whatever chat estiver aberto).
    if ((await this.currentOpenChatTitle()) === null) {
      throw new Error('painel fechou antes da digitação — envio ABORTADO pra não virar rascunho no chat errado');
    }
    // Delay humano mínimo contra padrão robótico (risco de ban — ADR-004).
    await page.waitForTimeout(300 + Math.floor(Math.random() * 500));
    await page.keyboard.type(text, { delay: 15 + Math.floor(Math.random() * 30) });
    await page.keyboard.press('Enter');
    // Confirmação REAL de envio (decreto owner + diagnóstico ao vivo
    // 2026-09-22): mensagem marcada 'sent' SEM chegar no chat — o Enter nem
    // sempre pega. O campo VISÍVEL tem que esvaziar; se não esvaziar, dá um
    // segundo Enter; se AINDA ficar de rascunho, limpa e FALHA explícita
    // (nunca 'sent' falso — falha retryável > silêncio com sucesso fake).
    await page.waitForTimeout(500);
    let leftover = await this.composeBoxTextLen(page, inputSelector);
    if (leftover > 0) {
      this.config.log?.warn({ chars: leftover, chat: chatId }, 'campo não esvaziou no 1º Enter — tentando de novo');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
      leftover = await this.composeBoxTextLen(page, inputSelector);
    }
    if (leftover > 0) {
      await this.clearComposeBox(page, inputSelector);
      throw new Error(`envio NÃO confirmado: campo ainda tinha ${leftover} chars após 2× Enter — rascunho limpo, mensagem NÃO enviada`);
    }
  }

  /** Valor VISÍVEL atual do campo de busca (null = não achado). */
  private async searchFieldValue(page: Page): Promise<string | null> {
    // WA Web 2026-09: o campo de busca é <input> com aria-label (PT "Buscar"/
    // ES "Buscar..." — a sessão do owner cai em espanhol) SEM
    // data-testid="chat-list-search-container" no wrapper. O seletor de CLIQUE
    // casava via input[aria-label*="Buscar"], mas este de LEITURA não —
    // 'obtido: null' com o termo VISÍVEL na tela (evidência
    // openchat-busca-*.png 22:32), loop digitava/apagava pra sempre. Leitura
    // agora cobre os MESMOS casamentos do clique + fallback genérico.
    const v = await page
      .evaluate(`(() => {
        // offsetParent === null para elementos position:fixed/sticky (header do
        // WA 2026 é sticky) — o check antigo marcava o input VISÍVEL como
        // invisível e a leitura voltava null com o termo na tela (2ª evidência
        // 22:36). Visibilidade real = rect não-nulo + display/visibility.
        const visible = (e) => {
          if (!e) return false;
          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const s = getComputedStyle(e);
          return s.display !== 'none' && s.visibility !== 'hidden';
        };
        const sels = [
          '#side [data-testid="chat-list-search-container"] input',
          '#side input[aria-label*="Buscar" i]',
          '#side input[aria-label*="Search" i]',
          '#side input[aria-label*="Pesquisar" i]',
          '#side [data-testid="chat-list-search"]',
          '#side [role="textbox"]',
          '#side div[contenteditable="true"]',
          '#side input[type="text"]',
          '#side input:not([type="hidden"])',
        ];
        for (const s of sels) {
          for (const b of document.querySelectorAll(s)) {
            if (!visible(b)) continue;
            const val = b.value !== undefined ? b.value : (b.textContent || '');
            return val.trim();
          }
        }
        // DIAGNÓSTICO: nenhum casou — despeja os candidatos reais do #side
        const dump = [];
        for (const b of document.querySelectorAll('#side input, #side [role="textbox"], #side div[contenteditable="true"]')) {
          const r = b.getBoundingClientRect();
          const s = getComputedStyle(b);
          dump.push({
            tag: b.tagName, type: b.type || null,
            aria: b.getAttribute('aria-label'),
            testid: b.getAttribute('data-testid'),
            val: (b.value !== undefined ? b.value : b.textContent || '').slice(0, 30),
            rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
            vis: s.display + '/' + s.visibility, cls: (b.className || '').toString().slice(0, 40),
          });
        }
        return 'DIAG:' + JSON.stringify(dump);
      })`)
      .catch(() => null);
    if (typeof v === 'string' && v.startsWith('DIAG:')) {
      this.config.log?.warn({ dump: v.slice(5) }, 'searchFieldValue: nenhum seletor casou — dump real do #side');
      return null;
    }
    return typeof v === 'string' ? v : null;
  }

  /** Nº de caracteres de texto no campo de composição VISÍVEL (-1 = não achado). */
  private async composeBoxTextLen(page: Page, selector: string): Promise<number> {
    // Só conta elemento VISÍVEL: o WA Web mantém clones ocultos do campo no
    // DOM — o primeiro match de querySelector pode ser um clone vazio e
    // mentir o estado real (falso "campo limpo", diagnóstico ao vivo
    // 2026-09-22: envio marcado 'sent' sem a mensagem chegar ao chat).
    const len = await evalWithArg(
      page,
      `((sel) => {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (el.offsetParent === null) continue;
          return (el.textContent || '').trim().length;
        }
        return -1;
      })`,
      selector,
    ).catch(() => -1);
    return typeof len === 'number' ? len : -1;
  }

  /**
   * Limpa o campo de composição por TECLADO (Ctrl+A + Backspace — o
   * execCommand não limpa o contenteditable do WA Web) com fallbacks:
   * segundo passe de teclado e, se ainda houver texto, limpeza via DOM com
   * InputEvent. Retorna quantos chars havia (0 = já estava limpo).
   */
  private async clearComposeBox(page: Page, selector: string): Promise<number> {
    const before = await this.composeBoxTextLen(page, selector);
    if (before <= 0) return 0;
    await page.click(selector).catch(() => {});
    for (let pass = 0; pass < 2; pass++) {
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(250);
      if ((await this.composeBoxTextLen(page, selector)) <= 0) return before;
    }
    // último recurso: via DOM (com InputEvent pra UI do WA reagir) — limpa
    // TODOS os matches visíveis (o WA mantém clones ocultos do campo).
    await evalWithArg(
      page,
      `((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          if (el.offsetParent === null) return;
          el.focus();
          el.textContent = '';
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
        });
      })`,
      selector,
    ).catch(() => {});
    await page.waitForTimeout(250);
    return before;
  }

  /**
   * Sai da pasta "Archivados/Archived/Arquivados" se ela estiver aberta.
   * A sessão restaura o último estado da UI — se a pasta estiver aberta, os
   * chats da lista principal não existem no DOM e o clique falha (descoberto
   * ao vivo pelo readcheck). O ← do header NÃO tem aria-label nem data-icon
   * nesta build: detectamos o heading e clicamos o primeiro [role="button"]
   * do primeiro filho de #side (o header da view atual); se não sair, reload.
   */
  async ensureMainChatList(): Promise<void> {
    const page = this.requirePage();
    const isOpen = async () =>
      (await page.evaluate(ARCHIVED_OPEN_SCRIPT).catch(() => false)) as boolean;
    if (!(await isOpen())) return;
    const back = page.locator('#side > div:first-child [role="button"]').first();
    await back.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(600);
    if (await isOpen()) {
      // fallback: recarrega — a view default é a lista principal
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForSelector('#pane-side', { timeout: 45_000 }).catch(() => null);
      await page.waitForTimeout(1_000);
    }
  }

  /** Título do chat aberto no painel agora (null se nenhum). */
  private async currentOpenChatTitle(): Promise<string | null> {
    const page = this.requirePage();
    return (await page.evaluate(OPEN_CHAT_TITLE_SCRIPT).catch(() => null)) as string | null;
  }

  /**
   * Decreto owner (ADR-027): NÃO deixar chat aberto. Abrir marca como lida e
   * o owner perde a notificação. Após ler/responder, fechamos o painel
   * (Escape; WA Web não tem API estável de "close"). LIMITAÇÃO HONESTA: a
   * plataforma NÃO restaura o badge de não-lida após fechar — a mitigação
   * real é só abrir quando há trabalho (sweep por diff) e nunca reabrir o
   * já processado. Chip dedicado (§36 pendente do owner) remove a
   * necessidade.
   */
  /**
   * Decreto owner (2026-09-22): fechamento VERIFICÁVEL. Retorna true só se o
   * painel voltou pra lista de chats (título some). Retry: Escape → wordmark.
   */
  async closeCurrentChat(): Promise<boolean> {
    const page = this.requirePage();
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    if ((await this.currentOpenChatTitle()) === null) return true;
    // fallback: clicar no wordmark/header da lista (deseleta o painel)
    await page
      .evaluate(`(() => {
        const el = document.querySelector('#side [data-testid="wa-wordmark"]') || document.querySelector('#side header');
        if (el) el.click();
      })()`)
      .catch(() => {});
    await page.waitForTimeout(400);
    return (await this.currentOpenChatTitle()) === null;
  }

  /** Título do chat aberto agora (null = lista). Read-only, não altera estado. */
  async peekOpenChat(): Promise<string | null> {
    return this.currentOpenChatTitle();
  }

  /**
   * Abre chat pelo nome com VERIFICAÇÃO do painel — e fallback pela BUSCA.
   *
   * BUG GRAVE de roteamento (2026-09-21, owner): a lista é virtualizada; se a
   * row do chat não está no DOM, o clique falhava em silêncio e
   * readConversation lia o painel que estivesse ABERTO (outro chat!) — uma
   * pergunta do GRUPO foi atribuída à conversa da namorada e respondida lá
   * (evidência: evt_48805460). Regra nova: SÓ ler/enviar com o título do
   * painel conferido (normalização bidi); se não abrir de verdade → falha
   * explícita, nunca ação no chat errado.
   */
  private async openChat(nameOrId: string): Promise<boolean> {
    const page = this.requirePage();
    // jid/número (decreto: identificar o contato PELO NÚMERO): a busca é o
    // caminho — título do chat não casa com número, e número é único.
    // Normaliza estado: busca residual de ciclo anterior deixa a lista filtrada
    // e quebra o clique na row (bug ao vivo 2026-09-22 — evidência repair-*).
    await page
      .evaluate(`(() => {
        const box = document.querySelector('#side [data-testid="chat-list-search"]') ||
                    document.querySelector('#side input[aria-label*="Buscar" i]') ||
                    document.querySelector('#side input[aria-label*="Search" i]') ||
                    document.querySelector('#side input[aria-label*="Pesquisar" i]') ||
                    document.querySelector('#side [role="textbox"]') ||
                    document.querySelector('#side div[contenteditable="true"]');
        if (box && (box.textContent || '').trim()) {
          box.focus();
          document.execCommand('selectAll');
          document.execCommand('delete');
        }
        const x = document.querySelector('#side [data-testid="search-back"], #side button[aria-label*="cerrar" i], #side button[aria-label*="close" i]');
        if (x) x.click();
      })`)
      .catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);

    const isJid = nameOrId.includes('@');
    const searchKey = isJid ? nameOrId.split('@')[0] : nameOrId;
    const key = nameOrId.replace(/"/g, '\\"');
    await this.ensureMainChatList();

    const matches = async (): Promise<boolean> => {
      const title = await this.currentOpenChatTitle();
      if (title === null) return false;
      if (isJid) {
        // NUNCA aceitar qualquer painel aberto (risco de msg pro chat errado):
        // confere os DÍGITOS do número no header do contato (o WA formata
        // "346 850 931 92" — compara só os números). Diagnóstico ao vivo
        // 2026-09-22: openChat por jid falhava e o retry abria painel
        // aleatório que matches() dava como válido.
        const hdr = await page
          .evaluate(`(() => {
            const h = document.querySelector('[data-testid="conversation-info-header"]');
            return h ? (h.textContent || '').replace(/[^0-9]/g, '') : '';
          })`)
          .catch(() => '');
        return typeof hdr === 'string' && hdr.includes(searchKey.replace(/[^0-9]/g, ''));
      }
      // O header do WA Web (153) devolve o título SEM os emoji ("Production
      // - 2026") enquanto a row da lista tem o title completo ("🏆Production
      // - 2026🙏🏻") — comparação exata nunca casava e o openChat abortava
      // com o painel aberto DE VERDADE (bug ao vivo 2026-09-22, 4ª
      // evidência). Compara pelo núcleo alfanumérico.
      const core = (s: string): string =>
        normalizeName(s)
          .replace(/[^\p{L}\p{N} ]/gu, '')
          .replace(/\s+/g, ' ')
          .toLowerCase();
      return core(title) === core(nameOrId);
    };

    // 1) clique na row visível (caminho rápido; jid vai direto pra busca)
    if (!isJid) {
      const row = page
        .locator(
          `#pane-side [role="row"]:has([title="${key}"]), #pane-side [data-testid="cell-frame-container"]:has([title="${key}"])`,
        )
        .first();
      const clicked = await row.click({ timeout: 4_000 }).then(() => true).catch(() => false);
      if (clicked) {
        await page.waitForTimeout(700);
        if (await matches()) return true;
      }
    }

    // 2) fallback: BUSCA (funciona mesmo com a chat fora da viewport)
    // :visible é obrigatório: o #side tem clones OCULTOS de textbox e o
    // .first() pegava um clone — click silenciosamente não ia (timeout
    // engolido pelo catch) e a digitação ia pra lugar nenhum (evidência
    // repair-*.png 11:16: busca vazia com página saudável).
    const search = page
      .locator('#side [data-testid="chat-list-search-container"] input:visible, #side input[aria-label*="Buscar" i]:visible, #side [data-testid="chat-list-search"]:visible, #side [role="textbox"]:visible, #side div[contenteditable="true"]:visible')
      .first();
    if ((await search.count()) > 0) {
      // INVARIANTE: NUNCA digitar com painel aberto — se um chat abriu no
      // meio do caminho, os chars caem no campo DELE e viram rascunho no
      // chat errado (evidência ao vivo 2026-09-22: resposta do owner
      // espalhada como rascunhos '31' no Tú e 'ai' no grupo).
      const noPanel = async (): Promise<boolean> => (await this.currentOpenChatTitle()) === null;
      await search.click({ timeout: 3_000 }).catch(() => {});
      await page.keyboard.press('Control+a').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.waitForTimeout(300);
      // WA 2026: o campo de busca é um <input> CONTROLADO pelo React — teclas
      // individuais (keyboard.type) disparam re-render no meio da digitação e
      // o campo RESETA, truncando o termo (bug ao vivo 2026-09-23 22:19: "ele
      // digita meu número e tira, digita e tira"; log: obtido: null 8x seguidas).
      // insertText injeta o termo INTEIRO num único evento de input — sem
      // janela de re-render no meio. Passo a passo conferido (decreto owner):
      // campo limpo → injeta → LÊ o valor de volta → só continua se bater.
      let typed: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!(await noPanel())) {
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(400);
          await search.click({ timeout: 1_500 }).catch(() => {});
        }
        await page.keyboard.press('Control+a').catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
        await page.waitForTimeout(250);
        await page.keyboard.insertText(searchKey);
        await page.waitForTimeout(600);
        typed = await this.searchFieldValue(page);
        if (typed === searchKey) break;
        this.config.log?.debug({ tentativa: attempt + 1, obtido: typed }, 'busca não bateu após insertText — limpando e repetindo');
        // diagnóstico: dump de TODOS os candidatos — escrito em ARQUIVO (o
        // objeto no log some na serialização do pino, evidência 22:41). O
        // evaluate anterior devolveu `undefined` puro — este primeiro faz
        // probe mínimo (title/contagens) pra separar "page.evaluate quebrado
        // nessa página" de "seletor não casa".
        const probe = await page
          .evaluate(`JSON.stringify({
            title: document.title,
            sideInputs: document.querySelectorAll('#side input').length,
            allInputs: document.querySelectorAll('input').length,
            sideTextboxes: document.querySelectorAll('#side [role="textbox"]').length,
            side: !!document.querySelector('#side'),
            iifeNum: (() => 42)(),
            arrowMap: [1, 2].map((x) => x * 2).join(','),
            funcExpr: (function () { return 7; })(),
          })`)
          .catch((e) => 'EVAL_ERRO:' + String(e).slice(0, 150));
        const dump = await page
          .evaluate(`(() => {
            const out = [];
            for (const b of document.querySelectorAll('#side input, #side [role="textbox"], #side div[contenteditable="true"]')) {
              const r = b.getBoundingClientRect();
              const s = getComputedStyle(b);
              out.push({
                tag: b.tagName, type: b.type || null,
                aria: (b.getAttribute('aria-label') || '').slice(0, 24),
                testid: b.getAttribute('data-testid'),
                val: (b.value !== undefined ? b.value : b.textContent || '').slice(0, 30),
                rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
                disp: s.display, vis: s.visibility,
              });
            }
            return JSON.stringify(out, null, 1);
          })`)
          .catch((e) => 'EVAL_ERRO:' + String(e).slice(0, 150));
        try {
          mkdirSync(this.config.evidenceDir, { recursive: true });
          const dumpPath = join(this.config.evidenceDir, `openchat-busca-dump-${Date.now()}.json`);
          writeFileSync(dumpPath, JSON.stringify({ probe: String(probe), dump: String(dump) }, null, 1), 'utf8');
          this.config.log?.warn({ dumpPath }, 'openChat: leitura não bateu — dump dos candidatos em arquivo');
        } catch {
          this.config.log?.warn({}, 'openChat: leitura não bateu (falhou até gravar o dump)');
        }
        // evidência visual pro diagnóstico (print → LLM averigua onde clicar)
        const ev = await this.captureEvidence(`openchat-busca-t${attempt + 1}`).catch(() => null);
        if (ev) this.config.log?.debug({ shot: ev.screenshotPath }, 'evidência da busca truncada capturada');
      }
      if (typed !== null && typed !== searchKey) {
        this.config.log?.warn({ esperado: searchKey, obtido: typed }, 'busca truncada pelo WA — limpando pra retry');
        await page.keyboard.press('Control+a').catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
        return false;
      }
      await page.waitForTimeout(900);
      // jid: o resultado da busca por número não tem title casável — clica no
      // primeiro item da lista com retry/verificação (helper acima). Só se
      // isso falhar em tudo é que cai pro Enter de último recurso.
      if (isJid) {
        if (await this.clickJidSearchResult(page, matches)) {
          await search.click({ timeout: 1_000 }).catch(() => {});
          await page.keyboard.press('Control+a').catch(() => {});
          await page.keyboard.press('Backspace').catch(() => {});
          await page.keyboard.press('Escape').catch(() => {});
          return true;
        }
        this.config.log?.warn({}, 'openChat jid: clique no 1º resultado esgotou as tentativas — tentando Enter');
      }
      // Na view de busca o DOM muda: o resultado é role="listitem" (não "row")
      // e pode não ter data-testid="cell-frame-container" — cobre os três
      // formatos + casamento por prefixo (título com emoji varia no DOM).
      const partial = nameOrId.replace(/"/g, '\\"').slice(0, 12);
      const result = page
        .locator(
          `#pane-side [data-testid="cell-frame-container"]:has([title="${key}"]), ` +
          `#pane-side [role="row"]:has([title="${key}"]), ` +
          `#pane-side [role="listitem"] [title*="${partial}"]`,
        )
        .first();
      await result.click({ timeout: 4_000 }).catch(() => {});
      await page.waitForTimeout(1_500);
      if (!(await matches())) {
        // retry: o WA Web às vezes precisa de um segundo clique/tempo maior
        await result.click({ timeout: 3_000 }).catch(() => {});
        await page.waitForTimeout(2_000);
      }
      if (!(await matches())) {
        // último recurso: Enter abre o primeiro resultado da busca no WA Web
        await page.keyboard.press('Enter').catch(() => {});
        await page.waitForTimeout(2_000);
      }
      // limpa a busca DE VERDADE (teclado: selectAll+delete) — Escape sozinho
      // deixava o termo no campo e poluía o ciclo seguinte (bug ao vivo
      // 2026-09-22).
      await search.click({ timeout: 1_000 }).catch(() => {});
      await page.keyboard.press('Control+a').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape').catch(() => {});
      if (await matches()) return true;
    }
    return false;
  }

  /**
   * OBSERVAÇÃO PRÉVIA (decreto owner: "o agente tem que olhar a tela, entender
   * onde tá, e só então agir, narrando"). Captura o estado do painel: lista,
   * chat (com título), painel de info do contato aberto (botões Llamar/Video),
   * ou UI de chamada. Toda ação de voz começa aqui.
   */
  async observePanel(): Promise<{ state: string; title: string | null; infoPanelOpen: boolean }> {
    const page = this.requirePage();
    const raw = (await page
      .evaluate(`(() => {
        const visible = (e) => !!(e && e.offsetParent !== null && e.getClientRects().length > 0);
        const titleEl = document.querySelector('[data-testid="conversation-info-header-chat-title"]');
        const title = titleEl && visible(titleEl) ? (titleEl.textContent || '').trim() : null;
        const infoPanel = document.querySelector('[data-testid="contact_info_panel"]') ||
                          document.querySelector('div[role="complementary"]');
        const infoPanelOpen = !!(infoPanel && visible(infoPanel));
        const callUi = !!Array.from(document.querySelectorAll('button, [role="button"], [data-testid]')).find((e) => {
          if (!visible(e)) return false;
          const tid = (e.getAttribute('data-testid') || '').toLowerCase();
          const aria = (e.getAttribute('aria-label') || '').toLowerCase();
          // marcadores FORTES de chamada ATIVA (evidência call-ui-probe
          // 2026-09-22: "Nueva llamada"/"Ir a Llamadas"/aba "Llamadas" são
          // falso-positivos — não são chamada em andamento).
          if (/voip|call-control|call_screen|call-end|call_end/.test(tid)) return true;
          return /finalizar|colgar|terminar llamada|encerrar chamada|end call|silenciar|silencio|altavoz|speaker|mute|añadir participante|add people/.test(aria);
        });
        let state = 'desconhecido';
        if (callUi) state = 'chamada';
        else if (infoPanelOpen) state = 'info-contato';
        else if (title) state = 'chat';
        else state = 'lista';
        return { state, title, infoPanelOpen };
      })()`)
      .catch(() => null)) as { state: string; title: string | null; infoPanelOpen: boolean } | null;
    return raw ?? { state: 'desconhecido', title: null, infoPanelOpen: false };
  }

  private describeObservation(obs: { state: string; title: string | null; infoPanelOpen: boolean }): string {
    const onde =
      obs.state === 'chamada'
        ? 'UI de CHAMADA aberta'
        : obs.state === 'info-contato'
          ? `painel de INFO do contato ${obs.title ? `'${obs.title}'` : ''} aberto (Llamar/Video visíveis)`
          : obs.state === 'chat'
            ? `chat '${obs.title}' aberto`
            : obs.state === 'lista'
              ? 'lista de chats (nenhum painel aberto)'
              : 'estado ilegível';
    return onde;
  }

  /**
   * LIGAÇÃO CONSCIENTE (decreto owner): observa → decide → age → verifica,
   * narrando cada passo no log. NUNCA vagueia: se já está no chat do contato,
   * não sai; se o painel de info está aberto, usa o botão de lá. Nunca busca
   * por número quando o contato se resolve por nome.
   */
  async placeVoiceCall(contact: string): Promise<void> {
    const page = this.requirePage();
    const guard = this.panelGuard;
    if (!(await this.isPageHealthy())) await this.ensurePageHealthy();
    await guard?.beginCycle('placeVoiceCall');
    try {
      const say = (msg: string, extra?: object): void => {
        this.config.log?.info(extra ?? {}, `voice-call: ${msg}`);
      };
      const core = (s: string): string =>
        s
          .replace(/[^\p{L}\p{N} ]/gu, '')
          .replace(/\s+/g, ' ')
          .toLowerCase();

      let obs = await this.observePanel();
      say(`observo a tela → ${this.describeObservation(obs)}`);

      if (!(obs.title && core(obs.title) === core(contact))) {
        say(`não estou no chat de '${contact}' — navegando (openChat por nome)`);
        if (!(await this.openChat(contact))) {
          throw new Error(`não consegui abrir o chat '${contact}' — ABORTO, nada foi clicado`);
        }
        obs = await this.observePanel();
        say(`pós-navegação → ${this.describeObservation(obs)}`);
        if (!(obs.title && core(obs.title) === core(contact))) {
          throw new Error(`painel aberto não bate com '${contact}' (vi '${obs.title ?? 'sem título'}') — ABORTO`);
        }
      } else {
        say(`já estou no chat de '${contact}' — fico aqui, sem sair vagueando`);
      }

      // Botão de LIGAR: painel de info (se aberto) tem prioridade; senão o
      // header do chat. Candidatos em ordem, com log de qual foi usado.
      const candidates: Array<{ name: string; sel: string }> = obs.infoPanelOpen
        ? [
            { name: 'botão Llamar do PAINEL DE INFO', sel: '[data-testid="contact_info_panel"] [aria-label="Llamada"], [data-testid="contact_info_panel"] [aria-label="Chamada"], [data-testid="contact_info_panel"] [aria-label="Voice call"], [data-testid="contact_info_panel"] [data-testid="ic-voice-call"], [data-testid="contact_info_panel"] [title*="Llamar"]' },
            { name: 'botão do header do chat', sel: '#main header [aria-label="Llamada"], #main header [aria-label="Chamada"], #main header [aria-label="Voice call"], #main header [data-testid="ic-voice-call"], #main header [title*="Llamar"]' },
          ]
        : [
            { name: 'botão do header do chat', sel: '#main header [aria-label="Llamada"], #main header [aria-label="Chamada"], #main header [aria-label="Voice call"], #main header [data-testid="ic-voice-call"], #main header [title*="Llamar"]' },
            { name: 'botão do PAINEL DE INFO', sel: '[data-testid="contact_info_panel"] [aria-label="Llamada"], [data-testid="contact_info_panel"] [aria-label="Chamada"], [data-testid="contact_info_panel"] [aria-label="Voice call"]' },
          ];

      let clicked = false;
      for (const cand of candidates) {
        const loc = page.locator(cand.sel).first();
        const ok = await loc.click({ timeout: 3_000 }).then(() => true).catch(() => false);
        if (ok) {
          say(`clico em ${cand.name}`);
          clicked = true;
          break;
        }
        say(`${cand.name} não apareceu em 3s — tento o próximo`);
      }
      if (!clicked) throw new Error(`nenhum botão de ligar encontrado para '${contact}' — ABORTO`);

      await page.waitForTimeout(2_000);
      const after = await this.observePanel();
      say(`pós-clique → ${this.describeObservation(after)}`);
      if (after.state === 'chamada') {
        say(`UI de chamada aberta — ${contact} está sendo chamado(a)`);
        return;
      }
      // verificação best-effort: re-tenta uma vez antes de falhar
      say('UI de chamada não confirmada — uma última tentativa');
      await page.locator(candidates[0]!.sel).first().click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(2_000);
      const retry = await this.observePanel();
      say(`retry → ${this.describeObservation(retry)}`);
      if (retry.state !== 'chamada') {
        throw new Error(`cliquei em ligar mas a UI de chamada não abriu (estado: ${retry.state}) — falha explícita`);
      }
    } finally {
      // SEM closeCurrentChat aqui: a UI de chamada é o estado desejado —
      // fechar o painel mataria a ligação. Só liberamos o ciclo do guard.
      try {
        await guard?.endCycle('placeVoiceCall');
      } catch {
        /* PanelStuckError já reportou via onStuck */
      }
    }
  }

  /**
   * ENCERRA a chamada atual (decreto owner): observa, acha o botão de
   * encerrar, clica e VERIFICA que voltou pro chat normal. Narrado.
   */
  async endCall(): Promise<void> {
    const page = this.requirePage();
    const guard = this.panelGuard;
    const say = (msg: string): void => {
      this.config.log?.info({}, `voice-call: ${msg}`);
    };
    const obs = await this.observePanel();
    say(`observo a tela → ${this.describeObservation(obs)}`);
    if (obs.state !== 'chamada') {
      say('não vejo UI de chamada — nada a encerrar');
      return;
    }
    const endSel =
      '[data-testid="call-end"], button[aria-label="Finalizar"], button[aria-label="Encerrar"], ' +
      '[aria-label*="encerrar" i], [aria-label*="end call" i], [aria-label*="finalizar" i], ' +
      '[aria-label*="colgar" i], [aria-label*="terminar llamada" i], [data-testid*="end-call" i]';
    const ok = await page
      .locator(endSel)
      .first()
      .click({ timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) throw new Error('botão de encerrar não encontrado — não consegui desligar');
    say('cliquei em encerrar');
    await page.waitForTimeout(1_500);
    const after = await this.observePanel();
    say(`pós-encerrar → ${this.describeObservation(after)}`);
    if (after.state === 'chamada') throw new Error('cliquei em encerrar mas a chamada continua — falha explícita');
  }

  /**
   * jid: clica no PRIMEIRO resultado da busca por número com retry de espera
   * crescente (bug ao vivo 2026-09-22, decreto owner: "colocou o número certo
   * mas não clicou, simplesmente apagou"). O clique antigo era único e com o
   * catch silencioso: se o resultado ainda estava renderizando (ou o .first()
   * pegou um row oculto da lista normal), o fluxo caía direto na limpeza.
   * Aqui: aguarda o item ficar VISÍVEL (espera crescente 1,5s/3s/5s), clica
   * com locator fresco, e confere matches() (dígitos do número no header) —
   * painel errado NUNCA é aceito.
   */
  private async clickJidSearchResult(page: Page, matches: () => Promise<boolean>): Promise<boolean> {
    const waits = [1_500, 3_000, 5_000];
    for (let attempt = 0; attempt < waits.length; attempt++) {
      const item = page.locator('#pane-side [role="listitem"], #pane-side [role="row"]').first();
      try {
        await item.waitFor({ state: 'visible', timeout: waits[attempt]! });
        await item.click({ timeout: 3_000 });
        await page.waitForTimeout(1_200);
        if (await matches()) return true;
        this.config.log?.warn({ tentativa: attempt + 1 }, 'openChat jid: 1º resultado clicado mas o painel não bateu com o número');
      } catch (err) {
        this.config.log?.warn(
          { tentativa: attempt + 1, err: String(err).slice(0, 140) },
          'openChat jid: clique no 1º resultado falhou — retry com espera maior',
        );
      }
    }
    return false;
  }

  /** Chat aberto no momento é grupo? (best-effort — marcadores do header). */
  async currentChatIsGroup(): Promise<boolean> {
    const page = this.requirePage();
    return page
      .evaluate(`(() => {
        const header = document.querySelector('[data-testid="conversation-info-header"]');
        if (!header) return false;
        if (header.querySelector('[data-testid*="group"]')) return true;
        const text = header.textContent || '';
        return /\\bgrupo\\b|\\bgroup\\b|participantes|members/i.test(text);
      })()`)
      .then((r) => r === true)
      .catch(() => false);
  }

  /**
   * 🆕 LUPA (PLANO-SKILLS): busca dentro do chat. Abre o chat, clica a lupa do
   * cabeçalho, digita a query e conta as marcações de resultado. NÃO envia
   * nada — só localiza a mensagem (base da skill message.find e da
   * mention.respond v2 com citação). Se a UI não bater com os seletores,
   * captura evidência e falha explícita (seletor vai pro selector memory).
   */
  async searchInChat(chatId: string, query: string): Promise<ChatSearchResult> {
    const page = this.requirePage();
    const guard = this.panelGuard;
    if (!(await this.isPageHealthy())) await this.ensurePageHealthy();
    await guard?.beginCycle('searchInChat');
    try {
      if (!(await this.openChat(chatId))) {
        throw new Error(`lupa: não consegui abrir o chat '${chatId}' — busca abortada`);
      }
      // 1. Lupa do cabeçalho (#main header) — aria-label muda por idioma.
      const lupa = page.locator(SELECTORS.inChatSearchButton).first();
      if ((await lupa.count().catch(() => 0)) === 0) {
        const ev = await this.captureEvidence('lupa-botao-nao-achado');
        throw new Error(
          `lupa: botão de busca no cabeçalho não achado (seletores: ${SELECTORS.inChatSearchButton}) — evidência: ${ev.screenshotPath}`,
        );
      }
      await lupa.click();
      await page.waitForTimeout(400 + Math.floor(Math.random() * 300));
      // 2. Campo de busca que abre no topo do painel.
      const campo = page.locator(SELECTORS.inChatSearchInput).first();
      if ((await campo.count().catch(() => 0)) === 0) {
        const ev = await this.captureEvidence('lupa-campo-nao-achado');
        throw new Error(
          `lupa: campo de busca do painel não achado (seletores: ${SELECTORS.inChatSearchInput}) — evidência: ${ev.screenshotPath}`,
        );
      }
      await campo.click();
      await page.keyboard.type(query, { delay: 25 + Math.floor(Math.random() * 40) });
      // 3. WA demora a marcar os resultados no histórico.
      await page.waitForTimeout(1_200 + Math.floor(Math.random() * 600));
      const resultCount = await page
        .evaluate(`(() => {
          const marks = document.querySelectorAll(${JSON.stringify(SELECTORS.searchHighlight)});
          let visiveis = 0;
          for (const m of marks) {
            if (m.offsetParent !== null || m.getClientRects().length > 0) visiveis++;
          }
          return visiveis;
        })()`)
        .then((r) => Number(r) || 0)
        .catch(() => 0);
      // 4. Fecha a lupa (Escape) — painel volta ao chat normal.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      this.lastHeartbeatAt = new Date();
      return { found: resultCount > 0, resultCount };
    } finally {
      try {
        await this.closeCurrentChat(); // decreto: nunca deixar aberto
        await guard?.endCycle('searchInChat');
      } catch {
        /* PanelStuckError já reportou via onStuck */
      }
    }
  }

  /**
   * 🆕 CITAÇÃO (mention.respond v2, PLANO-SKILLS): responde UMA mensagem
   * específica com citação visual. Caminho: abre o chat → localiza a msg
   * (painel; se não estiver visível, lupa pula pra ela) → hover → menu de
   * contexto → "Responder" → verifica o preview de citação ANEXADO → digita
   * e envia com confirmação real. Se a citação não anexar, FALHA explícita
   * (nunca manda sem citação fingindo que foi com — o owner quer saber a
   * qual msg a resposta se refere).
   */
  async replyToMessage(chatId: string, messageQuery: string, text: string): Promise<string> {
    const page = this.requirePage();
    const guard = this.panelGuard;
    if (!(await this.isPageHealthy())) await this.ensurePageHealthy();
    await guard?.beginCycle('replyToMessage');
    try {
      if (!(await this.openChat(chatId))) {
        throw new Error(`citação: não consegui abrir o chat '${chatId}' — resposta abortada`);
      }
      const query = messageQuery.slice(0, 60);
      // 1. Localizar a mensagem: tenta o painel aberto primeiro; se não
      //    achar, usa a lupa pra pular até ela e tenta de novo.
      let achou = await this.scrollMessageIntoView(page, query);
      if (!achou) {
        this.config.log?.info({ chat: chatId, query }, 'citação: msg não visível no painel — usando a lupa');
        achou = await this.jumpViaLupa(page, query);
      }
      if (!achou) {
        const ev = await this.captureEvidence('citacao-msg-nao-achada');
        throw new Error(
          `citação: mensagem com "${query}" NÃO achada nem no painel nem na lupa — resposta NÃO enviada (sem citar ficaria órfã). Evidência: ${ev.screenshotPath}`,
        );
      }
      // 2. Hover na mensagem → icon-down-context → "Responder".
      //    Ao vivo 2026-09-23 (WA 2026, wds-design-system): o chevron de
      //    contexto é [data-testid="icon-down-context"] (div[role=button]),
      //    renderizado SÓ com hover real e às vezes demora um tick. Os testids
      //    antigos (msg-options etc.) foram REMOVIDOS nesta versão.
      //    ⚠️ :not(:has(quoted-message)): sem isso, o :has-text casa com a
      //    NOSSA PRÓPRIA resposta que cita a mensagem (o texto da citação
      //    interna conta) — evidência ao vivo citacao-menu-nao-abriu (menu
      //    abriu em cima da msg da Luna, não da pergunta do owner).
      const rowSel = `${SELECTORS.messageRow}:has-text(${JSON.stringify(query)}):not(:has([data-testid="quoted-message"]))`;
      const row = page.locator(rowSel).last();
      await row.hover();
      await page.waitForTimeout(250 + Math.floor(Math.random() * 250));
      const ctxBtn = row.locator(SELECTORS.msgContextButton).first();
      let ctxOk = false;
      for (let attempt = 0; attempt < 3 && !ctxOk; attempt++) {
        ctxOk = await ctxBtn
          .waitFor({ state: 'visible', timeout: 1_500 })
          .then(() => true)
          .catch(() => false);
        if (!ctxOk) {
          // hover "fugiu" (scroll/re-render) — re-hover e tenta de novo
          await row.hover().catch(() => {});
          await page.waitForTimeout(400);
        }
      }
      if (!ctxOk) {
        const ev = await this.captureEvidence('citacao-botao-ctx-nao-achado');
        throw new Error(`citação: botão de contexto (icon-down-context) da mensagem não ficou visível após hover (row: ${rowSel}). Evidência: ${ev.screenshotPath}`);
      }
      // Clique no chevron: EVALUATE primeiro (prova ao vivo 2x 2026-09-23),
      // imune a re-render/shift de coordenada — o force-click por coordenada
      // do daemon caiu NO ELEMENTO ERRADO quando o painel re-renderizou com
      // mensagem nova no meio da ação (menu abriu na msg das 22:14, evidência
      // citacao-menu-nao-abriu 21-35-16). Force vira fallback.
      await ctxBtn.evaluate((b) => (b as HTMLElement).click()).catch(async () => {
        await ctxBtn.click({ force: true });
      });
      await page.waitForTimeout(300 + Math.floor(Math.random() * 200));
      // 3. Confirmar que o menu abriu.
      //    ⚠️ CAUSA RAIZ 2026-09-23 (repro tmp-repro2): o waitFor É STRICT —
      //    com 11 itens role=menuitem visíveis, locator.waitFor() lançava
      //    'strict mode violation' e o .catch(() => false) engolia, mentindo
      //    'menu não abriu' com o menu ABERTO na screenshot. .first() resolve.
      //    ⚠️ container do menu NÃO tem role="menu" nesta versão — só itens.
      const menuOpened = await page
        .locator('[role="menuitem"]:visible')
        .first()
        .waitFor({ state: 'visible', timeout: 2_500 })
        .then(() => true)
        .catch(() => false);
      if (!menuOpened) {
        const ev = await this.captureEvidence('citacao-menu-nao-abriu');
        throw new Error(`citação: cliquei no chevron mas o menu de contexto não abriu (nenhum menuitem visível). Evidência: ${ev.screenshotPath}`);
      }
      // 3b. Selecionar "Responder" por TECLADO (sugestão do owner 2026-09-23):
      //     "Responder" é SEMPRE o primeiro item, em qualquer idioma. NÃO usar
      //     ArrowDown: o 1º item já abre com tabindex=0 (focado) — seta pra
      //     baixo moveria o foco pro 2º item ("Responder en privado") e Enter
      //     responderia NO PRIVADO (violação de guardrail). Foco programático
      //     no 1º item + Enter = determinístico e i18n-free. A confirmação
      //     real vem do passo 4: se o preview não anexar/referenciar a query,
      //     falha explícita (nunca órfã, nunca msg errada).
      const firstItem = page.locator('[role="menuitem"]:visible').first();
      await firstItem.evaluate((b) => (b as HTMLElement).focus());
      await page.waitForTimeout(150 + Math.floor(Math.random() * 150));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      // 4. A citação TEM que estar anexada E referenciar A MENSAGEM CERTA —
      //    senão falha (nunca envia órfã nem cita a msg errada). O check exige
      //    que o texto do preview contenha a query: pega o caso "menu abriu
      //    ancorado em outra mensagem" antes de qualquer envio.
      const preview = await page
        .evaluate(`(() => {
          const els = document.querySelectorAll(${JSON.stringify(SELECTORS.replyPreview)});
          const q = ${JSON.stringify(query.toLowerCase().slice(0, 20))}; // probe curto: o preview trunca texto longo
          for (const el of els) {
            const vis = el.offsetParent !== null || el.getClientRects().length > 0;
            if (!vis) continue;
            if (((el.textContent || '').toLowerCase()).includes(q)) return true;
          }
          return false;
        })()`)
        .then((r) => r === true)
        .catch(() => false);
      if (!preview) {
        const ev = await this.captureEvidence('citacao-preview-nao-anexado');
        throw new Error(`citação: preview não anexou OU não referencia "${query}" (seletor: ${SELECTORS.replyPreview}) — NÃO enviei pra não citar a mensagem errada. Evidência: ${ev.screenshotPath}`);
      }
      // 5. Digita e envia com confirmação real (mesmo contrato do sendMessage).
      await this.composeTypeAndSend(page, SELECTORS.inputBox, text, chatId);
      this.lastHeartbeatAt = new Date();
      return `sent:${chatId}:${Date.now()}`;
    } finally {
      try {
        await this.closeCurrentChat();
        await guard?.endCycle('replyToMessage');
      } catch {
        /* PanelStuckError já reportou via onStuck */
      }
    }
  }

  /** Rola o painel até a mensagem mais recente que casa com a query.
   *  true = achou (e o painel está posicionado nela). */
  private async scrollMessageIntoView(page: Page, query: string): Promise<boolean> {
    return page
      .evaluate(`(() => {
        const rows = document.querySelectorAll('#main ${SELECTORS.messageRow}');
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i];
          // mesma regra do replyToMessage: ignorar rows que só casam por
          // causa de uma CITAÇÃO interna (quoted-message) — queremos a msg
          // original, não a nossa resposta que a cita.
          if (r.querySelector('[data-testid="quoted-message"]')) continue;
          if ((r.textContent || '').toLowerCase().includes(${JSON.stringify(query.toLowerCase())})) {
            r.scrollIntoView({ block: 'center' });
            return true;
          }
        }
        return false;
      })()`)
      .then((r) => r === true)
      .catch(() => false);
  }

  /** Lupa: busca a query no chat e clica o 1º resultado pra pular até a
   *  mensagem. true = o painel ficou posicionado numa mensagem que casa. */
  private async jumpViaLupa(page: Page, query: string): Promise<boolean> {
    const lupa = page.locator(SELECTORS.inChatSearchButton).first();
    if ((await lupa.count().catch(() => 0)) === 0) return false;
    await lupa.click();
    await page.waitForTimeout(400);
    const campo = page.locator(SELECTORS.inChatSearchInput).first();
    if ((await campo.count().catch(() => 0)) === 0) return false;
    await campo.click();
    await page.keyboard.type(query, { delay: 25 + Math.floor(Math.random() * 40) });
    await page.waitForTimeout(1_500);
    // Clica a 1ª marcação de resultado → o painel pula pra mensagem.
    const hit = page.locator(`#main ${SELECTORS.searchHighlight}`).first();
    if ((await hit.count().catch(() => 0)) > 0) {
      await hit.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    return this.scrollMessageIntoView(page, query);
  }

  /** Evidência para auto-reparo (§14/F1.5): screenshot + DOM simplificado. */
  async captureEvidence(prefix: string): Promise<EvidencePaths> {
    const page = this.page;
    mkdirSync(this.config.evidenceDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = join(this.config.evidenceDir, `${prefix}-${stamp}.png`);
    const domPath = join(this.config.evidenceDir, `${prefix}-${stamp}.dom.txt`);
    if (page && !page.isClosed()) {
      await page.screenshot({ path: screenshotPath }).catch(() => {});
      const simplified = await page
        .evaluate(SIMPLIFIED_DOM_SCRIPT)
        .catch(() => '(dom indisponível)');
      writeFileSync(domPath, String(simplified), 'utf8');
    }
    return { screenshotPath, domPath };
  }

  async close(): Promise<void> {
    if (this.ctx) {
      await this.ctx.close().catch(() => {});
      this.ctx = null;
      this.page = null;
    }
    if (this.cdp) {
      await this.cdp.close().catch(() => {});
      this.cdp = null;
      this.page = null;
    }
    if (this.chromeProc && this.chromeProc.pid) {
      try {
        process.kill(-this.chromeProc.pid, 'SIGKILL');
      } catch {
        try {
          this.chromeProc.kill('SIGKILL');
        } catch {
          /* já morto */
        }
      }
      this.chromeProc = null;
    }
  }
}
