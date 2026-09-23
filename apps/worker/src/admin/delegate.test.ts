import { describe, it, expect } from 'vitest';
import { parseDelegation, buildDelegationPrompt, delegateAdminMessage, HARD_RULES_FOOTER } from './delegate.js';
import type { KimiLiveAdapter } from '@luna/agent';

const adapterReturning = (reply: string): KimiLiveAdapter => ({
  mode: 'kimi-api',
  provider: 'kimi-api',
  async ensureSession(k: string) {
    return { session_id: k, busy: false };
  },
  async sendTurn() {
    return { reply_text: reply, session_id: 'x', duration_ms: 1 };
  },
  async readMessages() {
    return [];
  },
} as KimiLiveAdapter);

describe('parseDelegation (protocolo DECISAO/CONTEUDO)', () => {
  it('RESPONDER válido → question + conteúdo', () => {
    const p = parseDelegation('DECISAO: RESPONDER\nCONTEUDO: Tudo no ar, 4 serviços online.');
    expect(p).toEqual({ kind: 'question', content: 'Tudo no ar, 4 serviços online.' });
  });

  it('ORDEM válido → order + prompt composto', () => {
    const p = parseDelegation('DECISAO: ORDEM\nCONTEUDO: Reinicie o worker: pm2 restart luna-worker');
    expect(p).toEqual({ kind: 'order', content: 'Reinicie o worker: pm2 restart luna-worker' });
  });

  it('tolerante a variações de casing/espaço', () => {
    expect(parseDelegation('  decisao: ordem\n\nconteudo: faça X')?.kind).toBe('order');
    expect(parseDelegation('DECISAO: responder\nCONTEUDO: ok')?.kind).toBe('question');
  });

  it('malformado → null (regex assume)', () => {
    expect(parseDelegation('RESPOSTA-FAST')).toBeNull();
    expect(parseDelegation('DECISAO: TALVEZ\nCONTEUDO: x')).toBeNull();
    expect(parseDelegation('DECISAO: ORDEM')).toBeNull();
    expect(parseDelegation('DECISAO: RESPONDER\nCONTEUDO:')).toBeNull();
  });
});

describe('buildDelegationPrompt', () => {
  it('instrui RESPONDER/ORDEM, lista ferramentas do live brain e exige formato exato', () => {
    const p = buildDelegationPrompt('como está o worker?', 'Abner', ['- serviços: 4 online']);
    expect(p).toContain('ROTEADOR');
    expect(p).toContain('DECISAO: RESPONDER');
    expect(p).toContain('DECISAO: ORDEM');
    expect(p).toContain('pm2');
    expect(p).toContain('git');
    expect(p).toContain('- serviços: 4 online');
    expect(p).toContain('Mensagem do admin (Abner): como está o worker?');
  });
});

describe('delegateAdminMessage (degradação: LLM → regex)', () => {
  it('resposta bem-formada do LLM → decidedBy llm, conteúdo do modelo', async () => {
    const d = await delegateAdminMessage(
      { adapter: adapterReturning('DECISAO: RESPONDER\nCONTEUDO: Tudo ok por aqui.') },
      { text: 'tudo bem?', adminName: 'Abner', packSections: [], sessionKey: 's' },
    );
    expect(d).toEqual({ kind: 'question', content: 'Tudo ok por aqui.', decidedBy: 'llm' });
  });

  it('resposta malformada → regex decide (decidedBy regex, content vazio)', async () => {
    const d = await delegateAdminMessage(
      { adapter: adapterReturning('blá blá sem protocolo') },
      { text: 'Lista os serviços pm2', adminName: 'Abner', packSections: [], sessionKey: 's' },
    );
    expect(d.kind).toBe('order');
    expect(d.decidedBy).toBe('regex');
    expect(d.content).toBe('');
  });

  it('FAST indisponível (throw) → regex decide, sem propagar erro', async () => {
    const down: KimiLiveAdapter = {
      mode: 'kimi-api',
      provider: 'kimi-api',
      async ensureSession(k: string) {
        return { session_id: k, busy: false };
      },
      async sendTurn(): Promise<never> {
        throw new Error('quota exceeded HTTP 403');
      },
      async readMessages() {
        return [];
      },
    } as KimiLiveAdapter;
    const d = await delegateAdminMessage(
      { adapter: down },
      { text: 'oi', adminName: 'Abner', packSections: [], sessionKey: 's' },
    );
    expect(d).toEqual({ kind: 'question', content: '', decidedBy: 'regex' }); // 'oi' é smalltalk → question
  });
});

describe('HARD_RULES_FOOTER (segurança não delegada ao LLM)', () => {
  it('veda projeto de cliente, exige autor Luna e evidência', () => {
    expect(HARD_RULES_FOOTER).toContain('PROJETO DE CLIENTE É VEDADO');
    expect(HARD_RULES_FOOTER).toContain('luna@nexo-digital.local');
    expect(HARD_RULES_FOOTER).toContain('EVIDÊNCIA');
  });
});
