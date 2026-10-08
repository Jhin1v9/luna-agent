/**
 * Debounce por chat (§19): "oi" "eu queria" "saber se" "o site" "já ficou
 * pronto" (5 msgs em 6s) viram UMA pergunta antes de responder.
 * Mensagens do mesmo chat dentro da janela de silêncio se acumulam e o flush
 * entrega o texto concatenado em ordem.
 *
 * FIX 2026-10-08 (bug ao vivo no Production): o buffer agrega partes de
 * MENSAGENS DIFERENTES (external_id distintos) sob a mesma chave de chat e o
 * flush usava o closure da ÚLTIMA push — external_id de uma mensagem foi
 * gravado com o texto de outra e a mensagem do owner sumiu do pipeline
 * (chave queimada em messages → "duplicada — ignorada" pra sempre).
 * Agora cada parte carrega seu ctx (external_id) e o flush dispara POR
 * GRUPO de ctx: mensagens diferentes nunca mais cruzam conteúdo/chave.
 */

export interface DebouncePart<TCtx = unknown> {
  text: string;
  /** Identidade da mensagem lógica (ex.: external_id). Partes com ctx
   *  diferente NUNCA são combinadas no mesmo flush. */
  ctx: TCtx;
}

export interface DebouncerOptions {
  flushMs: number;
  /** Injetáveis para testes. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface BufferEntry<TCtx> {
  parts: DebouncePart<TCtx>[];
  timer: unknown;
}

export class Debouncer<TCtx = unknown> {
  private buffers = new Map<string, BufferEntry<TCtx>>();
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly opts: DebouncerOptions) {
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as Parameters<typeof clearTimeout>[0]));
  }

  /** Acumula uma parte; o flush acontece após flushMs de silêncio do chat.
   *  `flush` é chamado UMA VEZ POR ctx distinto, com o texto combinado
   *  apenas das partes daquele ctx (em ordem de chegada). */
  push(key: string, part: DebouncePart<TCtx>, flush: (combined: string, ctx: TCtx) => void): void {
    const existing = this.buffers.get(key);
    if (existing) {
      this.clearTimer(existing.timer);
      existing.parts.push(part);
      existing.timer = this.setTimer(() => this.fire(key, flush), this.opts.flushMs);
      return;
    }
    const entry: BufferEntry<TCtx> = { parts: [part], timer: null };
    entry.timer = this.setTimer(() => this.fire(key, flush), this.opts.flushMs);
    this.buffers.set(key, entry);
  }

  private fire(key: string, flush: (combined: string, ctx: TCtx) => void): void {
    const entry = this.buffers.get(key);
    if (!entry) return;
    this.buffers.delete(key);
    // Agrupa partes por ctx PRESERVANDO a ordem de primeira aparição —
    // mensagens diferentes do mesmo chat viram flushes separados.
    const grupos = new Map<TCtx, string[]>();
    for (const p of entry.parts) {
      const g = grupos.get(p.ctx) ?? [];
      g.push(p.text);
      grupos.set(p.ctx, g);
    }
    for (const [ctx, texts] of grupos) {
      flush(texts.join(' ').replace(/\s+/g, ' ').trim(), ctx);
    }
  }

  /** Nº de chats com mensagens acumuladas aguardando flush (watchdog §13). */
  pendingCount(): number {
    return this.buffers.size;
  }

  /** Joga fora timers pendentes (shutdown). */
  clear(): void {
    for (const entry of this.buffers.values()) this.clearTimer(entry.timer);
    this.buffers.clear();
  }
}
