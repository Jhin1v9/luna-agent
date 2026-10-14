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
  /**
   * Sweep periódico das conversas allowlisted (decreto owner 2026-09-24):
   * DESLIGADO por padrão. O sweep ABRE cada chat da lista a cada ~12s pra
   * reler mensagens — sem cérebro, sozinho, pra sempre (visível ao owner
   * como "escreve PAI/número no busca, entra e sai de chats em loop").
   * Quem orquestra é a Luna: ingest segue 100% por badge/DOM-mutação
   * (reativo a mensagem NOVA). Liga só sob demanda (teste do owner):
   * WHATSAPP_SWEEP_ENABLED=true.
   */
  sweepEnabled?: boolean;
  /**
   * Reconciler de não-lidas (decreto owner 03/10/2026 "a cada not, responde
   * SEMPRE"): a cada reconcileMs, relê a LISTA de chats (só leitura de nós —
   * zero abertura) e ingere TODA conversa allowlisted com badge de não-lida,
   * inclusive as que o tick por diff de preview perdeu (badge visível no DOM
   * mas não detectado — incidente 03/10: msgs do Enoque 15:49 e do Eduardo
   * 16:17 ficaram 20–50 min sem resposta). Abrir o chat marca como lida — é o
   * comportamento desejado (a Luna lê e responde). Duplicatas caem na
   * idempotency de messages (§7.6). Default: 60s. 0 = desligado.
   */
  reconcileMs?: number;
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
  private readonly debouncer: Debouncer<UnreadMessage>;
  private readonly ingest: (msg: UnreadMessage) => Promise<'published' | 'skipped'>;
  private readonly intervalMs: number;
  private readonly ingestAllowlist: string[];
  private readonly enforceIngest: boolean;
  private sweepCount = 0;
  /** Roda o sweep a cada N ticks (4s × 3 = 12s — decreto owner: latência). */
  private readonly sweepEvery = 3;
  private readonly sweepEnabled: boolean;
  private readonly reconcileMs: number;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private reconciling = false;
  /** Último preview reconciliado por chat (chave barata: evita reabrir chat
   *  sem novidade a cada ciclo). */
  private lastReconciled = new Map<string, string>();
  /** Saúde do loop de ticks: watchdog avisa se parar (evaluate travado). */
  private lastTickDoneAt = Date.now();
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastSeenMsg = new Map<string, string>();

  constructor(
    private readonly deps: WatcherDeps,
    opts: WatcherOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? 4_000;
    this.sweepEnabled = opts.sweepEnabled ?? false;
    this.reconcileMs = opts.reconcileMs ?? 60_000;
    this.debouncer = new Debouncer({ flushMs: deps.debounceMs });
    this.ingest = deps.ingestFn ?? createIngest({ pool: deps.pool, transport: deps.transport, log: deps.log }).ingestOne;
    this.ingestAllowlist = parseAllowlist(deps.ingestAllowlist?.join(','));
    this.enforceIngest = deps.enforceIngestAllowlist ?? false;
    // 2026-10-14 diagnostico: gate do sweep explicito no boot
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
      this.lastTickDoneAt = Date.now();
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
      // FIX 1 (decreto owner 03/10 "responde sempre"): não-lidas PRE-EXISTENTES
      // em chats da allowlist NÃO ficam para trás — a Jess 09:03 HVR caiu nesse
      // buraco (máquina off de noite + baseline ignorando). Agora o boot já
      // reconcilia: cada badge allowlisted vira ingest e a Geral responde.
      if (this.reconcileMs > 0) {
        void this.reconcileUnread('boot').catch((err) =>
          this.deps.log.error({ err }, 'watcher: reconcile do boot falhou'),
        );
      }
      return { seeded: true, fresh: 0 };
    }
    this.sweepCount++;
    if (this.sweepEnabled && this.enforceIngest && this.ingestAllowlist.length > 0 && this.sweepCount % this.sweepEvery === 0) {
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
      if (this.enforceIngest && this.sweepEnabled) {
        // Com sweep ligado, chats allowlisted são responsabilidade dele —
        // evita corrida badge-path × sweep-path (dupla resposta no chat).
        // Com sweep DESLIGADO (padrão, decreto owner 2026-09-24), o badge-path
        // É o caminho de ingestão desses chats — sem esse ramo, desligar o
        // sweep calava a ingestão de TODA a allowlist (bug ao vivo 24/09:
        // owner marcou a Luna no grupo e nada foi respondido).
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
        await this.sweepOne(entry);
      } catch (err) {
        // 2026-10-14: era silencioso — inbound morria aqui sem rastro.
        this.deps.log.warn({ entry, err: String(err).slice(0, 200) }, 'watcher(sweep): leitura falhou — retry em 8s');
        // Sweep adaptativo (decreto owner "badge é frágil"): em vez de esperar
        // o ciclo inteiro (60s), espera a página sair do reload e tenta 1x mais.
        await new Promise((r) => setTimeout(r, 8000));
        await this.sweepOne(entry).catch((err2) =>
          this.deps.log.warn({ entry, err: String(err2).slice(0, 200) }, 'watcher(sweep): retry falhou — próximo ciclo'),
        );
      }
    }
  }

  /** Lê um chat allowlisted e dispara ingest quando a última mensagem MUDA. */
  private async sweepOne(entry: string): Promise<void> {
    {
      const msgs = (await this.deps.transport.readConversation(entry, 3)).filter((m) => m.text);
        // 2026-10-14 (bug ao vivo): olhar SO a ultima mensagem do painel
        // engolia pedido respondido — quando a Luna responde, o painel termina
        // com outbound DELA e o sweep pulava o cliente pra sempre (mensagem do
        // Abner ficou horas sem resposta por causa do 'pronto Abner' outbound
        // por cima). Agora: candidata = ultima mensagem DEPOIS da ultima
        // resposta da Luna (outbound sem mencao).
        // 2026-10-14 (loop de eco no grupo): msg PRÓPRIA pode chegar sem
        // tail-out (corrida pós-envio) e o fallback do read marca 'inbound'.
        // Autor 'Tú'/'Você' é inequívoco — trata como outbound aqui também.
        const SELF_AUTHOR = /^(tú|você|voce|you|tu)$/i;
        const isSelfMsg = (m: { direction: string; author?: string | null }) =>
          m.direction === 'outbound' || (m.author != null && SELF_AUTHOR.test(m.author));
        let lastOutIdx = -1;
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (isSelfMsg(msgs[i]!) && !extractMention(msgs[i]!.text)) { lastOutIdx = i; break; }
        }
        const pendente = msgs.slice(lastOutIdx + 1);
        const last = pendente[pendente.length - 1];
        if (!last) return;
        const key = `${last.direction}:${last.text}`;
        const prev = this.lastSeenMsg.get(entry);
        this.lastSeenMsg.set(entry, key);
        const isSelfTest = last.direction === 'outbound' && extractMention(last.text);
        if (isSelfMsg(last) && !isSelfTest) return; // resposta da própria Luna
        if (prev === key) return; // mesma mensagem da última varredura
        // Primeira vista (prev undefined): dispara SE acionável (inbound ou
        // self-test do owner); dedupe fino de repetição fica no unique
        // (channel, external_id) de messages.
        const text = last.text.replace(/@luna/gi, '').trim() || last.text;
        const msg: UnreadMessage = {
          chat_id: entry,
          chat_name: entry,
          // 2026-10-14 (bug ao vivo): currentChatIsGroup lia o header com o
          // painel JÁ fechado pelo readConversation (finally closeCurrentChat)
          // → false SEMPRE; além disso o testid antigo morreu no DOM novo.
          // Detecção estrutural pelo que acabou de ser lido: em GRUPO todo
          // membro vem com label de autor (elemento [data-testid="author"]);
          // no privado inbound não tem author e outbound sai como 'Tú' (sem
          // elemento). Falso negativo só se as últimas 3 fossem 100% da Luna.
          is_group: msgs.some(
            (m) => m.author != null && m.author !== 'Tú' && m.author !== 'Você' && m.author !== 'You',
          ),
          // transcrição com AUTOR (quem falou o quê) — prompt rico pra Luna
          text:
            msgs
              .slice(-3)
              .map((m) => `${(m as { author?: string | null }).author ?? m.sender ?? 'contato'}: ${m.text}`)
              .join('\n') || text,
          // §7.6: discriminador estável POR MENSAGEM. O data-id do WA não
          // existe nesta build (msg-container sem atributo), então usa
          // base64 COMPLETO de autor+texto — o slice(0,24) antigo colidia
          // para textos-prefixo ("@luna teste diga 1" vs "...diga 123" =
          // mesmo hash, mensagem engolida como "duplicada"; ao vivo
          // 2026-09-22) e o hash de texto puro engolia reenvio idêntico.
          // (2026-10-14) sem o prefixo do entry: 'Abner' e
          // '34685093192@s.whatsapp.net' abrem o MESMO chat — com entry no id,
          // a mesma msg ingeria 2x (resposta duplicada).
          external_id: `wa:${Buffer.from(`${(last as { author?: string | null }).author ?? ''}|${last.text}`).toString('base64')}`,
          mentioned_luna: extractMention(last.text),
          quoted_from_luna: false,
          quoted_text: (last as { quoted?: string | null }).quoted ?? null,
          quoted_author: (last as { quotedAuthor?: string | null }).quotedAuthor ?? null,
          author_name: (last as { author?: string | null }).author ?? null,
          received_at: new Date().toISOString(),
        };
        this.deps.log.info({ chat: entry, self_test: isSelfTest }, 'watcher(sweep): mensagem nova');
        this.debouncer.push(
          `sweep:${entry}`,
          { text: msg.text, ctx: msg },
          (combined, m) => {
            void this.ingest({ ...m, text: combined }).catch((err) =>
              this.deps.log.error({ err }, 'watcher: ingest falhou'),
            );
          },
        );
    }
  }

  /**
   * Reconciler de não-lidas (decreto owner 03/10): relê a lista (sem abrir
   * nada) e ingere cada chat allowlisted com badge. Rede de segurança do
   * caminho por diff de preview — quando o DOM/sessão falha em propagar a
   * mudança de preview, o badge continua visível e é pego aqui.
   * Chave barata = preview do badge: mudou (ou nunca reconciliado) → abre,
   * extrai e ingere. Idempotency de messages (§7.6) cobre a corrida com o
   * caminho do tick.
   */
  async reconcileUnread(origem: 'timer' | 'boot' = 'timer'): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const badges = await this.collect();
      for (const b of badges) {
        try {
          if (b.unread <= 0) continue;
          if (
            this.enforceIngest &&
            !matchesAllowlist(this.ingestAllowlist, b.chat_name) &&
            !matchesAllowlist(this.ingestAllowlist, b.chat_id)
          ) {
            continue; // fora da allowlist: não abre, não marca lida (§5)
          }
          if (this.enforceIngest && this.sweepEnabled) {
            // Com sweep ligado, allowlisted é responsabilidade dele — o mesmo
            // "sem corrida" do badge-path (dupla resposta no chat). Sweep abre
            // o chat periodicamente e zera o badge, então o reconcile tem
            // pouco a cobrir aqui de qualquer forma.
            continue;
          }
          if (this.lastReconciled.get(b.chat_id) === b.preview) continue; // sem novidade
          const outcome = await this.extractAndIngest(b);
          if (outcome === 'ingested') this.lastReconciled.set(b.chat_id, b.preview);
          // 'empty' (só mídia/sem texto) NÃO marca: tenta de novo no próximo
          // ciclo — barulho de log aceito, engolir mensagem não é.
        } catch {
          // falhou antes de ingerir: não marca — tenta no próximo ciclo
        }
      }
    } finally {
      this.reconciling = false;
    }
  }

  /** Abre só o chat novidade, extrai mensagens inbound recentes, ingere.
   *  Retorna 'ingested' (achou texto) ou 'empty' (só mídia/sem texto). */
  private async extractAndIngest(badge: ChatBadge): Promise<'ingested' | 'empty'> {
    // 2026-10-14 (decreto owner, bug ao vivo 19:48): JID de grupo na busca do WA
    // não acha NADA ("No se encontró") — grupo se abre pelo TÍTULO visível na
    // lista (o badge scan já captura os dois em page-scripts.ts). chat_name é o
    // alvo; o JID fica só de fallback (nunca deve acontecer: scan sempre tem nome).
    const openTarget = badge.chat_name?.trim() || badge.chat_id;
    const messages = await this.deps.transport.readConversation(openTarget, 10);
    let inbound = messages.filter((m) => m.direction === 'inbound' && m.text);
    // ECO-FILTER (incidente 2026-10-09 — "Vênus respondendo a msm coisa toda
    // hora"): mensagens NOSSAS (Luna/Vênus) às vezes são capturadas como
    // inbound (fallback de direção do WA Web) e viram evento — o Vênus
    // respondia às próprias respostas em loop. Aqui comparamos com os corpos
    // outbound recentes desta conversa e descartamos o que for eco.
    try {
      const conv = await this.deps.pool.query(
        `SELECT body FROM messages
         WHERE metadata->>'chat_id' = $1 AND direction='outbound'
         GROUP BY body
         ORDER BY MAX(created_at) DESC
         LIMIT 8`,
        [badge.chat_id],
      );
      const norm = (s: string) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
      const outboundBodies = conv.rows.map((r) => norm(r.body));
      const antes = inbound.length;
      inbound = inbound.filter((m) => {
        const t = norm(m.text);
        return !outboundBodies.some((o) => o === t || (t.length > 40 && o.includes(t.slice(0, Math.min(80, t.length)))));
      });
      if (antes > inbound.length) {
        this.deps.log.info({ chat: badge.chat_name, ecados: antes - inbound.length }, 'watcher: eco(s) de mensagem nossa descartado(s) do inbound');
      }
    } catch { /* filtro é best-effort — nunca derruba o ingest */ }
    if (inbound.length === 0) {
      this.deps.log.info({ chat: badge.chat_name }, 'watcher: sem texto inbound (mídia ou só eco) — ignorado');
      return 'empty';
    }
    const last = inbound[inbound.length - 1]!;
    // AUTOR POR MENSAGEM (incidente 2026-10-09 — "confundindo eu com Enoque"):
    // juntar os textos com espaço misturava quem falou o quê; igual ao sweep,
    // cada fala sai prefixada com o autor.
    const msg: UnreadMessage = {
      chat_id: badge.chat_id,
      chat_name: badge.chat_name,
      is_group: badge.is_group || inbound.some(
        (m) => (m as { author?: string | null }).author != null &&
          !/^(tú|você|voce|you|tu)$/i.test(String((m as { author?: string | null }).author)),
      ),
      text: inbound
        .slice(-3)
        .map((m) => `${(m as { author?: string | null }).author ?? m.sender ?? 'contato'}: ${m.text}`)
        .join(' '),
      external_id: `wa:${badge.chat_id}:${Buffer.from(`${(last as { author?: string | null }).author ?? ''}|${last.text}`).toString('base64')}`,
      mentioned_luna: extractMention(last.text),
      quoted_from_luna: false,
      quoted_text: (last as { quoted?: string | null }).quoted ?? null,
      quoted_author: (last as { quotedAuthor?: string | null }).quotedAuthor ?? null,
      author_name: (last as { author?: string | null }).author ?? badge.chat_name,
      received_at: new Date().toISOString(),
    };
    this.debouncer.push(
      badge.chat_id,
      { text: msg.text, ctx: msg },
      (combined, m) => {
        void this.ingest({ ...m, text: combined }).catch((err) =>
          this.deps.log.error({ err }, 'watcher: ingest falhou'),
        );
      },
    );
    return 'ingested';
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.deps.log.error({ err }, 'watcher: tick falhou'));
    }, this.intervalMs);
    this.timer.unref();
    if (this.reconcileMs > 0) {
      this.reconcileTimer = setInterval(() => {
        this.reconcileUnread('timer').catch((err) => this.deps.log.error({ err }, 'watcher: reconcile falhou'));
      }, this.reconcileMs);
      this.reconcileTimer.unref();
    }
    // Watchdog do loop de ticks: se nenhum tick completa há 5 min, o evaluate
    // da página provavelmente travou (incidente 03/10: ~2h40 cego). Loga em
    // ERROR (visível no sweep) e destrava a trava de reentrância — o próximo
    // tick tenta de novo; o reconcile segue em timer independente.
    this.watchdogTimer = setInterval(() => {
      const staleMs = Date.now() - this.lastTickDoneAt;
      if (staleMs > 5 * 60_000) {
        this.deps.log.error({ stale_min: Math.round(staleMs / 60_000) }, 'watcher: ticks parados há minutos — evaluate da página possivelmente travado');
        if (this.ticking) {
          this.deps.log.error({}, 'watcher: destravando flag de tick (tick anterior possivelmente pendurado)');
          this.ticking = false;
        }
        this.lastTickDoneAt = Date.now();
      }
    }, 60_000);
    this.watchdogTimer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.debouncer.clear();
  }
}
