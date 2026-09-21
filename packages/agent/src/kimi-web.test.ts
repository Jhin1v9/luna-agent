import { describe, it, expect } from 'vitest';
import { KimiWebAdapter } from './kimi-web.js';
import { KimiWebTurnError, KimiWebUnavailable } from './types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const CONFIG = {
  mode: 'kimi-web' as const,
  webUrl: 'http://127.0.0.1:58627',
  webToken: 'test-token',
  cwd: 'C:/repo',
};

describe('KimiWebAdapter (REST local, ADR-010/015)', () => {
  it('ensureSession cria sessão via POST /api/v1/sessions e cacheia', async () => {
    let calls = 0;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls++;
      expect(url).toBe('http://127.0.0.1:58627/api/v1/sessions');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer test-token');
      const body = JSON.parse(String(init?.body)) as { metadata: { cwd: string } };
      expect(body.metadata.cwd).toBe('C:/repo');
      return jsonResponse({ code: 0, data: { id: 'session_x1', busy: false } });
    };
    const a = new KimiWebAdapter(CONFIG, fetchImpl);
    const s1 = await a.ensureSession('conv-1');
    const s2 = await a.ensureSession('conv-1');
    expect(s1.session_id).toBe('session_x1');
    expect(s2.session_id).toBe('session_x1');
    expect(calls).toBe(1); // cache
  });

  it('healthCheck lê /api/v1/meta', async () => {
    const fetchImpl = async (url: string) => {
      expect(url).toBe('http://127.0.0.1:58627/api/v1/meta');
      return jsonResponse({ code: 0, data: { server_version: '0.42.0', backend: 'v2' } });
    };
    const a = new KimiWebAdapter(CONFIG, fetchImpl);
    expect(await a.healthCheck()).toEqual({ server_version: '0.42.0', backend: 'v2' });
  });

  it('401 vira KimiWebUnavailable (token inválido — nunca logar o token)', async () => {
    const a = new KimiWebAdapter(CONFIG, async () => jsonResponse({}, 401));
    await expect(a.healthCheck()).rejects.toThrow(KimiWebUnavailable);
  });

  it('recusa URL não-loopback (§7.3 — nunca expor à internet)', () => {
    expect(
      () => new KimiWebAdapter({ ...CONFIG, webUrl: 'https://kimi.nexo.dev' }),
    ).toThrow(/loopback/);
  });

  it('sendTurn lança KimiWebTurnError (WS experimental não mapeado — ADR-015)', async () => {
    const a = new KimiWebAdapter(CONFIG, async () => jsonResponse({}));
    await expect(a.sendTurn({ session_key: 'k', prompt: 'p' })).rejects.toThrow(KimiWebTurnError);
    await expect(a.sendTurn({ session_key: 'k', prompt: 'p' })).rejects.toThrow(/ADR-015/);
  });

  it('readMessages usa GET /api/v1/sessions/:id/messages', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url.endsWith('/sessions')) {
        return jsonResponse({ code: 0, data: { id: 'session_x2' } });
      }
      return jsonResponse({ code: 0, data: { items: [{ seq: 1 }] } });
    };
    const a = new KimiWebAdapter(CONFIG, fetchImpl);
    const msgs = await a.readMessages('conv-9');
    expect(msgs).toEqual([{ seq: 1 }]);
    expect(urls[1]).toBe('http://127.0.0.1:58627/api/v1/sessions/session_x2/messages');
  });
});
