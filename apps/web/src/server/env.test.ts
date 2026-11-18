import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env';

const valid = { APP_ENV: 'dev', DATABASE_URL: 'postgres://aivera_app@db.example:5432/aivera', COMMIT_SHA: 'abc1234' };
const missing = () => parseWebEnv({ ...valid, DATABASE_URL: undefined, COMMIT_SHA: 'secret-looking-value' });
const malformed = () => parseWebEnv({ ...valid, DATABASE_URL: 'https://user:hunter2@db.example', APP_ENV: 'staging' });

describe('parseWebEnv', () => {
  it('returns typed configuration when every variable is valid', () => {
    expect(parseWebEnv(valid)).toEqual(valid);
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
