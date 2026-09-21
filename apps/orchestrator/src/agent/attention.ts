import type { Sql } from '@luna/database';

/**
 * State machine de atenção (§7.11) — nasce mínima:
 *   NEW → AI_HANDLING → RESOLVED   (reabrir: RESOLVED → AI_HANDLING)
 * NEEDS_HUMAN e os estados de escalada entram na F5; a coluna `state` já
 * existe desde a 001 exatamente para isso.
 */

export type AttentionState =
  | 'NEW'
  | 'AI_HANDLING'
  | 'RESOLVED'
  | 'NEEDS_HUMAN'
  | 'HUMAN_NOTIFIED'
  | 'HUMAN_HANDLING';

const ALLOWED: Record<AttentionState, AttentionState[]> = {
  NEW: ['AI_HANDLING'],
  AI_HANDLING: ['RESOLVED', 'NEEDS_HUMAN'],
  RESOLVED: ['AI_HANDLING'],
  NEEDS_HUMAN: ['HUMAN_NOTIFIED', 'AI_HANDLING'],
  HUMAN_NOTIFIED: ['HUMAN_HANDLING', 'AI_HANDLING'],
  HUMAN_HANDLING: ['RESOLVED', 'AI_HANDLING'],
};

export function canTransition(from: string, to: string): boolean {
  return (ALLOWED[from as AttentionState] ?? []).includes(to as AttentionState);
}

export class InvalidTransition extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`transição de atenção inválida: ${from} → ${to}`);
    this.name = 'InvalidTransition';
  }
}

/** Estado atual da conversa (sem transicionar). */
export async function getConversationState(pool: Sql, conversationId: string): Promise<string | null> {
  const res = await pool.query<{ state: string }>(
    'SELECT state FROM conversations WHERE id = $1',
    [conversationId],
  );
  return res.rowCount ? res.rows[0]!.state : null;
}

/** Transiciona e PERSISTE o estado na conversation (fonte da verdade = DB). */
export async function transitionConversation(
  pool: Sql,
  conversationId: string,
  to: AttentionState,
): Promise<void> {
  const current = await pool.query<{ state: string }>(
    'SELECT state FROM conversations WHERE id = $1',
    [conversationId],
  );
  if (!current.rowCount) throw new Error(`conversa ${conversationId} não existe`);
  const from = current.rows[0]!.state;
  if (from === to) return;
  if (!canTransition(from, to)) throw new InvalidTransition(from, to);
  await pool.query(
    'UPDATE conversations SET state = $2, updated_at = now() WHERE id = $1',
    [conversationId, to],
  );
}
