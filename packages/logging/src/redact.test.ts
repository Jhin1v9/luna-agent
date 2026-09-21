import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino, destination } from 'pino';
import { REDACT_PATHS } from './index.js';

function captureLog(record: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'luna-log-'));
  const file = join(dir, 'out.log');
  const logger = pino(
    {
      redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    },
    destination({ dest: file, sync: true }),
  );
  logger.info(record);
  return readFileSync(file, 'utf8');
}

describe('redaction de secrets no logger (§21)', () => {
  it('redige authorization em headers aninhados', () => {
    const line = captureLog({
      req: { headers: { authorization: 'Bearer sk-supersecreto', host: 'x' } },
    });
    expect(line).toContain('[REDACTED]');
    expect(line).not.toContain('sk-supersecreto');
  });

  it('redige password/token/apiKey em qualquer profundidade', () => {
    const line = captureLog({
      user: { password: 'hunter2' },
      body: { token: 'tok-123', nested: { apiKey: 'key-abc' } },
    });
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('tok-123');
    expect(line).not.toContain('key-abc');
    expect(line.match(/\[REDACTED\]/g)!.length).toBe(3);
  });

  it('preserva campos não sensíveis', () => {
    const line = captureLog({
      event_id: 'evt_1',
      message: 'hello',
      req: { headers: { host: 'api.nexo' } },
    });
    expect(line).toContain('evt_1');
    expect(line).toContain('hello');
    expect(line).toContain('api.nexo');
  });
});
