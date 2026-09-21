import { describe, it, expect } from 'vitest';
import { MockKimiAdapter } from './mock.js';

const PROMPT = [
  'Você é Luna, CTO virtual da Nexo Digital.',
  'Contexto: cliente Jess, conversa #abc',
  'Mensagem do cliente: oi, já ficou pronto?',
].join('\n');

describe('MockKimiAdapter (modo dev/testes)', () => {
  it('é determinístico: mesma entrada → mesma saída', async () => {
    const a = new MockKimiAdapter();
    const r1 = await a.sendTurn({ session_key: 'conv-1', prompt: PROMPT });
    const r2 = await a.sendTurn({ session_key: 'conv-1', prompt: PROMPT });
    expect(r1.reply_text).toBe(r2.reply_text);
    expect(r1.session_id).toBe(r2.session_id);
    expect(r1.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('mantém sessão persistente por session_key', async () => {
    const a = new MockKimiAdapter();
    const s1 = await a.ensureSession('conv-42');
    const s2 = await a.ensureSession('conv-42');
    const s3 = await a.ensureSession('conv-outra');
    expect(s2.session_id).toBe(s1.session_id);
    expect(s3.session_id).not.toBe(s1.session_id);
    expect(s1.session_id).toMatch(/^mock_/);
  });

  it('resposta deixa claro que é stub (nunca texto de cliente real)', async () => {
    const a = new MockKimiAdapter();
    const r = await a.sendTurn({ session_key: 'k', prompt: PROMPT });
    expect(r.reply_text).toContain('[mock-luna]');
    expect(r.reply_text).not.toContain('Jess');
  });

  it('readMessages retorna lista vazia', async () => {
    const a = new MockKimiAdapter();
    expect(await a.readMessages('k')).toEqual([]);
  });
});
