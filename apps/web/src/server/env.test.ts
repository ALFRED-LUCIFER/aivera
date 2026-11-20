import { describe, expect, it, vi } from 'vitest';
import { parseWebEnv } from './env';

const warn = vi.hoisted(() => vi.fn());
vi.mock('@credalent/observability', () => ({ log: { warn } }));

const valid = { APP_ENV: 'dev', DATABASE_URL: 'postgres://aivera_app@db.example:5432/aivera', COMMIT_SHA: 'abc1234' };
const missing = () => parseWebEnv({ ...valid, DATABASE_URL: undefined, COMMIT_SHA: 'secret-looking-value' });
const malformed = () => parseWebEnv({ ...valid, DATABASE_URL: 'https://user:hunter2@db.example', APP_ENV: 'staging' });

describe('parseWebEnv', () => {
  it('returns typed configuration when every variable is valid', () => {
    expect(parseWebEnv(valid)).toEqual({ ...valid, auth: null, candidateAuth: null, platformOperators: new Set() });
  });

  // SAFETY: mutation check: appended JSON.stringify(source) to the error -> both "without echoing" tests failed
  it('names a missing variable and does not print the values it did get', () => {
    expect(missing).toThrow('missing or invalid: DATABASE_URL');
    expect(missing).not.toThrow(/secret-looking-value|abc1234|dev/);
  });

  it('names a malformed variable without echoing it', () => {
    expect(malformed).toThrow(/missing or invalid: (DATABASE_URL, APP_ENV|APP_ENV, DATABASE_URL)$/);
    expect(malformed).not.toThrow(/hunter2|staging/);
  });

  it('requires COMMIT_SHA outside local and defaults it locally', () => {
    expect(() => parseWebEnv({ ...valid, COMMIT_SHA: undefined })).toThrow('missing or invalid: COMMIT_SHA');
    expect(parseWebEnv({ ...valid, APP_ENV: 'local', COMMIT_SHA: undefined }).COMMIT_SHA).toBe('local');
  });
});

const TENANT = '0190d4a2-0000-7000-8000-0000000000aa';
const auth = {
  AUTH_SECRET: 'a'.repeat(32),
  AUTH_ENTRA_TENANT_SUBDOMAIN: 'aiverarecruiters',
  AUTH_ENTRA_TENANT_ID: TENANT,
  AUTH_ENTRA_CLIENT_ID: 'client-id',
  AUTH_ENTRA_CLIENT_SECRET: 'client-secret-value',
};
const partial = () => parseWebEnv({ ...valid, ...auth, AUTH_ENTRA_TENANT_ID: undefined });
const mock = { ...auth, AUTH_ENTRA_TENANT_SUBDOMAIN: undefined, AUTH_ENTRA_TENANT_ID: undefined };

describe('parseWebEnv sign-in settings (AIV-P0-009)', () => {
  it('derives the External ID issuer and metadata address from the tenant subdomain and id', () => {
    expect(parseWebEnv({ ...valid, ...auth }).auth).toEqual({
      secret: auth.AUTH_SECRET,
      clientId: 'client-id',
      clientSecret: 'client-secret-value',
      issuer: `https://${TENANT}.ciamlogin.com/${TENANT}/v2.0`,
      discovery: `https://aiverarecruiters.ciamlogin.com/${TENANT}/v2.0/.well-known/openid-configuration`,
      google: null,
    });
  });

  it('lets local and dev run without sign-in until the tenant exists', () => {
    expect(parseWebEnv(valid).auth).toBeNull();
  });

  it('refuses a partial sign-in configuration, naming what is missing and never the secret', () => {
    expect(partial).toThrow('missing or invalid: AUTH_ENTRA_TENANT_ID');
    expect(partial).not.toThrow(/client-secret-value/);
  });

  it.each(['pilot', 'prod'])('requires sign-in in %s', (APP_ENV) => {
    expect(() => parseWebEnv({ ...valid, APP_ENV })).toThrow(/AUTH_SECRET.*AUTH_ENTRA_TENANT_ID/);
  });

  it('accepts a mocked issuer in place of the tenant only locally', () => {
    const local = parseWebEnv({ ...valid, ...mock, APP_ENV: 'local', AUTH_ENTRA_ISSUER: 'http://localhost:3299' });
    expect(local.auth).toMatchObject({
      issuer: 'http://localhost:3299',
      discovery: 'http://localhost:3299/.well-known/openid-configuration',
    });
    expect(() => parseWebEnv({ ...valid, ...auth, AUTH_ENTRA_ISSUER: 'http://localhost:3299' })).toThrow(
      'missing or invalid: AUTH_ENTRA_ISSUER',
    );
  });
});

const candidate = {
  AUTH_ENTRA_CANDIDATE_CLIENT_ID: 'candidate-id',
  AUTH_ENTRA_CANDIDATE_CLIENT_SECRET: 'candidate-secret',
};
const google = { AUTH_GOOGLE_CLIENT_ID: 'google-id', AUTH_GOOGLE_CLIENT_SECRET: 'google-secret-value' };

describe('parseWebEnv Google sign-in settings (AIV-P0-928)', () => {
  it('adds Google to the recruiter sign-in when both values are set', () => {
    expect(parseWebEnv({ ...valid, ...auth, ...google }).auth?.google).toEqual({
      clientId: 'google-id',
      clientSecret: 'google-secret-value',
      issuer: undefined,
    });
  });

  // SAFETY: mutation check: removed `google: null` from candidateAuth -> this test failed
  it('never adds Google to the candidate side', () => {
    expect(parseWebEnv({ ...valid, ...auth, ...google, ...candidate }).candidateAuth?.google).toBeNull();
  });

  it('is all or nothing, naming only what is missing and never the secret', () => {
    const halfGoogle = { ...valid, ...auth, AUTH_GOOGLE_CLIENT_SECRET: 'google-secret-value' };
    expect(() => parseWebEnv(halfGoogle)).toThrow('missing or invalid: AUTH_GOOGLE_CLIENT_ID');
    expect(() => parseWebEnv(halfGoogle)).not.toThrow(/google-secret-value/);
  });

  it('accepts a mocked Google issuer only locally', () => {
    const issuer = { AUTH_GOOGLE_ISSUER: 'http://localhost:3299' };
    expect(parseWebEnv({ ...valid, ...auth, ...google, ...issuer, APP_ENV: 'local' }).auth?.google?.issuer).toBe(
      'http://localhost:3299',
    );
    expect(() => parseWebEnv({ ...valid, ...auth, ...google, ...issuer })).toThrow(
      'missing or invalid: AUTH_GOOGLE_ISSUER',
    );
  });
});

const half = () => parseWebEnv({ ...valid, ...auth, AUTH_ENTRA_CANDIDATE_CLIENT_SECRET: 'candidate-secret' });

describe('parseWebEnv candidate sign-in settings (AIV-P0-011)', () => {
  it('uses the same tenant and session secret with the candidate app registration', () => {
    const parsed = parseWebEnv({ ...valid, ...auth, ...candidate });
    expect(parsed.candidateAuth).toEqual({
      ...parsed.auth,
      clientId: 'candidate-id',
      clientSecret: 'candidate-secret',
      google: null,
    });
  });

  it('runs without candidate sign-in while the recruiter side is configured', () => {
    expect(parseWebEnv({ ...valid, ...auth }).candidateAuth).toBeNull();
  });

  it('is all or nothing, naming only what is missing and never the secret', () => {
    expect(half).toThrow(/missing or invalid: AUTH_ENTRA_CANDIDATE_CLIENT_ID$/);
    expect(half).not.toThrow(/candidate-secret/);
  });

  it('needs the tenant and session secret it shares with the recruiter side', () => {
    expect(() => parseWebEnv({ ...valid, ...candidate })).toThrow(/AUTH_SECRET.*AUTH_ENTRA_TENANT_ID$/);
  });
});

// AIV-P2-035 Background and "The console fails closed without a valid operator list" (ADR-012). Synthetic operators.
const operators = (value: string | undefined) =>
  parseWebEnv({ ...valid, PLATFORM_OPERATOR_EMAILS: value }).platformOperators;

describe('PLATFORM_OPERATOR_EMAILS', () => {
  it('holds each listed email lower-cased and trimmed', () => {
    expect(operators('pia.platform@example.com, Theo.Platform@example.com')).toEqual(
      new Set(['pia.platform@example.com', 'theo.platform@example.com']),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: piped the list into z.array(z.string()) instead of z.array(z.email()).min(1) -> the malformed,
  // bad-entry and trailing-comma cases failed
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '  '],
    ['malformed', 'not-an-email,,'],
    ['one bad entry among good ones', 'pia.platform@example.com,theo.platform'],
    ['a trailing comma', 'pia.platform@example.com,'],
  ])('%s means nobody is an operator, and the app still starts', (_case, value) => {
    expect(operators(value)).toEqual(new Set());
  });

  it('logs an invalid list without its value', () => {
    warn.mockClear();
    operators('pia.platform@example.com,theo.platform');
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).toContain('platform operator config invalid');
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/pia|theo/);
  });
});
