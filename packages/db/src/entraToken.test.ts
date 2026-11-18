import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb } from './client.ts';
import { entraToken } from './entraToken.ts';

const env = { IDENTITY_ENDPOINT: 'http://localhost:42356/msi/token', IDENTITY_HEADER: 'h', AZURE_CLIENT_ID: 'c1' };
const NOW = 1_800_000_000_000;
const ok = (token: string) => Response.json({ access_token: token, expires_on: String(NOW / 1000 + 3600) });

afterEach(() => vi.unstubAllGlobals());

// Order matters: the token cache is module state, so the cache-filling test runs after the failure cases.
describe('entraToken (managed identity token for PostgreSQL)', () => {
  it('refuses to guess when there is neither a password nor an identity endpoint', async () => {
    await expect(entraToken({}, NOW)).rejects.toThrow(/managed identity endpoint/);
  });

  it('rejects a malformed identity response and retries on the next call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ token: 'x' })),
    );
    await expect(entraToken(env, NOW)).rejects.toThrow('malformed');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ access_token: '', expires_on: 'soon' })),
    );
    await expect(entraToken(env, NOW)).rejects.toThrow('malformed');
  });

  it('shares one request between concurrent callers, then reuses the token until near expiry', async () => {
    const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) => ok('t1'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await Promise.all([entraToken(env, NOW), entraToken(env, NOW)])).toEqual(['t1', 't1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url?.searchParams.get('resource')).toBe('https://ossrdbms-aad.database.windows.net');
    expect(url?.searchParams.get('client_id')).toBe('c1');
    expect(init?.headers).toEqual({ 'X-IDENTITY-HEADER': 'h' });

    expect(await entraToken(env, NOW + 30 * 60_000)).toBe('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await entraToken(env, NOW + 56 * 60_000); // inside the five-minute margin: fetch a fresh one
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('createDb sign-in mode', () => {
  // SAFETY: mutation check: createDb always used the URL password (no Entra branch) -> "signs in with the token" failed
  it('signs in with the Entra token over verified TLS when the URL has no password', async () => {
    const db = createDb('postgres://aivera_app@db.example:5432/aivera');
    expect(typeof db.$client.options.pass).toBe('function');
    expect(db.$client.options.ssl).toBe('verify-full');
    await db.$client.end();
  });

  it('keeps the URL password and TLS settings when the URL has a password (local)', async () => {
    const db = createDb('postgres://aivera_app:local_dev_only@localhost:5432/aivera');
    expect(db.$client.options.pass).toBe('local_dev_only');
    expect(db.$client.options.ssl).not.toBe('verify-full');
    await db.$client.end();
  });
});
