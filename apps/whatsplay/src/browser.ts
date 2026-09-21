import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { SELECTORS } from './selectors.js';
import {
  STATE_PROBES_SCRIPT,
  COLLECT_UNREAD_CHATS_SCRIPT,
  READ_PANEL_MESSAGES_SCRIPT,
  READ_CONVERSATION_SCRIPT,
  MUTATION_OBSERVER_SCRIPT,
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
  private ctx: BrowserContext | null = null;
  private page: Page | null = null;
  private lastHeartbeatAt = new Date();
  private lastSeenMessageKey = new Map<string, string>();

  constructor(private readonly config: BrowserConfig) {}

  async launch(): Promise<void> {
    mkdirSync(this.config.userDataDir, { recursive: true });
    this.ctx = await chromium.launchPersistentContext(this.config.userDataDir, {
      executablePath: this.config.chromePath,
      headless: this.config.headless,
      viewport: { width: 1280, height: 800 },
      args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
    });
    this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
    await this.page.goto(WA_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
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

        const isGroup = chat.chat_name.includes(':') || chat.chat_name.toUpperCase().includes('GRUPO');

        unread.push({
          chat_id: chat.chat_id,
          chat_name: chat.chat_name,
          is_group: isGroup,
          text: last.text,
          external_id: `wa:${chat.chat_id}:${Buffer.from(last.text).toString('base64').slice(0, 24)}`,
          quoted_text: last.quoted,
          quoted_from_luna: false,
          mentioned_luna: /@luna\b/i.test(last.text),
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
    await this.openChat(chatId);
    const messages = (await evalWithArg(page, READ_CONVERSATION_SCRIPT, {
      sel: SELECTORS,
      lim: limit,
    })) as ConversationMessage[];
    return messages.filter((m) => m.text);
  }

  async sendMessage(chatId: string, text: string): Promise<string> {
    const page = this.requirePage();
    await this.openChat(chatId);
    await page.click(SELECTORS.inputBox);
    // Delay humano mínimo contra padrão robótico (risco de ban — ADR-004).
    await page.waitForTimeout(300 + Math.floor(Math.random() * 500));
    await page.keyboard.type(text, { delay: 15 + Math.floor(Math.random() * 30) });
    await page.keyboard.press('Enter');
    this.lastHeartbeatAt = new Date();
    return `sent:${chatId}:${Date.now()}`;
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

  /** Abre chat pelo nome (v0). F1.5: busca por jid/telefone com fallback visual. */
  private async openChat(nameOrId: string): Promise<boolean> {
    const page = this.requirePage();
    const key = nameOrId.replace(/"/g, '\\"');
    await this.ensureMainChatList();
    // Clique NATIVO do Playwright — el.click() sintético não abre o painel no
    // WA Web (descoberto ao vivo pelo readcheck, painel ficava mainPresent=false).
    // Atenção ao seletor com vírgula: `A, B:has(x)` aplica :has só em B —
    // prefixar A com #pane-side resolve (bug achado ao vivo: clicava o 1º chat).
    const row = page
      .locator(
        `#pane-side [role="row"]:has([title="${key}"]), #pane-side [data-testid="cell-frame-container"]:has([title="${key}"])`,
      )
      .first();
    try {
      await row.click({ timeout: 5_000 });
    } catch {
      return false;
    }
    await page.waitForSelector(SELECTORS.messagePanel, { timeout: 5_000 }).catch(() => null);
    return true;
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
  }
}
