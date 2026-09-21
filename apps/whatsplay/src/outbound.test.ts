import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { createOutboundListener } from './outbound.js';
import type { WhatsAppTransport } from './transport.js';

const log = pino({ level: 'silent' });

/** Pool stub: responde o SELECT da mensagem e grava os UPDATE/INSERT. */
function stubPool(target: { address: string | null; contact_name: string | null }) {
  const audits: Array<{ action: string; result: string; metadata: Record<string, unknown> }> = [];
  const updates: Array<{ state: string; error?: string }> = [];
  const pool = {
    async query(sql: string, params?: unknown[]) {
      if (sql.startsWith('SELECT')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: params![0],
              body: 'corpo da resposta',
              address: target.address,
              contact_name: target.contact_name,
              correlation_id: 'corr-test',
            },
          ],
        };
      }
      if (sql.startsWith('INSERT INTO audit_log')) {
        audits.push({ action: params![1] as string, result: params![6] as string, metadata: params![8] as Record<string, unknown> });
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith('UPDATE messages')) {
        updates.push({ state: params![1] as string, error: JSON.parse((params![2] as string) || '{}').send_error });
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  return { pool: pool as never, audits, updates };
}

function fakeTransport(sent: string[]): WhatsAppTransport {
  return {
    async getStatus() {
      return { state: 'LOGGED_IN', pageAlive: true, lastHeartbeatAt: new Date().toISOString(), outgoingQueued: 0 };
    },
    async getUnread() {
      return [];
    },
    async readConversation() {
      return [];
    },
    async sendMessage(target: string, text: string) {
      sent.push(`${target}:${text}`);
      return 'ok';
    },
  };
}

function makeDeps(target: { address: string | null; contact_name: string | null }, allowlist: string[], enforce: boolean) {
  const sent: string[] = [];
  const { pool, audits, updates } = stubPool(target);
  const listener = createOutboundListener({
    pool,
    transport: fakeTransport(sent),
    log,
    humanDelayMs: 0, // teste: sem espera humana
    allowlist,
    enforceAllowlist: enforce,
  });
  return { listener, sent, audits, updates };
}

describe('GUARDRAIL outbound allowlist (decreto do owner, ADR-020)', () => {
  it('destino NA lista → envia normalmente', async () => {
    const { listener, sent, audits, updates } = makeDeps({ address: 'Pai', contact_name: 'Pai' }, ['Pai'], true);
    await listener.deliverOne('m1');
    expect(sent).toHaveLength(1);
    expect(updates[0]!.state).toBe('sent');
    expect(audits.some((a) => a.action === 'whatsapp.message.sent')).toBe(true);
  });

  it('destino FORA da lista → RECUSA: nada enviado, failed + audit de recusa explícito', async () => {
    const { listener, sent, audits, updates } = makeDeps({ address: 'Meu Amorzinho 💖🌻', contact_name: 'Meu Amorzinho 💖🌻' }, ['Pai'], true);
    await listener.deliverOne('m2');
    expect(sent).toHaveLength(0);
    expect(updates[0]!.state).toBe('failed');
    const refused = audits.find((a) => a.action === 'whatsapp.message.send_refused');
    expect(refused).toBeDefined();
    expect(refused!.result).toBe('failed');
    expect(refused!.metadata.reason).toBe('outbound_allowlist');
  });

  it('lista VAZIA em dev → recusa TUDO (fail-closed, mais seguro que fail-open)', async () => {
    const { listener, sent, audits } = makeDeps({ address: 'Pai', contact_name: 'Pai' }, [], true);
    await listener.deliverOne('m3');
    expect(sent).toHaveLength(0);
    expect(audits.some((a) => a.action === 'whatsapp.message.send_refused')).toBe(true);
  });

  it('produção (enforce=false) → allowlist NÃO se aplica: envia para qualquer destino', async () => {
    const { listener, sent } = makeDeps({ address: 'qualquer um', contact_name: 'qualquer um' }, ['Pai'], false);
    await listener.deliverOne('m4');
    expect(sent).toHaveLength(1);
  });

  it('jid na lista casa por sufixo (entrada com @)', async () => {
    const { listener, sent } = makeDeps({ address: '5511987654321@s.whatsapp.net', contact_name: 'João' }, ['5511987654321@s.whatsapp.net'], true);
    await listener.deliverOne('m5');
    expect(sent).toHaveLength(1);
  });

  it('substring NÃO vale: "Pai" não libera "Papai" (falso-positivo de allow é o pior cenário)', async () => {
    const { listener, sent } = makeDeps({ address: 'Papai', contact_name: 'Papai' }, ['Pai'], true);
    await listener.deliverOne('m6');
    expect(sent).toHaveLength(0);
  });
});
