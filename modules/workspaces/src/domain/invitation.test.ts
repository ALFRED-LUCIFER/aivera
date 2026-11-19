import { describe, expect, it } from 'vitest';
import { assertAccessFitsRole, invitationExpiry, invitationState, type Invitation } from './invitation.ts';
import type { Role } from './workspace.ts';

const NOW = new Date('2026-11-20T09:00:00Z');
const invitation = (changes: Partial<Invitation> = {}): Invitation => ({
  id: 'i1',
  email: 'faisal@example.com',
  role: 'hiring_owner',
  title: null,
  jobIds: [],
  clientIds: ['client-dune'],
  invitedBy: 'u1',
  expiresAt: invitationExpiry(NOW, 7),
  acceptedAt: null,
  revokedAt: null,
  createdAt: NOW,
  ...changes,
});

describe('invitation expiry', () => {
  it('expires the given number of days after it is sent', () => {
    expect(invitationExpiry(NOW, 7).toISOString()).toBe('2026-11-27T09:00:00.000Z');
    expect(invitationExpiry(NOW, 1).toISOString()).toBe('2026-11-21T09:00:00.000Z');
  });

  it.each([
    ['open until its expiry', invitation(), new Date('2026-11-27T08:59:59Z'), 'open'],
    ['expired at its expiry', invitation(), new Date('2026-11-27T09:00:00Z'), 'expired'],
    ['revoked', invitation({ revokedAt: NOW }), NOW, 'revoked'],
    ['accepted, even once past its expiry', invitation({ acceptedAt: NOW }), new Date('2027-01-01'), 'accepted'],
  ])('%s', (_label, inv, now, state) => {
    expect(invitationState(inv, now)).toBe(state);
  });
});

describe('job access by role', () => {
  type Access = { jobIds: string[]; clientIds: string[] };
  const none: Access = { jobIds: [], clientIds: [] };
  const oneJob = { jobIds: ['job-1'], clientIds: [] };
  const oneClient = { jobIds: [], clientIds: ['client-dune'] };
  it.each<[Role, Access, string | null]>([
    ['hiring_owner', none, 'Choose the jobs this person works on.'],
    ['interviewer', none, 'Choose the jobs this person works on.'],
    ['hiring_owner', oneClient, null],
    ['interviewer', oneJob, null],
    ['admin', none, null],
    ['recruiter', none, null],
    ['recruiter', oneJob, 'Admins and recruiters see every job; they are not given jobs.'],
    ['admin', oneClient, 'Admins and recruiters see every job; they are not given jobs.'],
  ])('%s with %j: %s', (role, access, error) => {
    const check = () => assertAccessFitsRole(role, access);
    if (error) expect(check).toThrow(error);
    else expect(check).not.toThrow();
  });
});
