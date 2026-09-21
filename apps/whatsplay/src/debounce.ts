/**
 * Debounce por chat (§19): "oi" "eu queria" "saber se" "o site" "já ficou
 * pronto" (5 msgs em 6s) viram UMA pergunta antes de responder.
 * Mensagens do mesmo chat dentro da janela de silêncio se acumulam e o flush
 * entrega o texto concatenado em ordem.
 */

export interface DebouncerOptions {
  flushMs: number;
  /** Injetáveis para testes. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class Debouncer {
  private buffers = new Map<string, { parts: string[]; timer: unknown }>();
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly opts: DebouncerOptions) {
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as Parameters<typeof clearTimeout>[0]));
  }

  /** Acumula uma mensagem; o flush acontece após flushMs de silêncio do chat. */
  push(key: string, text: string, flush: (combined: string) => void): void {
    const existing = this.buffers.get(key);
    if (existing) {
      this.clearTimer(existing.timer);
      existing.parts.push(text);
      existing.timer = this.setTimer(() => this.fire(key, flush), this.opts.flushMs);
      return;
    }
    const entry = { parts: [text], timer: null as unknown };
    entry.timer = this.setTimer(() => this.fire(key, flush), this.opts.flushMs);
    this.buffers.set(key, entry);
  }

  private fire(key: string, flush: (combined: string) => void): void {
    const entry = this.buffers.get(key);
    if (!entry) return;
    this.buffers.delete(key);
    flush(entry.parts.join(' ').replace(/\s+/g, ' ').trim());
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
