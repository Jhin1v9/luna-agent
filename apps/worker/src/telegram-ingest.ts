import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { insertKimiWorkEvent } from '@luna/database';

/**
 * Ponte menções → Kimi Work (decreto owner 2026-09-24): mensagens do grupo
 * do time que mencionam a Luna viram evento kimiwork_inbox
 * (kind='telegram.message'). Quem responde é o cérebro Kimi Work (Automation
 * "Luna — Cérebro 24/7") — o loop F4 local NÃO responde, evitando duplicata.
 * Mensagens sem menção seguem o fluxo F4 normal (chat admin).
 *
 * Filtro deliberadamente simples: o texto contém "luna" (case-insensitive),
 * com ou sem @. Menção é intenção de falar comigo; falso-positivo ("lunar")
 * custa um evento no inbox que o cérebro descarta com bom senso.
 */

export interface TelegramMentionMsg {
  chatId: string;
  messageId: number;
  fromId: string | null;
  fromName: string;
  text: string;
}

export interface TelegramIngest {
  matches: (text: string) => boolean;
  /** true = evento garantido no inbox (novo ou já existente — idempotência
   *  por chave). false = falha de banco (caller cai no fluxo normal). */
  ingest: (msg: TelegramMentionMsg) => Promise<boolean>;
}

const MENTION_RE = /luna/i;

export function createTelegramIngest(deps: { pool: Pool; log: Logger }): TelegramIngest {
  return {
    matches(text: string): boolean {
      return MENTION_RE.test(text);
    },
    async ingest(msg: TelegramMentionMsg): Promise<boolean> {
      try {
        const id = await insertKimiWorkEvent(deps.pool, {
          kind: 'telegram.message',
          payload: {
            chat_id: msg.chatId,
            message_id: msg.messageId,
            from_id: msg.fromId,
            from_name: msg.fromName,
            text: msg.text,
          },
          idempotencyKey: `tg:${msg.chatId}:${msg.messageId}`,
        });
        deps.log.info(
          { message_id: msg.messageId, from: msg.fromName, duplicate: id === null },
          'ingest telegram: menção → kimiwork_inbox (Kimi Work responde)',
        );
        return true;
      } catch (err) {
        deps.log.error({ err }, 'ingest telegram: falha ao enfileirar menção');
        return false;
      }
    },
  };
}
