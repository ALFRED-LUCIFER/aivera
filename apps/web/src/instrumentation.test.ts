import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from './instrumentation';

const { initTelemetry, registerPersonalDataKeys } = vi.hoisted(() => ({
  initTelemetry: vi.fn(),
  registerPersonalDataKeys: vi.fn(),
}));
vi.mock('@aivera/observability/init', () => ({ initTelemetry }));
vi.mock('@aivera/observability', () => ({ registerPersonalDataKeys }));

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
    expect(initTelemetry).not.toHaveBeenCalled();
  });

  // AIV-P0-018: Container Apps fills the connection string from Key Vault; locally it is unset and telemetry stays off.
  it('starts telemetry for the web service with the configured connection string', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('APP_ENV', 'local');
    vi.stubEnv('DATABASE_URL', 'postgres://aivera_app@localhost:5440/aivera');
    vi.stubEnv('APPLICATIONINSIGHTS_CONNECTION_STRING', 'InstrumentationKey=00000000-0000-0000-0000-000000000000');

    await register();

    expect(initTelemetry).toHaveBeenCalledWith('web', 'InstrumentationKey=00000000-0000-0000-0000-000000000000');
    expect(registerPersonalDataKeys).toHaveBeenCalledWith(expect.arrayContaining(['displayName', 'emails', 'phones']));
  });
});
