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

  /** Valor VISÍVEL atual do campo de busca (null = não achado). */
  private async searchFieldValue(page: Page): Promise<string | null> {
    const v = await page
      .evaluate(`(() => {
        const boxes = document.querySelectorAll('#side [data-testid="chat-list-search"], #side [role="textbox"], #side div[contenteditable="true"]');
        for (const b of boxes) {
          if (b.offsetParent === null) continue;
          return (b.textContent || '').trim();
        }
        return null;
      })`)
      .catch(() => null);
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
      if (isJid) return true; // busca por número é unicamente identificável
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
    const search = page
      .locator('#side [data-testid="chat-list-search"], #side [role="textbox"], #side div[contenteditable="true"]')
      .first();
    if ((await search.count()) > 0) {
      await search.click({ timeout: 3_000 }).catch(() => {});
      // Limpa termo residual ANTES de digitar — por TECLADO (execCommand no
      // contenteditable do WA Web não limpa de verdade; bug ao vivo
      // 2026-09-22, 3ª evidência repair-*.png — termo residual poluía a busca).
      await page.keyboard.press('Control+a').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.waitForTimeout(300);
      // Digitação em blocos com re-foco (evidência ao vivo, repair-*.png
      // 09:52): o WA Web RE-RENDERIZA o contenteditable no meio da digitação
      // e o restante dos chars cai fora — "346850931" na busca e "92" virou
      // rascunho no chat do Tú. Blocos de 3 com re-click + conferência do
      // termo completo; se truncou, limpa e falha cedo (o retry recomeça
      // do zero em vez de clicar em resultado errado).
      for (let i = 0; i < searchKey.length; i += 3) {
        await search.click({ timeout: 1_000 }).catch(() => {});
        await page.keyboard.type(searchKey.slice(i, i + 3), { delay: 70 });
        await page.waitForTimeout(120);
      }
      const typed = await this.searchFieldValue(page);
      if (typed !== null && typed !== searchKey) {
        this.config.log?.warn({ esperado: searchKey, obtido: typed }, 'busca truncada pelo WA — limpando pra retry');
        await page.keyboard.press('Control+a').catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
        return false;
      }
      await page.waitForTimeout(900);
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
