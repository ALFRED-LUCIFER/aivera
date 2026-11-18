import { afterEach, describe, expect, it, vi } from 'vitest';
import { entraToken } from './entraToken.ts';

const env = { IDENTITY_ENDPOINT: 'http://localhost:42356/msi/token', IDENTITY_HEADER: 'h', AZURE_CLIENT_ID: 'c1' };
const NOW = 1_800_000_000_000;

afterEach(() => vi.unstubAllGlobals());

describe('entraToken (managed identity token for PostgreSQL)', () => {
  it('refuses to guess when there is neither a password nor an identity endpoint', async () => {
    await expect(entraToken({}, NOW)).rejects.toThrow(/managed identity endpoint/);
  });

  it('asks for the PostgreSQL resource as the chosen identity, then reuses the token until near expiry', async () => {
    const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) =>
      Response.json({ access_token: 't1', expires_on: String(NOW / 1000 + 3600) }),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await entraToken(env, NOW)).toBe('t1');
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
