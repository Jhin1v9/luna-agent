import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Caminhos redigidos antes de persistir (§21 — secrets nunca em logs).
 * Cobre headers HTTP, bodies comuns e campos aninhados.
 */
export const REDACT_PATHS = [
  'authorization',
  '*.authorization',
  '*.*.authorization',
  '*.*.*.authorization',
  'req.headers.authorization',
  'res.headers.authorization',
  'headers.authorization',
  '*.headers.authorization',
  'password',
  '*.password',
  '*.*.password',
  '*.*.*.password',
  'body.password',
  'token',
  '*.token',
  '*.*.token',
  '*.*.*.token',
  'accessToken',
  '*.accessToken',
  '*.*.accessToken',
  'refreshToken',
  '*.refreshToken',
  '*.*.refreshToken',
  'apiKey',
  '*.apiKey',
  '*.*.apiKey',
  '*.*.*.apiKey',
  'api_key',
  '*.api_key',
  '*.*.api_key',
  'secret',
  '*.secret',
  '*.*.secret',
  '*.*.*.secret',
  'cookie',
  '*.cookie',
  '*.*.cookie',
] as const;

export interface CreateLoggerOptions {
  name: string;
  level?: string;
  pretty?: boolean;
}

export function createLogger(opts: CreateLoggerOptions): Logger {
  const options: LoggerOptions = {
    name: opts.name,
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [...REDACT_PATHS],
      censor: '[REDACTED]',
      remove: false,
    },
  };

  if (opts.pretty ?? process.env.NODE_ENV !== 'production') {
    // pino-pretty é dev-only; carregado dinamicamente para não pesar prod.
    return pino(
      options,
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (pino as unknown as { transport: (t: unknown) => unknown }).transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l' },
      }) as never,
    );
  }

  return pino(options);
}
