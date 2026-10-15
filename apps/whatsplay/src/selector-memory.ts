import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Memória de seletores (§13) — append-only, protocolo do Brain: data +
 * autor: Luna. Toda mudança de seletor que o auto-reparo descobrir vira
 * entrada aqui automaticamente. NUNCA editar entradas antigas.
 */

export interface SelectorChange {
  uso: string;
  antigo: string;
  novo: string;
  fallback: string;
}

const MEMORY_PATH = fileURLToPath(
  new URL('../../../.brain/luna/selectors/whatsapp.md', import.meta.url),
);

export function appendSelectorMemory(change: SelectorChange): void {
  const now = new Date().toISOString().slice(0, 10);
  const entry =
    `\n### ${now} · auto-reparo — autor: Luna\n` +
    `- uso: ${change.uso}\n` +
    `- seletor antigo: ${change.antigo}\n` +
    `- seletor novo: ${change.novo}\n` +
    `- fallback visual: ${change.fallback}\n`;
  appendFileSync(MEMORY_PATH, entry, 'utf8');
}
