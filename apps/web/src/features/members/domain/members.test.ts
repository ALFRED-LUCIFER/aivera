import { describe, expect, it } from 'vitest';
import { acceptView } from './accept.ts';
import { jobsCell, parseInviteForm, parseManageForm, possessive } from './members.ts';

const JOB = '0190d4a2-0000-7000-9000-000000001031';
const CLIENT = '0190d4a2-0000-7000-9000-000000002031';

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields))
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  return data;
};

describe('parseInviteForm', () => {
  it('a hiring owner with a client is an invitation to that client', () => {
    expect(
      parseInviteForm(
        form({ email: ' faisal@example.com ', role: 'hiring_owner', title: 'Head of Engineering', clientIds: CLIENT }),
      ),
    ).toEqual({
      input: {
        email: 'faisal@example.com',
        role: 'hiring_owner',
        title: 'Head of Engineering',
        jobIds: [],
        clientIds: [CLIENT],
      },
    });
  });

  it('a hiring owner or interviewer with no job or client asks for jobs', () => {
    expect(parseInviteForm(form({ email: 'huda@example.com', role: 'interviewer', title: '' }))).toEqual({
      error: 'jobsRequired',
    });
  });

  it("drops the picker's choices for a recruiter, who sees every job", () => {
    const parsed = parseInviteForm(
      form({ email: 'omar.agency@example.com', role: 'recruiter', title: '', jobIds: JOB }),
    );
    expect(parsed).toMatchObject({ input: { role: 'recruiter', jobIds: [], clientIds: [] } });
  });

  it.each([
    ['a bad email', { email: 'not-an-email', role: 'recruiter', title: '' }, 'email'],
    ['an unknown role', { email: 'huda@example.com', role: 'owner', title: '' }, 'failed'],
    [
      'a job id that is not a uuid',
      { email: 'huda@example.com', role: 'interviewer', title: '', jobIds: 'x' },
      'failed',
    ],
  ])('refuses %s', (_label, fields, error) => {
    expect(parseInviteForm(form(fields))).toEqual({ error });
  });
});

describe('parseManageForm', () => {
  it('reads each change and refuses a malformed one', () => {
    expect(parseManageForm(form({ intent: 'role', userId: JOB, role: 'recruiter' }))).toEqual({
      intent: 'role',
      userId: JOB,
      role: 'recruiter',
    });
    expect(parseManageForm(form({ intent: 'jobs', userId: JOB }))).toEqual({
      intent: 'jobs',
      userId: JOB,
      jobIds: [],
      clientIds: [],
    });
    expect(parseManageForm(form({ intent: 'revoke', invitationId: 'x' }))).toBeNull();
    expect(parseManageForm(form({ intent: 'delete', userId: JOB }))).toBeNull();
  });
});

describe('the Jobs column', () => {
  const labels = { all: 'All jobs', none: 'No jobs yet' };
  it.each([
    [{ role: 'recruiter', access: [] }, 'All jobs'],
    [{ role: 'admin', access: [] }, 'All jobs'],
    [{ role: 'hiring_owner', access: ['Dune Logistics'] }, 'Dune Logistics'],
    [
      { role: 'interviewer', access: ['Staff Backend Engineer', 'Dune Logistics'] },
      'Staff Backend Engineer, Dune Logistics',
    ],
    [{ role: 'interviewer', access: [] }, 'No jobs yet'],
  ] as const)('%j shows %s', (row, cell) => {
    expect(jobsCell({ ...row, access: [...row.access] }, labels)).toBe(cell);
  });

  it('names a client possessively', () => {
    expect(possessive('Dune Logistics')).toBe("Dune Logistics'");
    expect(possessive('Falcon Pay')).toBe("Falcon Pay's");
  });
});

describe('acceptView', () => {
  const open = { state: 'open', email: 'faisal@example.com' } as const;
  it.each([
    ['no such invitation', null, null, 'invalid'],
    ['an expired one, signed in', { ...open, state: 'expired' }, 'faisal@example.com', 'invalid'],
    ['a revoked one', { ...open, state: 'revoked' }, null, 'invalid'],
    ['an accepted one', { ...open, state: 'accepted' }, null, 'invalid'],
    ['an open one, signed out', open, null, 'signIn'],
    ['an open one, signed in as someone else', open, 'huda@example.com', 'otherEmail'],
    ['an open one, signed in as the invitee in any case', open, 'Faisal@Example.com', 'join'],
  ] as const)('%s: %s', (_label, invitation, email, view) => {
    expect(acceptView(invitation, email)).toBe(view);
  });
});
