import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Loader das routes (contrato §4): config versionada em
 * apps/orchestrator/config/routes.json — mudar routing = commit no config,
 * sem tocar código. Validada com zod no boot (route inválida = falha
 * explícita, nunca silêncio).
 */

export const routeConfigSchema = z.object({
  destination: z.enum(['fast', 'live']),
  context_pack: z.union([z.string(), z.array(z.string())]),
  requirements: z.array(z.enum(['text', 'vision', 'tools', 'structured'])).default([]),
  allow_live_handoff: z.boolean().default(false),
  timeout_ms: z.number().int().positive().default(15_000),
  investigation_budget: z.number().int().positive().default(3),
  investigation_timeout_ms: z.number().int().positive().default(600_000),
});

export type RouteConfig = z.infer<typeof routeConfigSchema>;

export interface RouterConfig {
  routes: Record<string, RouteConfig>;
}

export function loadRouterConfig(
  path = 'C:/Users/Abner/Documents/Luna cto/luna-agent/apps/orchestrator/config/routes.json',
): RouterConfig {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { routes: Record<string, unknown> };
  const routes: Record<string, RouteConfig> = {};
  for (const [eventType, cfg] of Object.entries(raw.routes)) {
    routes[eventType] = routeConfigSchema.parse(cfg);
  }
  return { routes };
}

/** §10.3: evento sem route → default determinístico (zero IA no roteamento). */
export function routeFor(config: RouterConfig, eventType: string): { route: RouteConfig; defaulted: boolean } {
  const hit = config.routes[eventType];
  if (hit) return { route: hit, defaulted: false };
  return {
    route: routeConfigSchema.parse({
      destination: /admin|incident|code|system\./.test(eventType) ? 'live' : 'fast',
      context_pack: 'CLIENT_BASIC',
      allow_live_handoff: true,
    }),
    defaulted: true,
  };
}
