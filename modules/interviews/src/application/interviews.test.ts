import { ForbiddenError, type Role, type WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it, vi } from 'vitest';
import type { Interview } from '../domain/interview.ts';
import { interviewUseCases, type InterviewStore, type Ports } from './interviews.ts';

// AIV-P2-001: the interview use cases over faked ports; the database scenarios are in
// tests/integration/src/interviews.test.ts. Synthetic cast and opaque ids only.
const id = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const AYESHA = id(1); // recruiter
const LINA = id(2); // interviewer on the job
const JOB = { jobId: id(10), clientId: null };
const APPLICATION = id(20);
const DANIEL = id(30);
const RETRIEVAL = id(40);
const COST = id(41);
const RUBRIC = { id: id(50), competencies: [{ id: RETRIEVAL }, { id: COST }] };
const NOW = new Date('2026-11-18T05:00:00.000Z');
const ctxAs = (role: Role, userId = AYESHA) => ({ workspaceId: 'w1', userId, role, tx: {} }) as WorkspaceContext;

const stored = (over: Partial<Interview> = {}): Interview => ({
  id: id(60),
  workspaceId: 'w1',
  applicationId: APPLICATION,
  jobId: JOB.jobId,
  candidateId: DANIEL,
  round: 'structured_screen',
  interviewerUserId: LINA,
  scheduledAt: new Date('2026-11-18T10:00:00.000Z'),
  status: 'scheduled',
  rubricVersionId: RUBRIC.id,
  competencyIds: [RETRIEVAL],
  createdBy: AYESHA,
  createdAt: NOW,
  ...over,
});

function setup(over: Partial<Ports> = {}, rows: Interview[] = [stored()]) {
  const store = {
    insert: vi.fn<InterviewStore['insert']>(async () => undefined),
    find: vi.fn<InterviewStore['find']>(async (_w, interviewId) => rows.find((r) => r.id === interviewId) ?? null),
    moveStatus: vi.fn<InterviewStore['moveStatus']>(async () => true),
    list: vi.fn<InterviewStore['list']>(async () => rows),
  };
  const ports: Ports = {
    storeFor: () => store,
    publishInterviewScheduled: vi.fn(async () => undefined),
    authorize: vi.fn(async () => undefined),
    jobResource: async (_ctx, jobId) => (jobId === JOB.jobId ? JOB : null),
    findApplication: async (_tx, _w, applicationId) =>
      applicationId === APPLICATION ? { personId: DANIEL, jobId: JOB.jobId } : null,
    approvedRubric: async () => RUBRIC,
    canInterview: async (_ctx, userId) => userId === LINA || userId === AYESHA,
    newId: () => id(61),
    now: () => NOW,
    ...over,
  };
  return { useCases: interviewUseCases(ports), store, ports };
}

const round1 = (over: Record<string, unknown> = {}) => ({
  applicationId: APPLICATION,
  round: 'structured_screen' as const,
  interviewerUserId: AYESHA,
  scheduledAt: new Date('2026-11-18T10:00:00.000Z'),
  competencyIds: [RETRIEVAL, COST],
  ...over,
});

describe('createInterview', () => {
  it('a timed interview is scheduled, from the stored application, and announced', async () => {
    const { useCases, store, ports } = setup();
    expect(await useCases.createInterview(ctxAs('recruiter'), round1())).toEqual({ interviewId: id(61) });
    const written = store.insert.mock.calls[0]?.[0];
    expect(written).toMatchObject({
      jobId: JOB.jobId,
      candidateId: DANIEL,
      status: 'scheduled',
      rubricVersionId: RUBRIC.id,
      competencyIds: [RETRIEVAL, COST],
      createdBy: AYESHA,
    });
    expect(ports.authorize).toHaveBeenCalledWith(ctxAs('recruiter'), 'interview.schedule', JOB);
    expect(ports.publishInterviewScheduled).toHaveBeenCalledWith({}, written);
  });

  it('with no time it is "to_schedule" and announces nothing (owner decision, 24 Nov 2026)', async () => {
    const { useCases, store, ports } = setup();
    await useCases.createInterview(ctxAs('recruiter'), round1({ scheduledAt: undefined, competencyIds: [COST, COST] }));
    expect(store.insert.mock.calls[0]?.[0]).toMatchObject({
      status: 'to_schedule',
      scheduledAt: null,
      competencyIds: [COST],
    });
    expect(ports.publishInterviewScheduled).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed the competency check from createInterview -> this test failed (interview stored)
  it('a competency not in the approved version is refused and nothing is stored', async () => {
    const { useCases, store } = setup();
    await expect(
      useCases.createInterview(ctxAs('recruiter'), round1({ competencyIds: [RETRIEVAL, id(99)] })),
    ).rejects.toThrow("This competency is not in the job's approved rubric");
    expect(store.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['no approved rubric', { approvedRubric: async () => null }, round1(), 'rubric_not_approved'],
    ['an unknown application', {}, round1({ applicationId: id(98) }), 'application_not_found'],
    ['a job the context cannot see', { jobResource: async () => null }, round1(), 'application_not_found'],
    ['an interviewer who cannot see the job', {}, round1({ interviewerUserId: id(97) }), 'interviewer_not_on_job'],
  ] as const)('%s: refused (%s) and nothing is stored', async (_label, over, input, code) => {
    const { useCases, store, ports } = setup(over);
    await expect(useCases.createInterview(ctxAs('recruiter'), input)).rejects.toMatchObject({ code });
    expect(store.insert).not.toHaveBeenCalled();
    expect(ports.publishInterviewScheduled).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed authorize(ctx, 'interview.schedule', job) -> this test failed (rubric read, stored)
  it('a refused interview.schedule reads no rubric and stores nothing', async () => {
    const approvedRubric = vi.fn(async () => RUBRIC);
    const { useCases, store } = setup({ authorize: async () => Promise.reject(new ForbiddenError()), approvedRubric });
    await expect(useCases.createInterview(ctxAs('interviewer', LINA), round1())).rejects.toThrow(ForbiddenError);
    expect(approvedRubric).not.toHaveBeenCalled();
    expect(store.insert).not.toHaveBeenCalled();
  });

  it('a malformed input is refused before anything is read', async () => {
    const { useCases, store } = setup();
    await expect(useCases.createInterview(ctxAs('recruiter'), round1({ round: 'final' }))).rejects.toThrow();
    expect(store.insert).not.toHaveBeenCalled();
  });
});

describe('startInterview', () => {
  it('a recruiter starts a scheduled interview, moving it only from the status it read', async () => {
    const { useCases, store } = setup();
    await useCases.startInterview(ctxAs('recruiter'), id(60));
    expect(store.moveStatus).toHaveBeenCalledWith('w1', id(60), 'scheduled', 'in_progress');
  });

  it('an interview whose time passed (scorecard due) can still be started', async () => {
    const { useCases, store } = setup({}, [stored({ scheduledAt: new Date('2026-11-16T06:00:00.000Z') })]);
    await useCases.startInterview(ctxAs('interviewer', LINA), id(60));
    expect(store.moveStatus).toHaveBeenCalledWith('w1', id(60), 'scheduled', 'in_progress');
  });

  // SAFETY: mutation check: removed the "interviews they hold" check from startInterview -> this test failed (moved)
  it("a hiring owner on the job cannot start someone else's interview", async () => {
    const { useCases, store } = setup();
    await expect(useCases.startInterview(ctxAs('hiring_owner'), id(60))).rejects.toThrow(ForbiddenError);
    expect(store.moveStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['completed', stored({ status: 'completed' }), 'status_move'],
    ['cancelled', stored({ status: 'cancelled' }), 'status_move'],
  ] as const)('a %s interview is refused', async (_label, row, code) => {
    const { useCases } = setup({}, [row]);
    await expect(useCases.startInterview(ctxAs('recruiter'), id(60))).rejects.toMatchObject({ code });
  });

  it('a concurrent move that got there first is refused', async () => {
    const { useCases, store } = setup();
    store.moveStatus.mockResolvedValueOnce(false);
    await expect(useCases.startInterview(ctxAs('recruiter'), id(60))).rejects.toMatchObject({ code: 'status_move' });
  });

  it("another interviewer's interview is not found for an interviewer", async () => {
    const { useCases } = setup({}, [stored({ interviewerUserId: AYESHA })]);
    await expect(useCases.startInterview(ctxAs('interviewer', LINA), id(60))).rejects.toMatchObject({
      code: 'interview_not_found',
    });
  });
});

describe('listInterviews and getInterview', () => {
  it('shows the status at now and drops interviews on a job the context cannot see', async () => {
    const hidden = stored({ id: id(62), jobId: id(11) });
    const due = stored({ id: id(63), scheduledAt: new Date('2026-11-16T06:00:00.000Z') });
    const { useCases, store } = setup({}, [due, hidden]);
    const listed = await useCases.listInterviews(ctxAs('hiring_owner'), 'ongoing');
    expect(listed.map((i) => [i.id, i.status])).toEqual([[id(63), 'scorecard_due']]);
    expect(store.list).toHaveBeenCalledWith(
      'w1',
      ['to_schedule', 'scheduled', 'in_progress', 'scorecard_due'],
      undefined,
    );
  });

  // SAFETY: mutation check: made ownOnly return false -> this test failed (no interviewer filter)
  it('an interviewer lists only their own interviews', async () => {
    const { useCases, store } = setup();
    await useCases.listInterviews(ctxAs('interviewer', LINA), 'completed');
    expect(store.list).toHaveBeenCalledWith('w1', ['completed'], LINA);
  });

  it('getInterview is null for an interview on a job the context cannot see', async () => {
    const { useCases } = setup({ jobResource: async () => null });
    expect(await useCases.getInterview(ctxAs('hiring_owner'), id(60))).toBeNull();
  });
});
