import { z } from 'zod';
import { randomUUID } from 'node:crypto';

/**
 * Event Envelope universal (§7.4).
 * Tudo que acontece no sistema é um evento com este formato.
 */

export const EVENT_VERSION = 1 as const;

export const eventTypeSchema = z.string().min(1).regex(
  /^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$/,
  'event_type deve ser ponto.minúsculo, ex.: client.message.received',
);

export const eventEnvelopeSchema = z.object({
  event_id: z.string().startsWith('evt_'),
  event_type: eventTypeSchema,
  version: z.number().int().positive(),
  timestamp: z.string().datetime({ offset: true }),
  source: z.string().min(1),
  organization_id: z.string().uuid().nullable(),
  client_id: z.string().uuid().nullable(),
  conversation_id: z.string().uuid().nullable(),
  correlation_id: z.string().min(1),
  causation_id: z.string().min(1).nullable(),
  priority: z.number().int().default(0),
  payload: z.record(z.unknown()),
  metadata: z.record(z.unknown()).default({}),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export interface CreateEventInput {
  event_type: string;
  source: string;
  payload: Record<string, unknown>;
  organization_id?: string | null;
  client_id?: string | null;
  conversation_id?: string | null;
  /** Se omitido, gera um correlation_id novo (início de cadeia). */
  correlation_id?: string;
  causation_id?: string | null;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export function createEvent(input: CreateEventInput): EventEnvelope {
  return eventEnvelopeSchema.parse({
    event_id: `evt_${randomUUID()}`,
    event_type: input.event_type,
    version: EVENT_VERSION,
    timestamp: new Date().toISOString(),
    source: input.source,
    organization_id: input.organization_id ?? null,
    client_id: input.client_id ?? null,
    conversation_id: input.conversation_id ?? null,
    correlation_id: input.correlation_id ?? `corr_${randomUUID()}`,
    causation_id: input.causation_id ?? null,
    priority: input.priority ?? 0,
    payload: input.payload,
    metadata: input.metadata ?? {},
  });
}

/** Valida um envelope vindo de fora (persistido, fila, replay). */
export function validateEvent(raw: unknown): EventEnvelope {
  return eventEnvelopeSchema.parse(raw);
}

export function isEventEnvelope(raw: unknown): raw is EventEnvelope {
  return eventEnvelopeSchema.safeParse(raw).success;
}
