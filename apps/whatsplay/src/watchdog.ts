/**
 * Watchdog WhatsPlay (§13) — estados: HEALTHY / DEGRADED / DISCONNECTED /
 * RECOVERING / FAILED. Checa: Chrome vivo · página carregada · sessão
 * conectada (DOM reconhecido) · último heartbeat · fila de saída crescendo.
 * Na falha, captura evidência (screenshot + DOM simplificado) para a
 * auto-reparação visual da F1.5.
 */

import type { Logger } from 'pino';
import type { TransportStatus } from './transport.js';

export type WatchdogState = 'HEALTHY' | 'DEGRADED' | 'DISCONNECTED' | 'RECOVERING' | 'FAILED';

export interface WatchdogCheck {
  status: TransportStatus;
  evidence?: { screenshotPath?: string; domPath?: string };
}

export interface WatchdogDeps {
  /** Consulta o transporte (getStatus + captura de evidência na falha). */
  check(): Promise<WatchdogCheck>;
  /** Última vez que uma mensagem inbound foi vista (heartbeat de atividade). */
  lastInboundAt(): Date | null;
  telegram?: (text: string) => Promise<unknown>;
  log: Logger;
  /** Fila de saída "crescendo" acima desse tamanho vira DEGRADED. */
  queueWarnThreshold?: number;
  /** Falhas consecutivas até FAILED (e alerta Telegram). */
  maxFailures?: number;
}

export function evaluate(check: WatchdogCheck, lastInbound: Date | null): WatchdogState {
  const { status } = check;
  if (!status.pageAlive) return 'DISCONNECTED';
  if (status.state === 'QR_PENDING') return 'DISCONNECTED'; // sessão caiu, precisa reparo humano
  if (status.state !== 'LOGGED_IN') return 'DEGRADED';
  const idleMs = lastInbound ? Date.now() - lastInbound.getTime() : null;
  if (idleMs !== null && idleMs > 30 * 60_000) return 'DEGRADED'; // sem atividade há 30min
  return 'HEALTHY';
}

export class Watchdog {
  private failures = 0;
  private state: WatchdogState = 'RECOVERING';
  private readonly queueWarnThreshold: number;
  private readonly maxFailures: number;

  constructor(private readonly deps: WatchdogDeps) {
    this.queueWarnThreshold = deps.queueWarnThreshold ?? 20;
    this.maxFailures = deps.maxFailures ?? 3;
  }

  getState(): WatchdogState {
    return this.state;
  }

  /** Um ciclo de checagem. Retorna o estado atual. */
  async runOnce(): Promise<WatchdogState> {
    let check: WatchdogCheck | undefined;
    try {
      check = await this.deps.check();
    } catch (err) {
      this.failures++;
      this.deps.log.error({ err, failures: this.failures }, 'watchdog: checagem falhou');
      if (this.failures >= this.maxFailures && this.state !== 'FAILED') {
        this.state = 'FAILED';
        await this.alert(
          `WhatsPlay FAILED: ${this.failures} checagens seguidas falhando. ` +
            `Chrome vivo? Rede? Última evidência: ${check?.evidence?.screenshotPath ?? 'nenhuma'}.`,
        );
      } else if (this.state === 'HEALTHY') {
        this.state = 'DEGRADED';
      }
      return this.state;
    }

    const next = evaluate(check, this.deps.lastInboundAt());
    const prev = this.state;
    this.state = next;

    if (next === 'HEALTHY') {
      this.failures = 0;
      if (prev !== 'HEALTHY') this.deps.log.info({ prev }, 'watchdog: recuperado');
      return next;
    }

    if (next === 'DISCONNECTED' && prev !== 'DISCONNECTED') {
      this.deps.log.error({ check }, 'watchdog: WhatsApp desconectado');
      await this.alert(
        `WhatsPlay DISCONNECTED — sessão do WhatsApp caiu. ` +
          `Evidência: ${check.evidence?.screenshotPath ?? 'sem screenshot'}. ` +
          `Luna segura as respostas; reconecta aí que eu retomo.`,
      );
    }

    return this.state;
  }

  private async alert(text: string): Promise<void> {
    if (!this.deps.telegram) return;
    try {
      await this.deps.telegram(text);
    } catch (err) {
      this.deps.log.error({ err }, 'watchdog: alerta Telegram falhou');
    }
  }
}
