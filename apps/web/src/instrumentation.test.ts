import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from './instrumentation';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('server start-up (instrumentation register)', () => {
  it('exits with code 1 and logs only the names of missing variables', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('APP_ENV', 'dev');
    vi.stubEnv('COMMIT_SHA', 'value-that-must-not-be-logged');
    vi.stubEnv('DATABASE_URL', undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    await register();

    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith('Invalid configuration, missing or invalid: DATABASE_URL');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/value-that-must-not-be-logged/);
  });
});
