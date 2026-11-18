import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env';

const valid = { APP_ENV: 'dev', DATABASE_URL: 'postgres://aivera_app@db.example:5432/aivera', COMMIT_SHA: 'abc1234' };
const missing = () => parseWebEnv({ ...valid, DATABASE_URL: undefined, COMMIT_SHA: 'secret-looking-value' });
const malformed = () => parseWebEnv({ ...valid, DATABASE_URL: 'https://user:hunter2@db.example', APP_ENV: 'staging' });

describe('parseWebEnv', () => {
  it('returns typed configuration when every variable is valid', () => {
    expect(parseWebEnv(valid)).toEqual({ ...valid, auth: null });
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
