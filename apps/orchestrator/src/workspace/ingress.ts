import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import type { EventBus } from '../events/bus.js';

/**
 * Endpoint do workspace (F2/BLOCO 5): POST /v1/events — o nexo-workspace
 * dispara eventos (task.completed, report.updated, status mudou…) com:
 *
 *   curl -X POST http://localhost:3100/v1/events \
 *     -H "Authorization: Bearer $WORKSPACE_SERVICE_TOKEN" \
 *     -H "content-type: application/json" \
 *     -d '{"event_type":"task.completed","payload":{"task_id":"42","title":"Hero novo"},"idempotency_key":"ws:task:42:completed"}'
 *
 * Autenticação por token de serviço (env WORKSPACE_SERVICE_TOKEN — nunca em
 * log: pino redige headers.authorization). Sem token configurado → 503
 * fail-closed explícito (nunca endpoint aberto por acidente).
 */

export interface WorkspaceIngressDeps {
  bus: EventBus;
  log: Logger;
  serviceToken?: string;
}

export function createWorkspaceIngress(deps: WorkspaceIngressDeps) {
  return async function handleWorkspaceEvent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const respond = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (!deps.serviceToken) {
      deps.log.error('workspace ingress: WORKSPACE_SERVICE_TOKEN não configurado — 503 (fail-closed)');
      respond(503, { error: 'workspace_ingress_disabled', detail: 'WORKSPACE_SERVICE_TOKEN não configurado' });
      return;
    }
    const auth = req.headers.authorization ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (token !== deps.serviceToken) {
      respond(401, { error: 'unauthorized' });
      return;
    }

    const raw = await new Promise<string>((resolve, reject) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > 256 * 1024) reject(new Error('payload grande demais'));
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    let input: {
      event_type?: string;
      payload?: Record<string, unknown>;
      idempotency_key?: string;
      client_id?: string | null;
      conversation_id?: string | null;
      priority?: number;
    };
    try {
      input = JSON.parse(raw);
    } catch {
      respond(422, { error: 'json_inválido' });
      return;
    }
    if (!input.event_type || !input.payload) {
      respond(422, { error: 'event_type e payload são obrigatórios' });
      return;
    }

    const { event, duplicate } = await deps.bus.publish({
      event_type: input.event_type,
      source: 'workspace',
      client_id: input.client_id ?? null,
      conversation_id: input.conversation_id ?? null,
      priority: input.priority ?? 0,
      payload: input.payload,
      idempotency_key: input.idempotency_key,
    });
    deps.log.info({ event_type: input.event_type, event_id: event.event_id, duplicate }, 'workspace: evento ingerido');
    respond(duplicate ? 200 : 202, {
      event_id: event.event_id,
      correlation_id: event.correlation_id,
      duplicate,
    });
  };
}
