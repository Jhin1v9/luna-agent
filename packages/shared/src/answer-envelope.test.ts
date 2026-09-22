import { describe, expect, it } from 'vitest';
import { extractAnswerEnvelopeText } from './answer-envelope.js';

describe('extractAnswerEnvelopeText (bug: JSON do ANSWER indo literal pro cliente)', () => {
  it('extrai texto de envelope JSON estrito válido', () => {
    expect(extractAnswerEnvelopeText('{"type":"ANSWER","text":"oi!"}')).toBe('oi!');
  });

  it('extrai mesmo com newline LITERAL dentro da string (caso do incidente)', () => {
    const broken = '{"type":"ANSWER","text":"Opa, segura aí 😄\n\nResposta direta: não 👊"}';
    expect(extractAnswerEnvelopeText(broken)).toBe('Opa, segura aí 😄\n\nResposta direta: não 👊');
  });

  it('decodifica escapes comuns e mantém escapes unicode', () => {
    const raw = '{"type":"ANSWER","text":"a\\nb\\t\\"c\\\\d\\u00e9"}';
    expect(extractAnswerEnvelopeText(raw)).toBe('a\nb\t"c\\dé');
  });

  it('tolera prosa ao redor do envelope', () => {
    const wrapped = 'Claro! Aqui vai:\n{"type":"ANSWER","text":"texto puro"}';
    expect(extractAnswerEnvelopeText(wrapped)).toBe('texto puro');
  });

  it('tolera _note e campos extras sem engolir o fechamento', () => {
    const raw = '{"type":"ANSWER","text":"só o texto","_note":"ok"}';
    expect(extractAnswerEnvelopeText(raw)).toBe('só o texto');
  });

  it('retorna null para não-envelope (TOOL_CALL, ESCALATE, texto puro)', () => {
    expect(extractAnswerEnvelopeText('{"type":"TOOL_CALL","tool":"x","args":{}}')).toBeNull();
    expect(extractAnswerEnvelopeText('{"type":"ESCALATE_HUMAN","reason":"y"}')).toBeNull();
    expect(extractAnswerEnvelopeText('texto comum sem json')).toBeNull();
  });
});
