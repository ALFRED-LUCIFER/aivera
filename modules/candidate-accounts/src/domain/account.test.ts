import { describe, expect, it } from 'vitest';
import {
  CandidateAccountError,
  checkLinkConsent,
  checkNewConsent,
  isSignedUp,
  signUpName,
  withdrawalAt,
  type CandidateAccountErrorCode,
  type Consent,
} from './account.ts';

const WS = '0190d4a2-0000-7000-8000-000000000001';
const JOB = '0190d4a2-0000-7000-8000-000000000101';
const NOW = new Date('2026-11-19T09:00:00.000Z');
const consent: Consent = {
  id: '0190d4a2-0000-7000-8000-000000000201',
  accountId: '0190d4a2-0000-7000-8000-000000000301',
  purpose: 'apply_to_job',
  workspaceId: WS,
  jobId: JOB,
  grantedAt: NOW,
  textVersion: 'apply-v1',
  withdrawnAt: null,
};
const refused = (code: CandidateAccountErrorCode) => new CandidateAccountError(code);

describe('a new consent', () => {
  it('needs a text version', () => {
    expect(() => checkNewConsent({ ...consent, textVersion: ' ' })).toThrow(refused('text_version'));
  });

  it.each([
    ['apply_to_job', WS, JOB, true],
    ['answer_evidence_request', WS, JOB, true],
    ['cv_check', null, null, true],
    ['apply_to_job', WS, null, false],
    ['apply_to_job', null, null, false],
    ['cv_check', WS, null, false],
    ['cv_check', null, JOB, false],
  ] as const)('%s with workspace %s and job %s is valid: %s', (purpose, workspaceId, jobId, valid) => {
    const check = () => checkNewConsent({ purpose, workspaceId, jobId, textVersion: 'v1' });
    if (valid) expect(check).not.toThrow();
    else expect(check).toThrow(refused('consent_target'));
  });
});

describe('withdrawing', () => {
  it('records the time once; a second withdrawal is refused', () => {
    expect(withdrawalAt(consent, NOW)).toBe(NOW);
    expect(() => withdrawalAt({ ...consent, withdrawnAt: NOW }, NOW)).toThrow(refused('already_withdrawn'));
  });
});

describe('a workspace link needs an open consent', () => {
  it('an open consent for the workspace and purpose allows it', () => {
    expect(() => checkLinkConsent(consent, WS, 'applied')).not.toThrow();
  });

  it.each<[string, Consent | null, string, 'applied' | 'answered_evidence_request']>([
    ['no consent', null, WS, 'applied'],
    ['a withdrawn consent', { ...consent, withdrawnAt: NOW }, WS, 'applied'],
    ['a consent for another workspace', consent, '0190d4a2-0000-7000-8000-000000000002', 'applied'],
    ['a consent for another purpose', consent, WS, 'answered_evidence_request'],
  ])('%s refuses it', (_, c, workspaceId, reason) => {
    expect(() => checkLinkConsent(c, workspaceId, reason)).toThrow(refused('consent_required'));
  });
});

describe('sign-up (AIV-P3-007)', () => {
  it('stores the full name trimmed and refuses a blank one', () => {
    expect(signUpName('  Layla Haddad ')).toBe('Layla Haddad');
    expect(() => signUpName('   ')).toThrow(refused('full_name'));
  });

  it('counts an account as signed up only with both full name and work type', () => {
    expect(isSignedUp({ fullName: null, workType: null })).toBe(false);
    expect(isSignedUp({ fullName: 'Layla Haddad', workType: null })).toBe(false);
    expect(isSignedUp({ fullName: 'Layla Haddad', workType: 'ai_llm_engineering' })).toBe(true);
  });
});
