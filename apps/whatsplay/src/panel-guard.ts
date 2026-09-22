import type { Logger } from 'pino';

/**
 * PanelGuard (decreto owner 2026-09-22): NUNCA mais de 1 chat aberto.
 * Serialização dura do painel: antes de QUALQUER trabalho que abre chat
 * (sweep, readConversation, envio), o guard garante que o painel está na
 * lista (nenhum chat aberto). Sobra de ciclo anterior / falha de fechamento /
 * relaunch que restaura o painel aberto → fecha PRIMEIRO com log warn
 * ('chat X encontrado aberto fora de ciclo — fechando'). Fechamento impossível
 * → onStuck (log de erro 'estado de painel inconsistente', audit + alerta
 * Telegram) e o caller REINICIA o serviço (pm2 ressobe; exit explícito).
 */

export class PanelStuckError extends Error {
  constructor(readonly chatTitle: string) {
    super(`painel travado: não consegui fechar o chat '${chatTitle}'`);
    this.name = 'PanelStuckError';
  }
}

export interface PanelGuardDeps {
  /** Título do chat aberto no painel agora (null = lista). */
  peek: () => Promise<string | null>;
  /** Fecha o painel; retorna true se voltou pra lista (verificável). */
  close: () => Promise<boolean>;
  log: Logger;
  /** Fechamento falhou após tentativas: visibilidade (log+audit+Telegram) e
   *  decisão de reinício fica do caller. */
  onStuck?: (chatTitle: string, context: string) => Promise<void>;
  closeAttempts?: number;
}

export class PanelGuard {
  private readonly attempts: number;

  constructor(private readonly deps: PanelGuardDeps) {
    this.attempts = deps.closeAttempts ?? 2;
  }

  /** Fecha com retry e verificação. false = travado de verdade. */
  async closeWithRetry(): Promise<boolean> {
    for (let i = 0; i < this.attempts; i++) {
      if (await this.deps.close()) return true;
      await new Promise((r) => setTimeout(r, 600));
    }
    return false;
  }

  /** Início de um ciclo de trabalho: painel DEVE estar na lista. */
  async beginCycle(context: string): Promise<void> {
    const open = await this.deps.peek();
    if (open === null) return;
    this.deps.log.warn({ chat: open, context }, `chat '${open}' encontrado aberto fora de ciclo — fechando`);
    if (await this.closeWithRetry()) return;
    await this.deps.onStuck?.(open, context);
    throw new PanelStuckError(open);
  }

  /** Fim de um ciclo: fecha e confere; se travou, mesma visibilidade. */
  async endCycle(context: string): Promise<void> {
    const open = await this.deps.peek();
    if (open === null) return;
    if (await this.closeWithRetry()) return;
    await this.deps.onStuck?.(open, `${context} (fim de ciclo)`);
    throw new PanelStuckError(open);
  }
}
