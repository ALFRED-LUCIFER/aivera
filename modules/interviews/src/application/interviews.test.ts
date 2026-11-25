import { ForbiddenError, type Role, type WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it, vi } from 'vitest';
import type { Interview } from '../domain/interview.ts';
import type { ScorecardDraft } from '../domain/scorecard.ts';
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

const RATED: ScorecardDraft['competencies'][number] = {
  competencyId: RETRIEVAL,
  rating: 'clearly_shown',
  note: 'Walked through the set',
  questions: [],
};
const DRAFT: ScorecardDraft = { competencies: [RATED], recommendation: null };

function setup(over: Partial<Ports> = {}, rows: Interview[] = [stored()]) {
  const store = {
    insert: vi.fn<InterviewStore['insert']>(async () => undefined),
    find: vi.fn<InterviewStore['find']>(async (_w, interviewId) => rows.find((r) => r.id === interviewId) ?? null),
    moveStatus: vi.fn<InterviewStore['moveStatus']>(async () => true),
    list: vi.fn<InterviewStore['list']>(async () => rows),
    findDraft: vi.fn<InterviewStore['findDraft']>(async () => DRAFT),
    saveDraft: vi.fn<InterviewStore['saveDraft']>(async () => undefined),
    deleteAll: vi.fn<InterviewStore['deleteAll']>(async () => undefined),
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
    isSyntheticWorkspace: async () => false,
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

describe('scorecard draft (AIV-P2-004)', () => {
  const HUDA = id(3);
  const started = stored({ status: 'in_progress' });
  const closed = stored({ id: id(62), status: 'completed' });

  it('the interviewer saves their draft, stamped with who and when', async () => {
    const { useCases, store, ports } = setup({}, [started]);
    await useCases.saveScorecardDraft(ctxAs('interviewer', LINA), started.id, DRAFT);
    expect(ports.authorize).toHaveBeenCalledWith(expect.anything(), 'scorecard.submit', JOB);
    expect(store.saveDraft).toHaveBeenCalledWith({
      ...DRAFT,
      workspaceId: 'w1',
      interviewId: started.id,
      updatedBy: LINA,
      updatedAt: NOW,
    });
  });

  it('an admin who is not the interviewer saves; a recruiter or another member is refused and nothing is stored', async () => {
    const { useCases, store } = setup({}, [started]);
    await useCases.saveScorecardDraft(ctxAs('admin'), started.id, DRAFT);
    expect(store.saveDraft).toHaveBeenCalledTimes(1);
    for (const ctx of [ctxAs('recruiter'), ctxAs('interviewer', HUDA), ctxAs('hiring_owner', HUDA)])
      await expect(useCases.saveScorecardDraft(ctx, started.id, DRAFT)).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('the interviewer with no grant on the job (the job hidden from them) is refused and nothing is stored', async () => {
    const { useCases, store } = setup({ jobResource: async () => null }, [started]);
    await expect(useCases.saveScorecardDraft(ctxAs('interviewer', LINA), started.id, DRAFT)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(store.saveDraft).not.toHaveBeenCalled();
  });

  it('refuses a closed interview, a competency the interview does not test, one listed twice, and an unknown field', async () => {
    const { useCases, store } = setup({}, [started, closed]);
    const me = ctxAs('interviewer', LINA);
    await expect(useCases.saveScorecardDraft(me, closed.id, DRAFT)).rejects.toMatchObject({ code: 'scorecard_closed' });
    for (const competencies of [[{ ...RATED, competencyId: COST }], [RATED, RATED]])
      await expect(useCases.saveScorecardDraft(me, started.id, { ...DRAFT, competencies })).rejects.toMatchObject({
        code: 'competency_not_in_interview',
      });
    await expect(
      useCases.saveScorecardDraft(me, started.id, { ...DRAFT, overallScore: 4 } as ScorecardDraft),
    ).rejects.toThrow();
    await expect(useCases.saveScorecardDraft(me, id(99), DRAFT)).rejects.toMatchObject({ code: 'interview_not_found' });
    expect(store.saveDraft).not.toHaveBeenCalled();
  });

  it('the draft is read by its interviewer and admins only; a recruiter sees the interview with no draft', async () => {
    const { useCases, store } = setup({}, [started, closed]);
    expect(await useCases.getScorecard(ctxAs('interviewer', LINA), started.id)).toMatchObject({
      canEdit: true,
      draft: DRAFT,
    });
    expect(await useCases.getScorecard(ctxAs('admin'), started.id)).toMatchObject({ canEdit: true, draft: DRAFT });
    expect(await useCases.getScorecard(ctxAs('recruiter'), started.id)).toMatchObject({ canEdit: false, draft: null });
    expect(store.findDraft).toHaveBeenCalledTimes(2);
    // Completed: its interviewer still reads it, and changes nothing.
    expect(await useCases.getScorecard(ctxAs('interviewer', LINA), closed.id)).toMatchObject({ canEdit: false });
    // Another interviewer's interview is not theirs to see.
    expect(await useCases.getScorecard(ctxAs('interviewer', HUDA), started.id)).toBeNull();
  });
});
