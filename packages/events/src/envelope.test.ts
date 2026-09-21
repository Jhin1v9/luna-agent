import { describe, it, expect } from 'vitest';
import { createEvent, validateEvent, isEventEnvelope } from './envelope.js';

describe('Event Envelope universal (§7.4)', () => {
  it('cria envelope válido com todos os campos obrigatórios', () => {
    const evt = createEvent({
      event_type: 'client.message.received',
      source: 'whatsplay',
      payload: { text: 'oi' },
      client_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    });
    expect(evt.event_id).toMatch(/^evt_/);
    expect(evt.version).toBe(1);
    expect(evt.correlation_id).toMatch(/^corr_/);
    expect(evt.organization_id).toBeNull();
    expect(evt.causation_id).toBeNull();
    expect(evt.priority).toBe(0);
    expect(evt.metadata).toEqual({});
    expect(isEventEnvelope(evt)).toBe(true);
  });

  it('propaga correlation_id e causation_id na cadeia', () => {
    const first = createEvent({
      event_type: 'client.message.received',
      source: 'whatsplay',
      payload: {},
    });
    const second = createEvent({
      event_type: 'agent.run.completed',
      source: 'orchestrator',
      payload: {},
      correlation_id: first.correlation_id,
      causation_id: first.event_id,
    });
    expect(second.correlation_id).toBe(first.correlation_id);
    expect(second.causation_id).toBe(first.event_id);
  });

  it('rejeita event_type fora do formato ponto.minúsculo', () => {
    expect(() =>
      createEvent({ event_type: 'Message Received', source: 'x', payload: {} }),
    ).toThrow();
    expect(() =>
      createEvent({ event_type: 'client.message.', source: 'x', payload: {} }),
    ).toThrow();
  });

  it('validateEvent rejeita envelope incompleto (ex.: sem correlation_id)', () => {
    const evt = createEvent({
      event_type: 'client.message.received',
      source: 'whatsplay',
      payload: {},
    });
    const broken = { ...evt } as Record<string, unknown>;
    delete broken.correlation_id;
    expect(isEventEnvelope(broken)).toBe(false);
    expect(() => validateEvent(broken)).toThrow();
  });

  it('validateEvent aceita envelope serializado (round-trip JSON)', () => {
    const evt = createEvent({
      event_type: 'system.health.degraded',
      source: 'worker',
      payload: { component: 'pg', detail: 'slow query' },
      priority: 5,
    });
    const restored = validateEvent(JSON.parse(JSON.stringify(evt)));
    expect(restored).toEqual(evt);
  });
});
