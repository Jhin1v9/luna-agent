import type { Logger } from 'pino';
import type { Pool } from 'pg';
import type { UnreadMessage, WhatsAppTransport } from './transport.js';
import { Debouncer } from './debounce.js';
import { createIngest } from './ingest.js';

/**
 * Watcher de ingress (modo F1.4 — registrado em ADR).
 *
 * Por que não o MutationObserver puro do §13 ainda: o observer detecta o
 * badge, mas o TEXTO da mensagem só existe de verdade dentro do painel da
 * conversa (a lista mostra preview truncado). Abrir todo chat com badge
 * marcaria como lidas conversas que não são da Luna. Então:
 *
 *   1. Coleta NÃO-invasiva de badges+previews a cada ciclo (só a lista).
 *   2. Seed: o preview de cada chat com badge vira baseline — nada antigo
 *      dispara evento (zero respostas em conversas pessoais paradas).
 *   3. Novidade = chat com badge cujo preview MUDOU → abre SÓ aquele chat,
 *      extrai as mensagens inbound recentes, debounce por chat → ingest.
 *
 * Polling leve da lista (barato, dezenas de nós) + abertura sob demanda.
 * O caminho 100% mutation-driven fica pra F1.5 com extração de preview.
 */

export interface ChatBadge {
  chat_id: string;
  chat_name: string;
  unread: number;
  preview: string;
  is_group: boolean;
}

export interface WatcherOptions {
  intervalMs?: number;
  seedOnly?: boolean;
}

/** Diff puro: quais chats têm mensagem nova desde o snapshot anterior.
 *  - preview mudou com badge → novidade (mensagem nova no chat).
 *  - chat que NÃO existia no baseline (conversa nova!) → novidade real.
 *  - preview igual / badge zerado → silêncio. */
export function diffBadges(
  prev: Map<string, string>,
  curr: ChatBadge[],
): ChatBadge[] {
  const fresh: ChatBadge[] = [];
  for (const c of curr) {
    if (c.unread <= 0) continue;
    const seen = prev.get(c.chat_id);
    if (seen === undefined || seen !== c.preview) fresh.push(c);
  }
  return fresh;
}

const BADGES_PREVIEW_SCRIPT = `(sel) => {
  const seen = new Set();
  const out = [];
  for (const item of document.querySelectorAll(sel.chatItem)) {
    const titleEl = item.querySelector('[title]');
    const name = titleEl ? titleEl.getAttribute('title') : '';
    if (!name) continue;
    const chatId = item.getAttribute('data-id') || name;
    if (seen.has(chatId)) continue;
    seen.add(chatId);
    const badge = item.querySelector(sel.unreadBadge);
    const previewEl = item.querySelector('[data-testid="cell-frame-secondary"]');
    const preview = (previewEl ? previewEl.textContent : '') || '';
    out.push({
      chat_id: chatId,
      chat_name: name,
      unread: badge ? parseInt((badge.textContent || '0').replace(/\\D/g, '')) || 1 : 0,
      preview,
      // jid de grupo termina em @g.us (privado é @s.whatsapp.net) — detecção
      // estrutural real. 'nome com :' era heurística errada: no teste vivo o
      // grupo "🏆Production - 2026" foi tratado como privado e respondeu sem
      // menção (violação §5 corrigida aqui).
      is_group: chatId.includes('@g.us') || /grupo/i.test(preview),
    });
  }
  return out;
}`;

export class IngestWatcher {
  private baseline = new Map<string, string>();
  private seeded = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly debouncer: Debouncer;
  private readonly ingest;
  private readonly intervalMs: number;

  constructor(
    private readonly deps: {
      pool: Pool;
      transport: WhatsAppTransport;
      log: Logger;
      page: { evaluate(script: string, arg?: unknown): Promise<unknown> };
      selectors: unknown;
      debounceMs: number;
    },
    opts: WatcherOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? 4_000;
    this.debouncer = new Debouncer({ flushMs: deps.debounceMs });
    this.ingest = createIngest({ pool: deps.pool, transport: deps.transport, log: deps.log });
  }

  private async collect(): Promise<ChatBadge[]> {
    const raw = (await this.deps.page
      .evaluate(`(${BADGES_PREVIEW_SCRIPT})(${JSON.stringify(this.deps.selectors)})`)
      .catch(() => [])) as ChatBadge[];
    return Array.isArray(raw) ? raw : [];
  }

  /** Um ciclo: coleta, seed/diff, extrai e ingere novidades. */
  async tick(): Promise<{ seeded: boolean; fresh: number }> {
    const badges = await this.collect();
    if (!this.seeded) {
      // Baseline de TODOS os chats (badge ou não): o que já existe nunca
      // dispara por acidente; o que nascer depois (conversa nova!) dispara.
      for (const b of badges) this.baseline.set(b.chat_id, b.preview);
      this.seeded = true;
      this.deps.log.info({ chats: badges.length, withUnread: badges.filter((b) => b.unread > 0).length }, 'watcher: baseline armado (nada antigo dispara)');
      return { seeded: true, fresh: 0 };
    }
    const fresh = diffBadges(this.baseline, badges);
    for (const b of fresh) {
      this.baseline.set(b.chat_id, b.preview);
      this.deps.log.info({ chat: b.chat_name, unread: b.unread }, 'watcher: mensagem nova detectada');
      void this.extractAndIngest(b).catch((err) =>
        this.deps.log.error({ err, chat: b.chat_name }, 'watcher: ingest falhou'),
      );
    }
    return { seeded: false, fresh: fresh.length };
  }

  /** Abre só o chat novidade, extrai mensagens inbound recentes, ingere. */
  private async extractAndIngest(badge: ChatBadge): Promise<void> {
    const messages = await this.deps.transport.readConversation(badge.chat_id, 10);
    const inbound = messages.filter((m) => m.direction === 'inbound' && m.text);
    if (inbound.length === 0) {
      this.deps.log.info({ chat: badge.chat_name }, 'watcher: sem texto inbound (mídia?) — ignorado');
      return;
    }
    const last = inbound[inbound.length - 1]!;
    const msg: UnreadMessage = {
      chat_id: badge.chat_id,
      chat_name: badge.chat_name,
      is_group: badge.is_group,
      text: inbound
        .slice(-3)
        .map((m) => m.text)
        .join(' '),
      external_id: `wa:${badge.chat_id}:${Buffer.from(last.text).toString('base64').slice(0, 24)}`,
      mentioned_luna: /@luna\b/i.test(last.text),
      quoted_from_luna: false,
      received_at: new Date().toISOString(),
    };
    this.debouncer.push(badge.chat_id, msg.text, (combined) => {
      void this.ingest.ingestOne({ ...msg, text: combined }).catch((err) =>
        this.deps.log.error({ err }, 'watcher: ingest falhou'),
      );
    });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.deps.log.error({ err }, 'watcher: tick falhou'));
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.debouncer.clear();
  }
}
