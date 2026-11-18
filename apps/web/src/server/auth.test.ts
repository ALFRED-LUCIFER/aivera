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

const silence = () => {
  for (const level of ['error', 'warn', 'log'] as const) vi.spyOn(console, level).mockImplementation(() => {});
};
// Production minifies Auth.js class names; the stable `type` is what survives.
const minified = (fields: object) => Object.assign(new Error('boom'), { name: 'Q' }, fields);

afterEach(() => vi.restoreAllMocks());

describe('auth logging and refusals never print personal data', () => {
  // Scenario: No personal data reaches the log (AIV-P0-926).
  // SAFETY: mutation check: removed the `logger` line from authConfig (Auth.js default logger) -> this test failed
  // SAFETY: mutation check: logged `${error.message}` instead of the code -> this test failed
  it('the logger prints only the error type, never its message, cause or details', () => {
    silence();
    const error = minified({
      message: 'Failed query: params: nadia.haddad@example.com,Nadia Haddad',
      type: 'CallbackRouteError',
      cause: { err: new Error('eyJhbGciOi token for nadia.haddad@example.com'), details: { name: 'Nadia Haddad' } },
    });
    expect(config.logger?.error).toBeTypeOf('function');
    config.logger?.error?.(error);
    expect(logged()).toBe('[auth] CallbackRouteError');
    expect(logged()).not.toMatch(PERSONAL);
    expect(config.debug).not.toBe(true);
  });

  // Scenario Outline: The log line names the Auth.js error type even when the class name is minified.
  it.each(['CallbackRouteError', 'OAuthCallbackError', 'AccessDenied', 'Configuration'])(
    'a minified %s logs its type',
    (type) => {
      silence();
      config.logger?.error?.(minified({ type }));
      expect(logged()).toBe(`[auth] ${type}`);
    },
  );

  // Scenario: An error with no known type logs a fixed fallback.
  it('an error with no Auth.js type logs UnknownAuthError', () => {
    silence();
    config.logger?.error?.(minified({}));
    expect(logged()).toBe('[auth] UnknownAuthError');
  });

  // Scenario: A type value from outside the known list is not echoed.
  // SAFETY: mutation check: echoed `error.type` without the known-list check -> this test failed
  it('a type outside the known list is not echoed', () => {
    silence();
    config.logger?.error?.(minified({ type: 'nadia.haddad@example.com' }));
    expect(logged()).toBe('[auth] UnknownAuthError');
  });

  // Scenario: Warnings keep logging their code.
  it('a warning logs its code', () => {
    silence();
    config.logger?.warn?.('debug-enabled');
    expect(logged()).toBe('[auth] debug-enabled');
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
