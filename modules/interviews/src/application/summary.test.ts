import { ForbiddenError, type Role, type WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it, vi } from 'vitest';
import type { Interview } from '../domain/interview.ts';
import type { MeetingSummary, Proposal } from '../domain/summary.ts';
import {
  analyseSummary,
  summaryUseCases,
  type AnalysisPorts,
  type DecisionPorts,
  type ScorePreview,
  type SummaryPorts,
  type SummaryStore,
} from './summary.ts';

// AIV-P1-115: the meeting-summary use cases over faked ports; the database scenarios are in
// tests/integration/src/meeting-summary.test.ts. Synthetic cast and opaque ids only.
const id = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const AYESHA = id(1); // recruiter on the job
const LINA = id(2); // the interview's interviewer
const NOOR = id(3); // another interviewer
const HASSAN = id(4); // the job's hiring owner
const JOB = { jobId: id(10), clientId: null };
const DANIEL = id(30);
const [RETRIEVAL, COST] = [id(40), id(41)] as const;
const RUBRIC = {
  id: id(50),
  competencies: [
    { id: RETRIEVAL, name: 'Retrieval and evaluation', evidenceExpected: 'Eval sets.', levelNeeded: 4 },
    { id: COST, name: 'Cost and reliability', evidenceExpected: 'Latency and cost numbers.', levelNeeded: 2 },
  ],
};
const INTERVIEW: Interview = {
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
  createdBy: AYESHA,
  createdAt: new Date('2026-11-20T08:00:00.000Z'),
};
const NOW = new Date('2026-11-24T09:00:00.000Z');
const TEXT = 'Daniel walked through the 200-question evaluation set he built and showed how answers were graded.';
const QUOTE = 'walked through the 200-question evaluation set he built';
const ctxAs = (role: Role, userId = AYESHA) => ({ workspaceId: 'w1', userId, role, tx: {} }) as WorkspaceContext;

const PREVIEW: ScorePreview = {
  previewId: 'p-1',
  backedScore: { from: 55, to: 71 },
  changes: [
    {
      competencyId: RETRIEVAL,
      from: { strength: 'supporting', provenLevel: 0 },
      to: { strength: 'medium', provenLevel: 4 },
      replaces: null,
    },
  ],
};

function setup(interview = INTERVIEW) {
  const summaries: MeetingSummary[] = [];
  const proposals = new Map<string, Proposal[]>();
  const calls: string[] = [];
  const store: SummaryStore = {
    insert: async (summary) => void summaries.push(summary),
    find: async (_w, summaryId) => summaries.find((s) => s.id === summaryId) ?? null,
    latest: async (_w, interviewId) => summaries.findLast((s) => s.interviewId === interviewId) ?? null,
    async move(_w, summaryId, from, to, promptVersion) {
      const summary = summaries.find((s) => s.id === summaryId);
      if (!summary || !from.includes(summary.status)) return false;
      calls.push(`status:${to}`);
      Object.assign(summary, { status: to, ...(promptVersion && { promptVersion }) });
      return true;
    },
    insertProposals: async (_w, summaryId, rows) => void proposals.set(summaryId, [...rows]),
    proposals: async (_w, summaryId) => proposals.get(summaryId) ?? [],
    async markProposals(_w, summaryId, status, ids, others = false) {
      for (const p of proposals.get(summaryId) ?? []) if (ids.includes(p.competencyId) !== others) p.status = status;
    },
    appliedCompetencies: async (_w, interviewId) =>
      summaries
        .filter((s) => s.interviewId === interviewId)
        .flatMap((s) => (proposals.get(s.id) ?? []).filter((p) => p.status === 'applied'))
        .map((p) => p.competencyId),
  };
  let next = 70;
  const clock = { now: NOW };
  const shared = {
    storeFor: () => ({
      find: async (_w: string, interviewId: string) => (interviewId === interview.id ? interview : null),
    }),
    summariesFor: () => store,
    rubric: async () => RUBRIC,
    unusualSpans: () => [],
    now: () => clock.now,
  } as unknown as Pick<SummaryPorts, 'storeFor' | 'summariesFor' | 'rubric' | 'unusualSpans' | 'now'>;
  const decisions = {
    latestAssessment: vi.fn<DecisionPorts['latestAssessment']>(async () => ({ id: id(90) })),
    previewScoreChange: vi.fn<DecisionPorts['previewScoreChange']>(async () => PREVIEW),
    applyScoreChange: vi.fn<DecisionPorts['applyScoreChange']>(async () => void calls.push('apply')),
    recordSummaryEvidence: vi.fn<DecisionPorts['recordSummaryEvidence']>(async () => {
      calls.push('evidence');
      return { itemIds: [id(95)] };
    }),
  };
  const publishSubmitted = vi.fn(async () => undefined);
  const useCases = summaryUseCases({
    ...shared,
    ...decisions,
    authorize: vi.fn(async () => undefined),
    // Hassan is the job's hiring owner, so he reaches it; nobody else job-scoped is granted here but Lina and Noor.
    jobResource: async (_ctx, jobId) => (jobId === JOB.jobId ? JOB : null),
    isSyntheticWorkspace: async () => true,
    newId: () => id(next++),
    publishSubmitted,
  });
  const analysis = {
    ...shared,
    mapSummary: vi.fn<AnalysisPorts['mapSummary']>(async () => ({
      promptVersion: 'interviews.mapSummary@1',
      answer: {
        findings: [
          {
            competencyId: 'C1',
            finding: 'clearly_shown' as const,
            reason: 'Describes the evaluation set he built.',
            citations: [{ quote: QUOTE, start: TEXT.indexOf(QUOTE), end: TEXT.indexOf(QUOTE) + QUOTE.length }],
          },
        ],
      },
    })),
    identifiersOf: async () => ({ names: ['Daniel Novak'], emails: ['daniel@example.com'], phones: [] }),
    memberName: async (userId: string) => (userId === LINA ? 'Lina Panel' : 'Ayesha Perera'),
    retryAt: vi.fn<AnalysisPorts['retryAt']>(async () => undefined),
  };
  const submit = async (text = TEXT) =>
    (await useCases.submitMeetingSummary(ctxAs('recruiter'), interview.id, text)).summaryId;
  const analyse = (summaryId: string) => analyseSummary(analysis, {} as never, 'w1', summaryId);
  return {
    useCases,
    analysis,
    decisions,
    publishSubmitted,
    summaries,
    proposals,
    calls,
    submit,
    analyse,
    clock,
    store,
  };
}

describe('Scenario: Analysing a summary proposes a change and applies nothing', () => {
  it('stores the summary as analysing, queues the analysis with ids only, and the analysis stores one proposal a competency', async () => {
    const s = setup();
    const summaryId = await s.submit(`  ${TEXT}\n`);
    expect(s.summaries[0]).toMatchObject({ text: TEXT, status: 'analysing', authorUserId: AYESHA, unusual: false });
    expect(s.publishSubmitted).toHaveBeenCalledOnce();
    await s.analyse(summaryId);
    expect(s.summaries[0]).toMatchObject({ status: 'proposed', promptVersion: 'interviews.mapSummary@1' });
    expect(s.proposals.get(summaryId)?.map((p) => [p.competencyId, p.finding, p.proposedStrength, p.excerpt])).toEqual([
      [RETRIEVAL, 'clearly_shown', 'medium', QUOTE],
      [COST, 'not_mentioned', null, null],
    ]);
    // Nothing of the assessment or the evidence was touched: a proposal is not a change.
    for (const port of Object.values(s.decisions)) expect(port).not.toHaveBeenCalled();
  });

  it('reading the proposals previews them and still applies nothing', async () => {
    const s = setup();
    const summaryId = await s.submit();
    await s.analyse(summaryId);
    const read = await s.useCases.getMeetingSummary(ctxAs('recruiter'), INTERVIEW.id);
    expect(read?.summary?.preview).toEqual({
      previewId: 'p-1',
      competencyIds: [RETRIEVAL],
      backedScore: { from: 55, to: 71 },
    });
    expect(read?.summary?.proposals[0]?.change).toEqual({
      from: { strength: 'supporting', provenLevel: 0 },
      to: { strength: 'medium', provenLevel: 4 },
    });
    expect(s.decisions.applyScoreChange).not.toHaveBeenCalled();
    expect(s.decisions.recordSummaryEvidence).not.toHaveBeenCalled();
    // The summary's own text never comes back in the view.
    expect(JSON.stringify(read)).not.toContain('showed how answers were graded');
  });

  it('a duplicated message stores one proposal set', async () => {
    const s = setup();
    const summaryId = await s.submit();
    await s.analyse(summaryId);
    await s.analyse(summaryId);
    expect(s.analysis.mapSummary).toHaveBeenCalledOnce();
  });

  it("the model is given labels for the competencies, and the candidate's and the interviewer's names to replace", async () => {
    const s = setup();
    await s.analyse(await s.submit());
    expect(s.analysis.mapSummary).toHaveBeenCalledWith({
      workspaceId: 'w1',
      competencies: [
        { id: 'C1', name: 'Retrieval and evaluation', meaning: 'Eval sets.' },
        { id: 'C2', name: 'Cost and reliability', meaning: 'Latency and cost numbers.' },
      ],
      text: TEXT,
      identifiers: {
        names: ['Daniel Novak'],
        emails: ['daniel@example.com'],
        phones: [],
        others: ['Lina Panel', 'Ayesha Perera'],
      },
    });
  });
});

describe('Scenario Outline: Input limits and failures', () => {
  it.each([
    ['', 'summary_empty'],
    ['a'.repeat(12_001), 'summary_too_long'],
  ])('refuses the text and stores nothing: %#', async (text, code) => {
    const s = setup();
    await expect(s.submit(text)).rejects.toMatchObject({ code });
    expect(s.summaries).toEqual([]);
  });

  it("the workspace's daily AI budget is used up: the summary waits, saved, for 00:05 UTC tomorrow", async () => {
    const s = setup();
    s.analysis.mapSummary.mockResolvedValueOnce('budget_exceeded');
    const summaryId = await s.submit();
    await s.analyse(summaryId);
    expect(s.summaries[0]?.status).toBe('waiting');
    expect(s.analysis.retryAt).toHaveBeenCalledWith(
      'w1',
      { summaryId, interviewId: INTERVIEW.id },
      new Date('2026-11-25T00:05:00.000Z'),
    );
    await s.analyse(summaryId);
    expect(s.summaries[0]?.status).toBe('proposed');
  });

  it("the model's output is rejected twice: the summary could not be analysed, and nothing is proposed", async () => {
    const s = setup();
    s.analysis.mapSummary.mockResolvedValueOnce('failed');
    const summaryId = await s.submit();
    await s.analyse(summaryId);
    expect(s.summaries[0]?.status).toBe('failed');
    expect(s.proposals.get(summaryId)).toBeUndefined();
    // A failed summary does not block pasting it again.
    await expect(s.submit()).resolves.toBeTypeOf('string');
  });

  it('a second summary waits until the first is applied or declined', async () => {
    const s = setup();
    await s.submit();
    await expect(s.submit()).rejects.toMatchObject({ code: 'summary_pending' });
  });

  // SAFETY: mutation check: `shownStatus` returned the stored status (no bound) -> this test failed (still `analysing`
  // past the bound)
  it('an analysis that never finished (dead-lettered) reads failed after 15 minutes, and a new summary may be pasted', async () => {
    const s = setup();
    const stalled = await s.submit();
    s.clock.now = new Date(NOW.getTime() + 15 * 60_000);
    expect((await s.useCases.getMeetingSummary(ctxAs('recruiter'), INTERVIEW.id))?.summary?.status).toBe('analysing');
    s.clock.now = new Date(NOW.getTime() + 15 * 60_000 + 1);
    expect((await s.useCases.getMeetingSummary(ctxAs('recruiter'), INTERVIEW.id))?.summary?.status).toBe('failed');
    const next = await s.submit();
    expect(s.summaries.map((x) => [x.id, x.status])).toEqual([
      [stalled, 'failed'],
      [next, 'analysing'],
    ]);
    // Its message, should it run after all, stores nothing for the stalled summary.
    await s.analyse(stalled);
    expect(s.proposals.get(stalled)).toBeUndefined();
  });

  // SAFETY: mutation check: ignored the result of ending the stalled analysis -> this test failed (a second summary stored)
  it('a late analysis that lands while a new summary is pasted keeps its proposals, and the new summary waits', async () => {
    const s = setup();
    const late = await s.submit();
    s.clock.now = new Date(NOW.getTime() + 15 * 60_000 + 1);
    const { latest } = s.store;
    // The submit reads the stalled summary; the late analysis commits its proposals before the submit ends it.
    s.store.latest = async (...args) => {
      const read = await latest(...args);
      const copy = read && { ...read };
      await s.analyse(late);
      return copy;
    };
    await expect(s.submit()).rejects.toMatchObject({ code: 'summary_pending' });
    expect(s.summaries.map((x) => [x.id, x.status])).toEqual([[late, 'proposed']]);
    expect(s.proposals.get(late)).toHaveLength(2);
  });
});

describe('Scenario: Confirming applies, records the source and audits each change', () => {
  it('marks the decision, records the evidence, then applies the score change last, with each reason and the write-up items', async () => {
    const s = setup();
    const summaryId = await s.submit();
    await s.analyse(summaryId);
    await s.useCases.applySummaryProposals(ctxAs('recruiter'), summaryId, {
      previewId: 'p-1',
      changes: [{ competencyId: RETRIEVAL, reason: 'He built and graded the set himself.' }],
    });
    // The assessment's apply audits as its last statements, so nothing of this module may follow it (AGENTS.md 3.6).
    expect(s.calls.slice(-3)).toEqual(['status:applied', 'evidence', 'apply']);
    expect(s.decisions.recordSummaryEvidence).toHaveBeenCalledWith(expect.anything(), {
      candidateId: DANIEL,
      jobId: JOB.jobId,
      writtenAt: NOW,
      items: [{ competencyId: RETRIEVAL, excerpt: QUOTE, strength: 'medium', level: 4 }],
      synthetic: true,
    });
    expect(s.decisions.applyScoreChange).toHaveBeenCalledWith(expect.anything(), {
      assessmentId: id(90),
      interviewId: INTERVIEW.id,
      changes: [{ competencyId: RETRIEVAL, rating: 'clearly_shown' }],
      previewId: 'p-1',
      reason: 'He built and graded the set himself.',
      reasons: { [RETRIEVAL]: 'He built and graded the set himself.' },
      idempotencyKey: summaryId,
      writeUpItemIds: [id(95)],
    });
    expect(s.proposals.get(summaryId)?.map((p) => p.status)).toEqual(['applied', 'declined']);
    await expect(
      s.useCases.applySummaryProposals(ctxAs('recruiter'), summaryId, {
        previewId: 'p-1',
        changes: [{ competencyId: RETRIEVAL, reason: 'Again' }],
      }),
    ).rejects.toMatchObject({ code: 'summary_decided' });
    expect(s.decisions.applyScoreChange).toHaveBeenCalledOnce();
  });

  it('refuses a competency the summary proposes no change for, and an assessment that moved since the preview', async () => {
    const s = setup();
    const summaryId = await s.submit();
    await s.analyse(summaryId);
    const apply = (competencyId: string) =>
      s.useCases.applySummaryProposals(ctxAs('recruiter'), summaryId, {
        previewId: 'p-1',
        changes: [{ competencyId, reason: 'Reason' }],
      });
    await expect(apply(COST)).rejects.toMatchObject({ code: 'proposal_not_found' });
    s.decisions.applyScoreChange.mockRejectedValueOnce(Object.assign(new Error('stale'), { name: 'ScoreChangeError' }));
    await expect(apply(RETRIEVAL)).rejects.toMatchObject({ code: 'preview_changed' });
  });
});

describe('Scenario: Declining applies nothing', () => {
  it('marks the summary and its proposals declined and touches neither the assessment nor the evidence', async () => {
    const s = setup();
    const summaryId = await s.submit();
    await s.analyse(summaryId);
    await s.useCases.declineSummaryProposals(ctxAs('recruiter'), summaryId);
    expect(s.summaries[0]?.status).toBe('declined');
    expect(s.proposals.get(summaryId)?.map((p) => p.status)).toEqual(['declined', 'declined']);
    for (const port of Object.values(s.decisions)) expect(port).not.toHaveBeenCalled();
    expect(s.summaries[0]?.text).toBe(TEXT);
  });
});

describe('"Already changed by the scorecard"', () => {
  it('a competency the interview already rated is excluded by default, so nothing is previewed for it', async () => {
    const s = setup();
    const summaryId = await s.submit();
    await s.analyse(summaryId);
    s.decisions.previewScoreChange.mockResolvedValue({
      ...PREVIEW,
      changes: PREVIEW.changes.map((c) => ({ ...c, replaces: 'partly_shown' as const })),
    });
    const read = await s.useCases.getMeetingSummary(ctxAs('recruiter'), INTERVIEW.id);
    expect(read?.summary?.proposals[0]).toMatchObject({ alreadyChanged: true });
    expect(read?.summary?.preview).toBeNull();
    // A person may still include it: the preview for it is theirs to ask for.
    await expect(s.useCases.previewSummaryProposals(ctxAs('recruiter'), summaryId, [RETRIEVAL])).resolves.toMatchObject(
      { previewId: 'p-1' },
    );
  });
});

describe('Scenario Outline: Only people on the interview analyse or apply', () => {
  // SAFETY: mutation check: removed the `onInterview` check in `acting` -> the two refusals below failed (both stored a summary)
  it.each([
    ['an interviewer not assigned to this interview', 'interviewer', NOOR],
    ['a hiring owner who is not its interviewer', 'hiring_owner', HASSAN],
  ] as const)('%s is refused, and nothing is stored or applied', async (_who, role, userId) => {
    const s = setup();
    const ctx = ctxAs(role, userId);
    await expect(s.useCases.submitMeetingSummary(ctx, INTERVIEW.id, TEXT)).rejects.toBeInstanceOf(ForbiddenError);
    expect(s.summaries).toEqual([]);
    const summaryId = await s.submit();
    await s.analyse(summaryId);
    const change = { previewId: 'p-1', changes: [{ competencyId: RETRIEVAL, reason: 'Reason' }] };
    await expect(s.useCases.applySummaryProposals(ctx, summaryId, change)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(s.useCases.previewSummaryProposals(ctx, summaryId, [RETRIEVAL])).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(s.useCases.declineSummaryProposals(ctx, summaryId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(s.useCases.getMeetingSummary(ctx, INTERVIEW.id)).resolves.toBeNull();
    expect(s.summaries[0]?.status).toBe('proposed');
    expect(s.decisions.applyScoreChange).not.toHaveBeenCalled();
  });

  it('the assigned interviewer and a recruiter may; an interview the workspace does not have is not found', async () => {
    const s = setup();
    await expect(
      s.useCases.submitMeetingSummary(ctxAs('interviewer', LINA), INTERVIEW.id, TEXT),
    ).resolves.toBeDefined();
    await expect(s.useCases.submitMeetingSummary(ctxAs('recruiter'), id(999), TEXT)).rejects.toMatchObject({
      code: 'interview_not_found',
    });
    await expect(
      s.useCases.applySummaryProposals(ctxAs('recruiter'), id(998), {
        previewId: 'p',
        changes: [{ competencyId: RETRIEVAL, reason: 'r' }],
      }),
    ).rejects.toMatchObject({ code: 'summary_not_found' });
  });

  it('an interview still scheduled or cancelled takes no summary', async () => {
    const s = setup({ ...INTERVIEW, status: 'cancelled' });
    await expect(s.submit()).rejects.toMatchObject({ code: 'interview_not_held' });
  });
});
