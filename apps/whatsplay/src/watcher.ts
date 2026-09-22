import type { Logger } from 'pino';
import type { Pool } from 'pg';
import type { UnreadMessage, WhatsAppTransport } from './transport.js';
import { Debouncer } from './debounce.js';
import { createIngest } from './ingest.js';
import { matchesAllowlist, parseAllowlist } from './allowlist.js';
import { extractMention } from './rules.js';

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

export interface WatcherDeps {
  pool: Pool;
  transport: WhatsAppTransport;
  log: Logger;
  page: { evaluate(script: string, arg?: unknown): Promise<unknown> };
  selectors: unknown;
  debounceMs: number;
  /**
   * ESCOPO DE INGESTÃO (decreto do owner, ADR-020): fora de produção, o
   * watcher SÓ processa conversas nesta lista — mensagem de fora do escopo
   * é ignorada SEM abrir o chat (não marca como lida), SEM Context Builder
   * e SEM chamar LLM (zero tokens). Lista vazia com enforce = nada
   * processado (fail-closed).
   */
  ingestAllowlist?: string[];
  enforceIngestAllowlist?: boolean;
  /** Injetável para testes (default: createIngest real). */
  ingestFn?: (msg: UnreadMessage) => Promise<'published' | 'skipped'>;
}

export class IngestWatcher {
  private baseline = new Map<string, string>();
  private seeded = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly debouncer: Debouncer;
  private readonly ingest: (msg: UnreadMessage) => Promise<'published' | 'skipped'>;
  private readonly intervalMs: number;
  private readonly ingestAllowlist: string[];
  private readonly enforceIngest: boolean;
  private sweepCount = 0;
  /** Roda o sweep a cada N ticks (4s × 3 = 12s — decreto owner: latência). */
  private readonly sweepEvery = 3;
  private lastSeenMsg = new Map<string, string>();

  constructor(
    private readonly deps: WatcherDeps,
    opts: WatcherOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? 4_000;
    this.debouncer = new Debouncer({ flushMs: deps.debounceMs });
    this.ingest = deps.ingestFn ?? createIngest({ pool: deps.pool, transport: deps.transport, log: deps.log }).ingestOne;
    this.ingestAllowlist = parseAllowlist(deps.ingestAllowlist?.join(','));
    this.enforceIngest = deps.enforceIngestAllowlist ?? false;
  }

  private async collect(): Promise<ChatBadge[]> {
    const raw = (await this.deps.page
      .evaluate(`(${BADGES_PREVIEW_SCRIPT})(${JSON.stringify(this.deps.selectors)})`)
      .catch(() => [])) as ChatBadge[];
    return Array.isArray(raw) ? raw : [];
  }

  /** Um ciclo: coleta, seed/diff, extrai e ingere novidades. */
  private ticking = false;

  /** Um ciclo: coleta, seed/diff, extrai e ingere novidades.
   *  REENTRÂNCIA: um tick em andamento faz o próximo esperar — work de painel
   *  (open/ler/fechar) demora mais que o intervalo em chats ativos, e ticks
   *  concorrentes se pisavam (peek via painel do outro → falso 'fora de
   *  ciclo' + race de leitura; bug ao vivo 2026-09-22). */
  async tick(): Promise<{ seeded: boolean; fresh: number }> {
    if (this.ticking) return { seeded: false, fresh: 0 };
    this.ticking = true;
    try {
      return await this.tickInner();
    } finally {
      this.ticking = false;
    }
  }

  private async tickInner(): Promise<{ seeded: boolean; fresh: number }> {
    const badges = await this.collect();
    if (!this.seeded) {
      // Baseline de TODOS os chats (badge ou não): o que já existe nunca
      // dispara por acidente; o que nascer depois (conversa nova!) dispara.
      for (const b of badges) this.baseline.set(b.chat_id, b.preview);
      this.seeded = true;
      this.deps.log.info({ chats: badges.length, withUnread: badges.filter((b) => b.unread > 0).length }, 'watcher: baseline armado (nada antigo dispara)');
      return { seeded: true, fresh: 0 };
    }
    this.sweepCount++;
    if (this.enforceIngest && this.ingestAllowlist.length > 0 && this.sweepCount % this.sweepEvery === 0) {
      // Sweep periódico dos chats allowlisted: cobre mensagem JÁ LIDA,
      // chat virtualizado fora do DOM e (fora de produção) o gatilho de
      // teste do owner — mensagem dele é OUTBOUND na sessão com @luna.
      await this.sweepAllowlisted().catch((err) => this.deps.log.error({ err }, 'watcher: sweep falhou'));
    }
    const fresh = diffBadges(this.baseline, badges);
    for (const b of fresh) {
      this.baseline.set(b.chat_id, b.preview);
      // ESCOPO DE INGESTÃO: fora da lista → ignora SEM abrir o chat (não
      // marca como lida), SEM Context Builder, SEM LLM — zero tokens.
      if (this.enforceIngest && !matchesAllowlist(this.ingestAllowlist, b.chat_name) && !matchesAllowlist(this.ingestAllowlist, b.chat_id)) {
        this.deps.log.debug({ chat: b.chat_name }, 'watcher: fora do escopo de ingestão — ignorado (zero tokens)');
        continue;
      }
      if (this.enforceIngest) {
        // chats allowlisted são responsabilidade do sweep — evita corrida
        // badge-path × sweep-path (dupla resposta no mesmo chat).
        this.deps.log.debug({ chat: b.chat_name }, 'watcher: chat no escopo (sweep processa) — badge-path ignora');
        continue;
      }
      this.deps.log.info({ chat: b.chat_name, unread: b.unread }, 'watcher: mensagem nova detectada');
      void this.extractAndIngest(b).catch((err) =>
        this.deps.log.error({ err, chat: b.chat_name }, 'watcher: ingest falhou'),
      );
    }
    return { seeded: false, fresh: fresh.length };
  }

  /**
   * Sweep dos chats allowlisted: abre cada um (título visível ou busca),
   * lê as últimas mensagens e dispara ingest quando a última mensagem MUDA.
   * - inbound → mensagem de cliente (normal);
   * - outbound + @luna → gatilho de TESTE do owner: na sessão do WhatsApp
   *   Web, a mensagem DELE é outbound — fora de produção ela dispara a Luna
   *   (descoberto ao vivo: owner testava com mensagens próprias e nada
   *   acontecia). Outras mensagens outbound (respostas da própria Luna) são
   *   ignoradas.
   */
  private async sweepAllowlisted(): Promise<void> {
    for (const entry of this.ingestAllowlist) {
      // jid (decreto: número do owner, ex. 34685093192@s.whatsapp.net):
      // o browser busca pelo número — sweep suporta; nome segue igual.
      try {
        const msgs = (await this.deps.transport.readConversation(entry, 3)).filter((m) => m.text);
        const last = msgs[msgs.length - 1];
        if (!last) continue;
        const key = `${last.direction}:${last.text}`;
        const prev = this.lastSeenMsg.get(entry);
        this.lastSeenMsg.set(entry, key);
        const isSelfTest = last.direction === 'outbound' && extractMention(last.text);
        if (last.direction === 'outbound' && !isSelfTest) continue; // resposta da própria Luna
        if (prev === key) continue; // mesma mensagem da última varredura
        // Primeira vista (prev undefined): dispara SE acionável (inbound ou
        // self-test do owner); dedupe fino de repetição fica no unique
        // (channel, external_id) de messages.
        const text = last.text.replace(/@luna/gi, '').trim() || last.text;
        const msg: UnreadMessage = {
          chat_id: entry,
          chat_name: entry,
          is_group: (await this.deps.transport.currentChatIsGroup?.().catch(() => false)) ?? false,
          // transcrição com AUTOR (quem falou o quê) — prompt rico pra Luna
          text:
            msgs
              .slice(-3)
              .map((m) => `${(m as { author?: string | null }).author ?? m.sender ?? 'contato'}: ${m.text}`)
              .join('\n') || text,
          // §7.6: discriminador estável POR MENSAGEM (data-id do WA) — com
          // hash de texto, mensagem nova com texto igual a uma antiga virava
          // "duplicada" e o cliente era ignorado (bug ao vivo 2026-09-22:
          // owner reenviou "@luna teste" e nunca virou evento).
          external_id: `wa:${entry}:${last.mid || Buffer.from(last.text).toString('base64').slice(0, 24)}`,
          mentioned_luna: extractMention(last.text),
          quoted_from_luna: false,
          author_name: (last as { author?: string | null }).author ?? null,
          received_at: new Date().toISOString(),
        };
        this.deps.log.info({ chat: entry, self_test: isSelfTest }, 'watcher(sweep): mensagem nova');
        this.debouncer.push(`sweep:${entry}`, msg.text, (combined) => {
          void this.ingest({ ...msg, text: combined }).catch((err) =>
            this.deps.log.error({ err }, 'watcher: ingest falhou'),
          );
        });
      } catch {
        // chat não abriu agora (virtualizado?), tenta no próximo ciclo
      }
    }
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
      external_id: `wa:${badge.chat_id}:${last.mid || Buffer.from(last.text).toString('base64').slice(0, 24)}`,
      mentioned_luna: extractMention(last.text),
      quoted_from_luna: false,
      author_name: (last as { author?: string | null }).author ?? badge.chat_name,
      received_at: new Date().toISOString(),
    };
    this.debouncer.push(badge.chat_id, msg.text, (combined) => {
      void this.ingest({ ...msg, text: combined }).catch((err) =>
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
