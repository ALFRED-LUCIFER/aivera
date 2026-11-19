import { IdentityError } from '@aivera/identity';
import { decode } from 'next-auth/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authConfig, tokenMaxAge } from './auth';

// Scenario: A refused sign-in adds nothing (AIV-P0-009): the log line holds no email, name or token (AGENTS.md 1.2).

const upsert = vi.fn();
vi.mock('@aivera/identity/composition', () => ({ createIdentity: () => ({ upsertUserFromIdToken: upsert }) }));
vi.mock('./db', () => ({ getDb: () => ({}) }));
vi.mock('./env', () => ({ env: () => ({ auth: { issuer: 'https://tenant.aivera.example/v2.0' } }) }));

const settings = {
  secret: 'x'.repeat(32),
  clientId: 'client',
  clientSecret: 'secret',
  issuer: 'https://tenant.aivera.example/v2.0',
  discovery: 'https://tenant.aivera.example/v2.0/.well-known/openid-configuration',
  google: null,
};
const config = authConfig(settings);
const PERSONAL = /nadia|@example\.com|Haddad|eyJ/i;
const profile = {
  iss: 'https://tenant.aivera.example/v2.0',
  sub: 'nadia-google',
  email: 'nadia@example.com',
  email_verified: false,
  name: 'Nadia Haddad',
};

// Everything written: console calls, and the logger's JSON lines on stdout.
function raw() {
  const spies = [
    vi.mocked(console.error),
    vi.mocked(console.warn),
    vi.mocked(console.log),
    vi.mocked(process.stdout.write),
  ];
  return spies.flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(' ').trim())).filter(Boolean);
}
// Each logger line as "[area] code", anything else verbatim.
function logged() {
  return raw()
    .map((line) => {
      if (!line.startsWith('{')) return line;
      const { area, code } = JSON.parse(line) as { area: string; code: string };
      return `[${area}] ${code}`;
    })
    .join('\n');
}

const silence = () => {
  for (const level of ['error', 'warn', 'log'] as const) vi.spyOn(console, level).mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
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
    expect(raw().join('\n')).not.toMatch(PERSONAL);
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
    silence();
    upsert.mockRejectedValueOnce(new IdentityError('unverified_email'));
    const user: { id?: string } = {};
    const result = await config.callbacks?.signIn?.({ user, profile, account: null } as never);
    expect(result).toBe('/sign-in?error=unverified_email');
    expect(user.id).toBeUndefined();
    expect(raw().join('\n')).not.toMatch(PERSONAL);
  });
});

describe('ID token claims', () => {
  beforeEach(() => upsert.mockReset());

  // Scenario: An explicit email_verified false from another issuer is still not trusted.
  // SAFETY: mutation check: mapped false to undefined in idTokenClaims -> this test failed
  // SAFETY: mutation check: mapped every value except false to true (so 'false' or 0 counted as verified) -> this test failed
  it.each([false, 'false', 0])(
    'passes email_verified %j on as false and refuses as unverified_email',
    async (claim) => {
      upsert.mockRejectedValueOnce(new IdentityError('unverified_email'));
      const foreign = { ...profile, iss: 'https://login.other.aivera.example/v2.0', email_verified: claim };
      const result = await config.callbacks?.signIn?.({ user: {}, profile: foreign, account: null } as never);
      expect(result).toBe('/sign-in?error=unverified_email');
      expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ emailVerified: false }));
    },
  );

  // Scenario: A token from our tenant without email_verified signs the recruiter in (External ID never sends it).
  // SAFETY: mutation check: removed `.optional()` from email_verified in idTokenClaims -> this test failed
  it('accepts a token with no email_verified and passes it on as undefined', async () => {
    upsert.mockResolvedValueOnce({ id: 'user-1' });
    const { email_verified: _omitted, ...withoutClaim } = profile;
    const user: { id?: string } = {};
    const result = await config.callbacks?.signIn?.({ user, profile: withoutClaim, account: null } as never);
    expect(result).toBe(true);
    expect(user.id).toBe('user-1');
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ emailVerified: undefined }));
  });

  // Scenario: A token missing its email is still refused.
  it('refuses a token with no email', async () => {
    const { email: _omitted, ...withoutEmail } = profile;
    const result = await config.callbacks?.signIn?.({ user: {}, profile: withoutEmail, account: null } as never);
    expect(result).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('Continue with Google (AIV-P0-928)', () => {
  const google = { clientId: 'google-client', clientSecret: 'google-secret', issuer: undefined };

  // Scenario: Google not configured: the button opens the tenant's page as before.
  it('has only the tenant provider when Google is not configured', () => {
    const { providers } = authConfig({ ...settings, google: null });
    expect(providers.map((provider) => (typeof provider === 'function' ? provider().id : provider.id))).toEqual([
      'entra',
    ]);
  });

  // Scenario: Shared computer: Google shows the account chooser.
  // SAFETY: mutation check: removed prompt 'select_account' from the Google provider -> this test failed
  it('adds Google, asking which account every time, with PKCE, state and nonce', () => {
    const provider = authConfig({ ...settings, google }).providers[1];
    // Auth.js merges `options` over the provider's defaults when it parses the providers.
    expect(provider).toMatchObject({
      id: 'google',
      issuer: 'https://accounts.google.com',
      options: { authorization: { params: { prompt: 'select_account' } }, checks: ['pkce', 'state', 'nonce'] },
    });
  });

  // Scenario: First-time Google sign-in creates the user: Google's verified email is passed on as verified.
  it('passes a Google token on with its issuer and verified email', async () => {
    upsert.mockResolvedValueOnce({ id: 'user-2' });
    const googleProfile = { ...profile, iss: 'https://accounts.google.com', email_verified: true };
    const result = await config.callbacks?.signIn?.({ user: {}, profile: googleProfile, account: null } as never);
    expect(result).toBe(true);
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ issuer: 'https://accounts.google.com', emailVerified: true }),
    );
  });
});

// Scenario Outline: Session length follows "Keep me signed in". The real Auth.js JWT encode and decode (jose), with the
// token the sign-in callback writes and the one each later request re-issues.
describe('session length follows "Keep me signed in"', () => {
  const salt = '__Host-aivera-session';
  const issue = async (remember: boolean, token: object | null = null) => {
    const { callbacks, jwt } = authConfig(settings, remember);
    const claims = token
      ? await callbacks?.jwt?.({ token } as never)
      : await callbacks?.jwt?.({ token: {}, user: { id: 'user-1' }, account: null } as never);
    // maxAge is what Auth.js passes from `session.maxAge`; the encode override must replace it.
    const encoded = await jwt?.encode?.({ token: claims ?? {}, secret: settings.secret, salt, maxAge: 1 });
    const payload = await decode({ token: encoded ?? '', secret: settings.secret, salt });
    if (!payload?.exp || !payload.iat) throw new Error('no expiry');
    return { payload, lifetime: payload.exp - payload.iat };
  };

  // SAFETY: mutation check: dropped `remember` from the jwt callback's token -> both rows failed
  // SAFETY: mutation check: removed the jwt.encode override (Auth.js's maxAge for every token) -> both rows failed
  it.each([
    ['ticked', true, 30 * 24 * 60 * 60],
    ['unticked', false, 8 * 60 * 60],
  ])('%s: the token expires after its own length', async (_choice, remember, length) => {
    const first = await issue(remember);
    expect(first.lifetime).toBe(length);
    expect(first.payload).toMatchObject({ sub: 'user-1', remember });
    // A later request: the cookie has no remember choice of its own, the token carries it.
    const reissued = await issue(false, first.payload);
    expect(reissued.payload).toMatchObject({ sub: 'user-1', remember });
  });

  // SAFETY: mutation check: returned THIRTY_DAYS for every remembered token (rolling 30 days) -> this test failed
  it('ticked ends 30 days after sign-in however often it is used; unticked restarts its 8 hours on each request', () => {
    const signedIn = 1_000_000;
    const exp = signedIn + 30 * 24 * 60 * 60;
    const day29 = signedIn + 29 * 24 * 60 * 60;
    expect(tokenMaxAge({ remember: true, exp }, day29)).toBe(24 * 60 * 60);
    expect(tokenMaxAge({ remember: false, exp: signedIn + 8 * 60 * 60 }, signedIn + 7 * 60 * 60)).toBe(8 * 60 * 60);
  });

  it('the token holds only the user id and the choice: no email, name or provider token', async () => {
    const { payload } = await issue(true);
    expect(Object.keys(payload).toSorted()).toEqual(['exp', 'iat', 'jti', 'remember', 'sub']);
  });
});
