import type { Rubric } from '@credalent/jobs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queueApprovalRequest, queueDecisionEmail } from './rubricEmails.ts';

// AIV-P1-014: which email is queued, to whom and with what, in the action's transaction. Rendering is the
// notifications template tests; the jobs rules are tests/integration rubric-approval.test.ts. Synthetic cast.

const RANA = 'tariq';
const DIRECTOR = 'director';
const queueEmail = vi.fn(async () => ({ messageId: 'm1' }));
const job = { id: 'spd', title: 'Senior Product Designer', hiringOwnerUserId: DIRECTOR as string | null };
const v = (more: Partial<Rubric>): Rubric =>
  ({
    id: 'v1',
    jobId: 'spd',
    version: 1,
    revision: 0,
    status: 'awaiting_approval',
    changeNote: null,
    createdBy: RANA,
    submittedBy: RANA,
    returnNote: null,
    approvedAt: null,
    competencies: [{ name: 'Interaction design', weightPercent: 100, levelNeeded: 4 }],
    ...more,
  }) as Rubric;
let versions: Rubric[] = [];
// The hiring owner's membership row, any status; null once it is gone.
let ownerMember: { userId: string; role: string; status: string } | null = null;
// Every read gets the action's context, so none takes a second pooled connection (AIV-P2-061); the mocks have no
// pool-reading getMembership, so calling it fails the test. The contract reads on one connection: workspaces.test.ts.
// SAFETY: mutation check: getUser(id) without ctx in both emails -> the two tests asserting getUser's context failed
const getUser = vi.fn(async (id: string, _within: unknown) => ({
  id,
  email: `${id}@example.com`,
  displayName: id === RANA ? 'Tariq Recruiter' : 'Design Director',
}));

vi.mock('@/server/jobs', () => ({
  getJobs: () => ({ getJob: async () => job, listRubricVersions: async () => versions }),
}));
vi.mock('@/server/workspace', () => ({
  getWorkspaces: () => ({ listMembers: async () => (ownerMember ? [ownerMember] : []) }),
}));
vi.mock('@/server/auth', () => ({
  getIdentity: () => ({ getUser }),
}));
vi.mock('@/server/notifications', () => ({
  getNotifications: () => ({ notifications: { queueEmail }, origin: 'https://credalent.example' }),
  senderFor: async ({ userId }: { userId: string }) => ({
    name: userId === RANA ? 'Tariq Recruiter' : 'Design Director',
    shortName: 'x',
    email: `${userId}@example.com`,
    workspace: 'Demo',
  }),
}));

const ctx = (userId: string) => ({ userId, workspaceId: 'w1', role: 'recruiter', status: 'active', tx: {} }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  job.hiringOwnerUserId = DIRECTOR;
  ownerMember = { userId: DIRECTOR, role: 'hiring_owner', status: 'active' };
});

describe('Scenario: Send version 1 for approval from Add a job', () => {
  it('the Design Director receives an email with a link to the rubric version sent', async () => {
    versions = [v({})];
    const action = ctx(RANA);
    await queueApprovalRequest(action, v({}));
    expect(getUser).toHaveBeenCalledWith(DIRECTOR, action);
    expect(queueEmail).toHaveBeenCalledWith(
      { tx: {}, workspaceId: 'w1' },
      expect.objectContaining({
        template: 'rubric-approval',
        to: 'director@example.com',
        causedBy: 'v1',
        sender: expect.objectContaining({ name: 'Tariq Recruiter', email: 'tariq@example.com' }),
        data: expect.objectContaining({
          version: 1,
          changes: null,
          link: 'https://credalent.example/app/jobs/spd/rubric?version=v1&revision=0',
        }),
      }),
    );
  });

  // Scenario: A removed hiring owner is not emailed (AIV-P2-060).
  // SAFETY: mutation check: removed the membership check in queueApprovalRequest -> this test failed
  // SAFETY: mutation check: found the owner's row without `m.status === 'active'` -> this test failed (removed row emailed)
  it.each([
    ['removed from the workspace', { userId: DIRECTOR, role: 'hiring_owner', status: 'removed' }],
    ['gone from the member list', null],
    ['now an interviewer', { userId: DIRECTOR, role: 'interviewer', status: 'active' }],
  ])('a hiring owner %s is not emailed, and the sender is told an admin approves', async (_why, member) => {
    ownerMember = member;
    versions = [v({})];
    expect(await queueApprovalRequest(ctx(RANA), v({}))).toBe(false);
    expect(queueEmail).not.toHaveBeenCalled();
  });

  it('a job with no hiring owner sends nothing', async () => {
    job.hiringOwnerUserId = null;
    await queueApprovalRequest(ctx(RANA), v({}));
    expect(queueEmail).not.toHaveBeenCalled();
  });
});

describe('The decision reaches the recruiter who sent it', () => {
  it('Scenario: Return with a note: the recruiter is emailed the note', async () => {
    versions = [v({ status: 'returned', returnNote: 'Arabic NLP should be desirable' })];
    const action = ctx(DIRECTOR);
    await queueDecisionEmail(action, 'spd', 'v1');
    expect(getUser).toHaveBeenCalledWith(RANA, action);
    expect(queueEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        template: 'rubric-returned',
        to: 'tariq@example.com',
        data: expect.objectContaining({ note: 'Arabic NLP should be desirable', inForce: false }),
      }),
    );
  });

  // ADR-014: a draft approved directly was never sent, so no one is told; the creator is not emailed.
  // SAFETY: mutation check: restored the `?? version.createdBy` fallback for the recipient -> this test failed
  it('a draft another recruiter approved directly emails no one, not even its creator', async () => {
    versions = [v({ status: 'approved', submittedBy: null, approvedAt: new Date('2026-11-21T08:00:00Z') })];
    await queueDecisionEmail(ctx('colleague'), 'spd', 'v1');
    expect(queueEmail).not.toHaveBeenCalled();
  });

  it('a version of another job is refused, so a forged job id sends nothing', async () => {
    versions = [];
    await expect(queueDecisionEmail(ctx(DIRECTOR), 'other', 'v1')).rejects.toThrow('not found');
    expect(queueEmail).not.toHaveBeenCalled();
  });
});
