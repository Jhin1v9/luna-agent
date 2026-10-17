import { describe, expect, it } from 'vitest';
import { parseApprovalCommand, looksLikeGroupContext } from './contact-approval.js';

/**
 * COMANDOS DE APROVAÇÃO EM LOTE (owner 15/10): além de `sim 3`, o owner
 * pode decidir várias solicitações de uma vez — `sim 3 5 8`, pelo nome
 * (`sim abner`) ou tudo que está pendente (`sim todos`). `não todos` é
 * propositalmente inválido (footgun: negar tudo sem querer).
 */

describe('parseApprovalCommand', () => {
  it('id único (comportamento antigo preservado)', () => {
    expect(parseApprovalCommand('sim 3')).toEqual({ verb: 'sim', kind: 'ids', ids: [3] });
    expect(parseApprovalCommand('não 8')).toEqual({ verb: 'não', kind: 'ids', ids: [8] });
    expect(parseApprovalCommand('nao 8')).toEqual({ verb: 'não', kind: 'ids', ids: [8] });
    expect(parseApprovalCommand('sim 3.')).toEqual({ verb: 'sim', kind: 'ids', ids: [3] });
    expect(parseApprovalCommand('Sim 12!')).toEqual({ verb: 'sim', kind: 'ids', ids: [12] });
  });

  it('vários ids de uma vez', () => {
    expect(parseApprovalCommand('sim 2 3 8')).toEqual({ verb: 'sim', kind: 'ids', ids: [2, 3, 8] });
    expect(parseApprovalCommand('não 5, 6, 7')).toEqual({ verb: 'não', kind: 'ids', ids: [5, 6, 7] });
  });

  it('sim todos → todas as pendentes', () => {
    expect(parseApprovalCommand('sim todos')).toEqual({ verb: 'sim', kind: 'all' });
    expect(parseApprovalCommand('sim Todas')).toEqual({ verb: 'sim', kind: 'all' });
    expect(parseApprovalCommand('sim tudo')).toEqual({ verb: 'sim', kind: 'all' });
  });

  it('não todos → inválido (negar tudo sem querer é footgun)', () => {
    expect(parseApprovalCommand('não todos')).toBeNull();
    expect(parseApprovalCommand('nao tudo')).toBeNull();
  });

  it('pelo nome do contato', () => {
    expect(parseApprovalCommand('sim abner')).toEqual({ verb: 'sim', kind: 'name', term: 'abner' });
    expect(parseApprovalCommand('sim Abner Filhao Novo')).toEqual({ verb: 'sim', kind: 'name', term: 'Abner Filhao Novo' });
    expect(parseApprovalCommand('não claudinei')).toEqual({ verb: 'não', kind: 'name', term: 'claudinei' });
  });

  it('texto que não é comando → null (cai no fluxo normal da Luna)', () => {
    expect(parseApprovalCommand('sim')).toBeNull();
    expect(parseApprovalCommand('sim, blz?')).toBeNull();
    expect(parseApprovalCommand('olá')).toBeNull();
    expect(parseApprovalCommand('simplesmente sim')).toBeNull();
  });

  it('"sim amanhã de manhã" tem formato de nome — o handler é quem devolve false se não bater com pendência', () => {
    expect(parseApprovalCommand('sim amanhã de manhã')).toEqual({ verb: 'sim', kind: 'name', term: 'amanhã de manhã' });
  });
});

describe('looksLikeGroupContext', () => {
  it('contexto com 2+ autores distintos → grupo', () => {
    expect(looksLikeGroupContext('Tatiana: oi\nCíntia D: oi\nTatiana: alguém aí?')).toBe(true);
  });

  it('contexto com 1 autor só → não é grupo', () => {
    expect(looksLikeGroupContext('Abner: oi Luna\nAbner: cadê vc?')).toBe(false);
    expect(looksLikeGroupContext('Abner: oi Luna')).toBe(false);
  });

  it('sem prefixo de autor (texto solto) → não é grupo', () => {
    expect(looksLikeGroupContext('oi Luna, tudo bem?')).toBe(false);
  });
});
