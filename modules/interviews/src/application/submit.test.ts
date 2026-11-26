import { ForbiddenError, type Role, type WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it, vi } from 'vitest';
import type { Interview } from '../domain/interview.ts';
import type { ScorecardDraft } from '../domain/scorecard.ts';
import type { InterviewStore } from './interviews.ts';
import { submitUseCases, type SubmitPorts } from './submit.ts';

// AIV-P2-006: the scorecard submit over faked ports, in the order it writes; the database scenarios (one transaction,
// rollback, double submit, RLS) are in tests/integration/src/submit-scorecard.test.ts. Synthetic cast, opaque ids.
const id = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const LINA = id(2); // the interviewer
const NOOR = id(3); // another interviewer
const JOB = { jobId: id(10), clientId: null };
const DANIEL = id(30);
const RETRIEVAL = id(40);
const COST = id(41);
const RUBRIC = {
  id: id(50),
  competencies: [
    { id: RETRIEVAL, name: 'Retrieval and evaluation', evidenceExpected: '', levelNeeded: 3 },
    { id: COST, name: 'Cost and reliability', evidenceExpected: '', levelNeeded: 3 },
  ],
};
const NOW = new Date('2026-11-26T09:00:00.000Z');
const NOTE = 'Walked through the 200-question set he built';
const ASKED = ['In the March incident, what did you do in the first thirty minutes?'];
const ctxAs = (role: Role, userId = LINA) => ({ workspaceId: 'w1', userId, role, tx: {} }) as WorkspaceContext;

const interview = (over: Partial<Interview> = {}): Interview => ({
  id: id(60),
  workspaceId: 'w1',
  applicationId: id(20),
  jobId: JOB.jobId,
  candidateId: DANIEL,
  round: 'structured_screen',
  interviewerUserId: LINA,
  scheduledAt: null,
  status: 'in_progress',
  rubricVersionId: RUBRIC.id,
  competencyIds: [RETRIEVAL, COST],
  createdBy: id(1),
  createdAt: NOW,
  ...over,
});

/** Retrieval rated Clearly shown with a note; Cost and reliability "Not assessed in this round" (its question not asked). */
const DRAFT: ScorecardDraft = {
  competencies: [
    { competencyId: RETRIEVAL, rating: 'clearly_shown', note: ` ${NOTE} `, questions: [{ text: '', mark: null }] },
    { competencyId: COST, rating: 'partly_shown', note: '', questions: [{ text: ASKED[0] ?? '', mark: 'not_asked' }] },
  ],
  recommendation: 'not_recommended',
};

function setup(over: Partial<SubmitPorts> = {}, row = interview(), draft: ScorecardDraft | null = DRAFT) {
  const calls: string[] = [];
  const store = {
    find: vi.fn<InterviewStore['find']>(async () => row),
    findDraft: vi.fn<InterviewStore['findDraft']>(async () => draft),
    moveStatus: vi.fn<InterviewStore['moveStatus']>(async () => (calls.push('complete'), true)),
    saveDraft: vi.fn<InterviewStore['saveDraft']>(async () => void calls.push('store scorecard')),
  } as unknown as InterviewStore;
  const ports = {
    storeFor: () => store,
    authorize: vi.fn(async () => undefined),
    jobResource: async (_ctx: WorkspaceContext, jobId: string) => (jobId === JOB.jobId ? JOB : null),
    isSyntheticWorkspace: async () => true,
    now: () => NOW,
    rubric: async () => RUBRIC,
    latestAssessment: async () => ({ id: id(70) }),
    suggestedQuestions: async () => [{ competencyId: COST, questions: ASKED }],
    publishInterviewCompleted: vi.fn(async () => void calls.push('InterviewCompleted.v1')),
    recordScorecardEvidence: vi.fn<SubmitPorts['recordScorecardEvidence']>(async () => {
      calls.push('evidence');
      return { itemIds: [id(80)] };
    }),
    applyScoreChange: vi.fn<SubmitPorts['applyScoreChange']>(async () => {
      calls.push('apply and audit');
      return { id: id(71) };
    }),
    ...over,
  } satisfies SubmitPorts;
  return { submit: submitUseCases(ports).submitScorecard, store, ports, calls };
}

describe('Scenario: Submitting applies the change', () => {
  it('completes the interview, stores the scorecard, records the note as evidence, then applies and audits last', async () => {
    const { submit, store, ports, calls } = setup();
    expect(await submit(ctxAs('interviewer'), id(60), { previewId: 'p1' })).toEqual({ updated: true });
    expect(calls).toEqual(['complete', 'store scorecard', 'InterviewCompleted.v1', 'evidence', 'apply and audit']);
    expect(store.moveStatus).toHaveBeenCalledWith('w1', id(60), 'in_progress', 'completed');
    expect(ports.authorize).toHaveBeenCalledWith(ctxAs('interviewer'), 'scorecard.submit', JOB);
    expect(ports.recordScorecardEvidence).toHaveBeenCalledWith(ctxAs('interviewer'), {
      candidateId: DANIEL,
      jobId: JOB.jobId,
      writtenAt: NOW,
      from: 'scorecard',
      items: [{ competencyId: RETRIEVAL, excerpt: NOTE, strength: 'medium', level: 3 }],
      synthetic: true,
    });
    expect(ports.applyScoreChange).toHaveBeenCalledWith(ctxAs('interviewer'), {
      assessmentId: id(70),
      interviewId: id(60),
      changes: [{ competencyId: RETRIEVAL, rating: 'clearly_shown' }],
      previewId: 'p1',
      reason: NOTE,
      reasons: { [RETRIEVAL]: NOTE },
      idempotencyKey: id(60),
      writeUpItemIds: [id(80)],
    });
  });

  it("a Not shown or Partly shown note is the interviewer's word as Claim only, at no level", async () => {
    const draft: ScorecardDraft = {
      ...DRAFT,
      competencies: [
        { competencyId: RETRIEVAL, rating: 'not_shown', note: 'Could not say how 71% was measured', questions: [] },
        { competencyId: COST, rating: 'partly_shown', note: 'Explained the fix only', questions: [] },
      ],
    };
    const { submit, ports } = setup({ suggestedQuestions: async () => [] }, interview(), draft);
    await submit(ctxAs('interviewer'), id(60), { previewId: 'p1' });
    expect(vi.mocked(ports.recordScorecardEvidence).mock.calls[0]?.[1].items.map((i) => [i.strength, i.level])).toEqual(
      [
        ['claim', 0],
        ['claim', 0],
      ],
    );
  });
});

describe('Scenario: A competency not assessed in this round stays a gap', () => {
  // SAFETY: mutation check: applied every rated competency (`c.rating` instead of `assessedRatings`) -> this test
  // failed (Cost and reliability, rated Partly shown before its question was marked Not asked, reached the apply).
  it('has no evidence, no change and no reason: only the rated competency is applied', async () => {
    const { submit, ports } = setup();
    await submit(ctxAs('interviewer'), id(60), { previewId: 'p1' });
    expect(vi.mocked(ports.applyScoreChange).mock.calls[0]?.[1].changes.map((c) => c.competencyId)).toEqual([
      RETRIEVAL,
    ]);
    expect(vi.mocked(ports.recordScorecardEvidence).mock.calls[0]?.[1].items.map((i) => i.competencyId)).toEqual([
      RETRIEVAL,
    ]);
  });

  it('with every competency not assessed it completes the interview and changes no score', async () => {
    const draft: ScorecardDraft = {
      ...DRAFT,
      competencies: [{ ...(DRAFT.competencies[1] as ScorecardDraft['competencies'][number]) }],
    };
    const { submit, ports, calls } = setup({}, interview({ competencyIds: [COST] }), draft);
    expect(await submit(ctxAs('interviewer'), id(60), { previewId: null })).toEqual({ updated: false });
    expect(calls).toEqual(['complete', 'store scorecard', 'InterviewCompleted.v1']);
    expect(ports.applyScoreChange).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: rebuilt the draft on its own stored questions instead of `suggestedQuestions` -> this test
  // failed (the made-up question left Cost and reliability "not assessed" and the submit went through).
  it('is judged on the questions the page shows, never on questions a request made up', async () => {
    const draft: ScorecardDraft = {
      ...DRAFT,
      competencies: [
        DRAFT.competencies[0] as ScorecardDraft['competencies'][number],
        { competencyId: COST, rating: null, note: '', questions: [{ text: 'A made-up question', mark: 'not_asked' }] },
      ],
    };
    const { submit, ports } = setup({}, interview(), draft);
    await expect(submit(ctxAs('interviewer'), id(60), { previewId: 'p1' })).rejects.toMatchObject({
      code: 'scorecard_incomplete',
    });
    expect(ports.applyScoreChange).not.toHaveBeenCalled();
  });
});

describe('refusals write nothing', () => {
  it.each([
    ['a competency neither rated nor marked', { competencyId: COST, rating: null, note: '', questions: [] }],
    ['a rating with no note', { competencyId: COST, rating: 'partly_shown' as const, note: '  ', questions: [] }],
  ])('%s is "scorecard_incomplete"', async (_case, cost) => {
    const draft = { ...DRAFT, competencies: [DRAFT.competencies[0], cost] } as ScorecardDraft;
    const { submit, calls } = setup({ suggestedQuestions: async () => [] }, interview(), draft);
    await expect(submit(ctxAs('interviewer'), id(60), { previewId: 'p1' })).rejects.toMatchObject({
      code: 'scorecard_incomplete',
    });
    expect(calls).toEqual([]);
  });

  it.each([
    ['completed', interview({ status: 'completed' }), 'scorecard_submitted'],
    ['cancelled', interview({ status: 'cancelled' }), 'scorecard_closed'],
    [
      'scheduled ahead',
      interview({ status: 'scheduled', scheduledAt: new Date('2026-11-27T09:00:00Z') }),
      'interview_not_held',
    ],
  ])('%s: "%s"', async (_case, row, code) => {
    const { submit, calls } = setup({}, row);
    await expect(submit(ctxAs('interviewer'), id(60), { previewId: 'p1' })).rejects.toMatchObject({ code });
    expect(calls).toEqual([]);
  });

  it('a double submit losing the race to complete the interview is "Already submitted"', async () => {
    const { submit, store, ports } = setup();
    vi.mocked(store.moveStatus).mockResolvedValue(false);
    await expect(submit(ctxAs('interviewer'), id(60), { previewId: 'p1' })).rejects.toThrow('Already submitted');
    expect(ports.applyScoreChange).not.toHaveBeenCalled();
  });

  it('ratings with no preview are refused: the person applies only what they saw', async () => {
    const { submit, calls } = setup();
    await expect(submit(ctxAs('interviewer'), id(60), { previewId: null })).rejects.toMatchObject({
      code: 'preview_changed',
    });
    expect(calls).toEqual([]);
  });

  it('the assessment\'s refusal is "preview again"', async () => {
    const refused = Object.assign(new Error('stale'), { name: 'ScoreChangeError' });
    const { submit } = setup({ applyScoreChange: vi.fn(async () => Promise.reject(refused)) });
    await expect(submit(ctxAs('interviewer'), id(60), { previewId: 'p1' })).rejects.toMatchObject({
      code: 'preview_changed',
    });
  });

  // SAFETY: mutation check: `scorecardHolder` let any member hold the scorecard -> this test failed (it applied).
  it('another interviewer on the job is refused', async () => {
    const { submit, calls } = setup();
    await expect(submit(ctxAs('interviewer', NOOR), id(60), { previewId: 'p1' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(calls).toEqual([]);
  });
});
