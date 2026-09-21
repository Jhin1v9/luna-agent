import webpush from 'web-push';

/**
 * Push PWA (§22) — Web Push com VAPID. Credenciais via env
 * (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT). Gere um par com
 * `pnpm --filter @luna/channels vapid` (script) se ainda não existir.
 * Fail-closed: sem VAPID o envio falha explicitamente; boot loga capability.
 */

export interface PushConfig {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
}

export class PushNotConfigured extends Error {
  constructor() {
    super('Push desligado: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes (fail-closed, §22).');
    this.name = 'PushNotConfigured';
  }
}

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

let vapidReady = false;

export function pushConfigured(config: PushConfig): boolean {
  return !!(config.publicKey && config.privateKey);
}

function ensureVapid(config: PushConfig): void {
  if (!pushConfigured(config)) throw new PushNotConfigured();
  if (!vapidReady) {
    webpush.setVapidDetails(config.subject ?? 'mailto:luna@nexo-digital.local', config.publicKey!, config.privateKey!);
    vapidReady = true;
  }
}

/** Injetável para testes. */
export async function sendPush(
  subscription: PushSubscription,
  payload: { title: string; body: string },
  config: PushConfig,
  senderOverride?: (sub: unknown, data: string) => Promise<unknown>,
): Promise<{ ok: boolean }> {
  ensureVapid(config);
  const sender = senderOverride ?? ((sub: unknown, data: string) => webpush.sendNotification(sub as webpush.PushSubscription, data));
  await sender(subscription, JSON.stringify(payload));
  return { ok: true };
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
