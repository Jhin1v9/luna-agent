import { describe, expect, it } from 'vitest';
import { classifyAdminMessage, DESTRUCTIVE_RE, ORDER_PROMPT } from './orders.js';

describe('classifyAdminMessage (P3 — pergunta vs ordem, determinístico)', () => {
  it('perguntas com "?" e sem verbo imperativo → question', () => {
    expect(classifyAdminMessage('Qual o status do worker?').kind).toBe('question');
    expect(classifyAdminMessage('Quantos serviços estão no ar?').kind).toBe('question');
  });

  it('imperativo no início → order', () => {
    expect(classifyAdminMessage('Lista os serviços pm2').kind).toBe('order');
    expect(classifyAdminMessage('Reinicia o worker').kind).toBe('order');
    expect(classifyAdminMessage('Cria uma solicitação pro cliente X').kind).toBe('order');
    expect(classifyAdminMessage('corrige o módulo de outbound').kind).toBe('order');
  });

  it('"?" com imperativo no início ainda é ordem (ex.: "reinicia o worker agora?")', () => {
    expect(classifyAdminMessage('Reinicia o worker agora?').kind).toBe('order');
  });

  it('sem "?" e sem imperativo → order (fail executivo: vai pro live brain que responde — custa segundos)', () => {
    expect(classifyAdminMessage('quanto custa o site').kind).toBe('order');
  });

  it('destrutivas são detectadas para confirmação inline', () => {
    expect(classifyAdminMessage('Reinicia o PC').destructive).toBe(true);
    expect(classifyAdminMessage('Desliga a máquina').destructive).toBe(true);
    expect(classifyAdminMessage('Roda a migration 009').destructive).toBe(true);
    expect(classifyAdminMessage('Lista os serviços pm2').destructive).toBe(false);
    expect(classifyAdminMessage('Qual o status?').destructive).toBe(false);
  });

  it('DESTRUCTIVE_RE não pega falso-positivo bobo ("deletei" como substantivo de código é ok — destrutivo mesmo)', () => {
    expect(DESTRUCTIVE_RE.test('apaga o cache do node_modules')).toBe(true);
  });

  it('ORDER_PROMPT veda projeto de cliente e exige evidência', () => {
    const p = ORDER_PROMPT('Lista os serviços pm2', 'Abner');
    expect(p).toContain('Lista os serviços pm2');
    expect(p).toContain('PROJETO DE CLIENTE É VEDADO');
    expect(p).toContain('EVIDÊNCIA');
    expect(p).toContain('luna@nexo-digital.local');
  });
});
