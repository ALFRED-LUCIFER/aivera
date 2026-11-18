import { IdentityError } from '@aivera/identity';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authConfig } from './auth';

// Scenario: A refused sign-in adds nothing (AIV-P0-009): the log line holds no email, name or token (AGENTS.md 1.2).

const upsert = vi.fn();
vi.mock('@aivera/identity/composition', () => ({ createIdentity: () => ({ upsertUserFromIdToken: upsert }) }));
vi.mock('./db', () => ({ getDb: () => ({}) }));
vi.mock('./env', () => ({ env: () => ({ auth: { issuer: 'https://tenant.aivera.example/v2.0' } }) }));

const config = authConfig({
  secret: 'x'.repeat(32),
  clientId: 'client',
  clientSecret: 'secret',
  issuer: 'https://tenant.aivera.example/v2.0',
  discovery: 'https://tenant.aivera.example/v2.0/.well-known/openid-configuration',
});
const PERSONAL = /nadia|@example\.com|Haddad|eyJ/i;
const profile = {
  iss: 'https://tenant.aivera.example/v2.0',
  sub: 'nadia-google',
  email: 'nadia@example.com',
  email_verified: false,
  name: 'Nadia Haddad',
};

function logged() {
  const lines = [vi.mocked(console.error), vi.mocked(console.warn), vi.mocked(console.log)].flatMap((spy) =>
    spy.mock.calls.map((args) => args.map(String).join(' ')),
  );
  return lines.join('\n');
}

afterEach(() => vi.restoreAllMocks());

describe('auth logging and refusals never print personal data', () => {
  // SAFETY: mutation check: removed the `logger` line from authConfig (Auth.js default logger) -> this test failed
  it('the logger prints only the error name, never its message, cause or details', () => {
    for (const level of ['error', 'warn', 'log'] as const) vi.spyOn(console, level).mockImplementation(() => {});
    const error = Object.assign(new Error('Failed query: params: nadia@example.com,Nadia Haddad'), {
      name: 'CallbackRouteError',
      cause: { err: new Error('eyJhbGciOi token for nadia@example.com') },
    });
    expect(config.logger?.error).toBeTypeOf('function');
    config.logger?.error?.(error);
    expect(logged()).toBe('[auth] CallbackRouteError');
    expect(config.debug).not.toBe(true);
  });

  it('an unverified email is refused with its code and logs nothing', async () => {
    for (const level of ['error', 'warn', 'log'] as const) vi.spyOn(console, level).mockImplementation(() => {});
    upsert.mockRejectedValueOnce(new IdentityError('unverified_email'));
    const user: { id?: string } = {};
    const result = await config.callbacks?.signIn?.({ user, profile, account: null } as never);
    expect(result).toBe('/sign-in?error=unverified_email');
    expect(user.id).toBeUndefined();
    expect(logged()).not.toMatch(PERSONAL);
  });
});
