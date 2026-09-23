import { describe, expect, it } from 'vitest';
import { DONOS, isDono, normalizeSpelling, resolveDono } from './owners.js';
import { createWhatsAppSkills } from './skills.js';
import type { ContactRef } from './skills.js';
import type { WhatsAppTransport } from './transport.js';

/**
 * DONOS (decreto owner 2026-09-23) — uma pessoa, um canônico, muitos
 * apelidos. Skills normalizam ANTES do ContactMap.
 */

describe('owners — registro canônico dos sócios', () => {
  it('resolve apelidos do owner pro canônico', () => {
    expect(resolveDono('Abner')?.canonical).toBe('Abner Mendes');
    expect(resolveDono('eu')?.canonical).toBe('Abner Mendes');
    expect(resolveDono('PAI')?.canonical).toBe('Elias Israel Mendes');
    expect(resolveDono('Superclim Servicios')?.canonical).toBe('Elias Israel Mendes');
    expect(resolveDono('noke')?.canonical).toBe('Enoque Santos');
    expect(resolveDono('Nonoke')?.canonical).toBe('Enoque Santos');
  });

  it('não resolve quem não é dono (null) e isDono confirma', () => {
    expect(resolveDono('Fernanda 😎')).toBeNull();
    expect(isDono('elias')).toBe(true);
    expect(isDono('fernanda')).toBe(false);
  });

  it('todos os donos têm phone E.164 e chatTitle', () => {
    for (const d of DONOS) {
      expect(d.phone).toMatch(/^\+34 \d{3} \d{2} \d{2} \d{2}$/);
      expect(d.chatTitle.length).toBeGreaterThan(0);
    }
  });

  it('normalizeSpelling colapsa espaços e minúsculas', () => {
    expect(normalizeSpelling('  Superclim   Servicios ')).toBe('superclim servicios');
  });
});

describe('skills — donos normalizados antes do ContactMap', () => {
  const fakeTransport = {} as unknown as WhatsAppTransport;

  it('contact.find com apelido de dono consulta o canônico', async () => {
    const seen: string[] = [];
    const skills = createWhatsAppSkills({
      transport: fakeTransport,
      resolveContact: async (name: string): Promise<ContactRef | null> => {
        seen.push(name);
        return { name, phone: '+34 672 95 30 62' };
      },
    });
    const ref = await skills['contact.find']('pai');
    expect(seen).toEqual(['Elias Israel Mendes']); // normalizou ANTES
    expect(ref?.phone).toBe('+34 672 95 30 62');
  });

  it('contact.find de dono SEM linha no ContactMap devolve o registro canônico', async () => {
    const skills = createWhatsAppSkills({
      transport: fakeTransport,
      resolveContact: async () => null,
    });
    const ref = await skills['contact.find']('noke');
    expect(ref).toEqual({ name: 'Enoque Santos', phone: '+34 689 13 51 59' });
  });

  it('contact.find de não-dono continua passando direto', async () => {
    const seen: string[] = [];
    const skills = createWhatsAppSkills({
      transport: fakeTransport,
      resolveContact: async (name: string) => {
        seen.push(name);
        return null;
      },
    });
    const ref = await skills['contact.find']('Jordi Local Superclim');
    expect(seen).toEqual(['Jordi Local Superclim']);
    expect(ref).toBeNull();
  });
});
