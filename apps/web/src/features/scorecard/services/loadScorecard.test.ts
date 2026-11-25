import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenError } from '@credalent/workspaces';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadScorecard, seesInterview } from './loadScorecard.ts';
import { saveScorecardDraft } from './saveDraft.ts';

// AIV-P2-004: the scorecard page's read and its save, with the workspace context and every module faked. Synthetic
// cast and ids only.
const ID = '0190d4a2-0000-7000-9000-000000000060';
const ctx = { userId: 'u-me', workspaceId: 'w1', role: 'recruiter', tx: {} };
const fake = vi.hoisted(() => ({
  workspace: vi.fn(),
  scorecard: vi.fn(),
  interview: vi.fn(),
  save: vi.fn(),
  rows: vi.fn(),
  latest: vi.fn(),
  questions: vi.fn(),
  rubric: vi.fn(),
  evidence: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  forbidden: vi.fn(() => {
    throw new Error('FORBIDDEN');
  }),
}));
vi.mock('next/navigation', () => ({
  notFound: fake.notFound,
  forbidden: fake.forbidden,
  // As Next's: its own signals pass through, anything else is left to the caller.
  unstable_rethrow: (error: Error) => {
    if (error.message === 'NOT_FOUND' || error.message === 'FORBIDDEN') throw error;
  },
}));
vi.mock('@credalent/observability', () => ({ log: { warn: vi.fn() } }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: (fn: (c: typeof ctx) => Promise<unknown>) => fake.workspace(fn),
}));
vi.mock('@/server/interviews', () => ({
  getInterviews: () => ({ getScorecard: fake.scorecard, saveScorecardDraft: fake.save, getInterview: fake.interview }),
}));
vi.mock('@/features/interviews', () => ({ toInterviewRows: fake.rows }));
// SAFETY: the assessment fake has the two stored reads and nothing else: a call that could reach a model
// (explainRanking, suggestInterviewQuestions, previewScoreChange) would throw here.
vi.mock('@/server/assessment', () => ({
  getAssessment: () => ({ getLatestAssessment: fake.latest, getSuggestedQuestions: fake.questions }),
}));
vi.mock('@/server/jobs', () => ({ getApprovedRubricReads: () => ({ approvedRubric: fake.rubric }) }));
vi.mock('@/server/evidence', () => ({ getEvidence: () => ({ listEvidenceForCandidate: fake.evidence }) }));
vi.mock('@/server/files', () => ({ getFiles: () => null }));

const inWorkspace = () =>
  fake.workspace.mockImplementation(async (fn: (c: typeof ctx) => Promise<unknown>) => ({ value: await fn(ctx) }));

afterEach(() => vi.resetAllMocks());

const interview = {
  id: ID,
  candidateId: 'p-daniel',
  jobId: 'j-ai',
  rubricVersionId: 'v2',
  competencyIds: ['c-retrieval', 'c-cost'],
};
const row = {
  candidate: 'Daniel Novak',
  job: 'Senior AI Engineer',
  round: 'structured_screen',
  interviewer: null,
  scheduledAt: '2026-11-18T10:00:00.000Z',
  today: true,
};
const item = (id: string, excerpt: string, provenance: string, strength: string, label: string) => ({
  id,
  excerpt,
  excerptSpan: null,
  provenance,
  strength,
  limit: 'A claim until a second source supports it.',
  source: { id: `s-${id}`, kind: 'document', label, url: null, blobFileId: null, checkedAt: null, checkMethod: null },
});

function daniel() {
  inWorkspace();
  fake.scorecard.mockResolvedValue({ interview, canEdit: true, draft: null });
  fake.rows.mockResolvedValue([row]);
  fake.rubric.mockResolvedValue({
    id: 'v2',
    competencies: [
      { id: 'c-retrieval', name: 'Retrieval and evaluation', weightPercent: 20 },
      { id: 'c-cost', name: 'Cost and reliability', weightPercent: 15 },
      { id: 'c-python', name: 'Python service engineering', weightPercent: 15 },
    ],
  });
  fake.latest.mockResolvedValue({
    rubricVersionId: 'v2',
    backedScore: 55,
    assessedAt: new Date('2026-11-12T08:00:00.000Z'),
    competencies: [
      {
        competencyId: 'c-retrieval',
        weightPercent: 20,
        proven: { level: 0, itemIds: [] },
        claimedLevel: 4,
        claimItemIds: ['e-cv'],
      },
      {
        competencyId: 'c-cost',
        weightPercent: 15,
        proven: { level: 2, itemIds: ['e-doc'] },
        claimedLevel: 2,
        claimItemIds: [],
      },
      {
        competencyId: 'c-python',
        weightPercent: 15,
        proven: { level: 0, itemIds: [] },
        claimedLevel: 0,
        claimItemIds: [],
      },
    ],
  });
  fake.evidence.mockResolvedValue([
    item('e-cv', 'raised answer accuracy from 71% to 88%', 'claim', 'supporting', 'CV'),
    item('e-doc', 'rolled back the index change', 'submitted', 'medium', 'Incident review, March (PDF)'),
  ]);
  fake.questions.mockResolvedValue({
    status: 'suggested',
    resultId: 'r1',
    stale: false,
    suggestedAt: new Date('2026-11-15T08:00:00.000Z'),
    gaps: [
      {
        competencyId: 'c-retrieval',
        questions: [
          {
            text: 'How was the 71% measured?',
            strongAnswer: 'Names the set.',
            weakAnswer: 'No detail.',
            citations: [],
          },
        ],
      },
    ],
  });
}

describe('loadScorecard', () => {
  it('gives the interview, each competency it tests with its evidence and stored questions, and a starting draft', async () => {
    daniel();
    const data = await loadScorecard(ID);
    if (!data || data === 'notFound') throw new Error('no scorecard');
    expect(data).toMatchObject({
      interviewId: ID,
      ...row,
      profileHref: '/app/candidates/p-daniel?job=j-ai',
      assessed: { at: '2026-11-12T08:00:00.000Z', backedScore: 55 },
      canEdit: true,
    });
    // Only the interview's competencies, in its order: Python service engineering is not tested here.
    expect(data.competencies.map((c) => [c.name, c.weightPercent, c.evidence?.lead, c.questions.length])).toEqual([
      ['Retrieval and evaluation', 20, { strength: 'supporting', provenance: 'claim' }, 1],
      ['Cost and reliability', 15, { strength: 'medium', provenance: 'submitted' }, 0],
    ]);
    // SAFETY: the CV line is a claim, so it is not highlighted; the submitted document is (AGENTS.md 1.6).
    expect(data.competencies.map((c) => c.evidence?.items.map((i) => i.highlighted))).toEqual([[false], [true]]);
    expect(data.competencies[1]?.evidence?.sources).toEqual([
      { key: 's-e-doc:', kind: 'text', text: 'Incident review, March (PDF)' },
    ]);
    expect(data.draft.competencies.map((c) => c.questions)).toEqual([
      [{ text: 'How was the 71% measured?', mark: null }],
      [{ text: '', mark: null }],
    ]);
    // The rows are named only for the interview the contract returned for this context.
    expect(fake.rows).toHaveBeenCalledWith(ctx, [interview], expect.any(Date));
  });

  it('with no result on the interview’s rubric version: no evidence or questions are read, and no score is shown', async () => {
    daniel();
    fake.latest.mockResolvedValue({ rubricVersionId: 'v1', backedScore: 40, assessedAt: new Date(), competencies: [] });
    const data = await loadScorecard(ID);
    if (!data || data === 'notFound') throw new Error('no scorecard');
    expect(data.assessed).toBeNull();
    expect(data.competencies.map((c) => [c.evidence, c.questions])).toEqual([
      [null, []],
      [null, []],
    ]);
    expect(fake.evidence).not.toHaveBeenCalled();
    expect(fake.questions).not.toHaveBeenCalled();
  });

  it('is not found for a malformed id or an interview the contract does not return; null with no workspace', async () => {
    expect(await loadScorecard('daniel')).toBe('notFound');
    expect(fake.workspace).not.toHaveBeenCalled();
    inWorkspace();
    fake.scorecard.mockResolvedValue(null);
    expect(await loadScorecard(ID)).toBe('notFound');
    expect(fake.latest).not.toHaveBeenCalled();
    fake.workspace.mockResolvedValue(null);
    expect(await loadScorecard(ID)).toBeNull();
  });
});

describe('seesInterview', () => {
  it('is what the interviews contract says, false for a malformed id, null with no workspace', async () => {
    expect(await seesInterview('daniel')).toBe(false);
    expect(fake.workspace).not.toHaveBeenCalled();
    inWorkspace();
    fake.interview.mockResolvedValueOnce({ id: ID }).mockResolvedValueOnce(null);
    expect(await seesInterview(ID)).toBe(true);
    expect(await seesInterview(ID)).toBe(false);
    fake.workspace.mockResolvedValue(null);
    expect(await seesInterview(ID)).toBeNull();
  });
});

describe('saveScorecardDraft', () => {
  const draft = { competencies: [], recommendation: null };

  it('saves the checked draft in the member’s workspace', async () => {
    inWorkspace();
    expect(await saveScorecardDraft({ interviewId: ID, draft })).toBe(true);
    expect(fake.save).toHaveBeenCalledWith(ctx, ID, draft);
  });

  it('refuses a malformed input before anything is read: an unknown field, a bad id', async () => {
    for (const input of [{ interviewId: ID, draft: { ...draft, overallScore: 4 } }, { interviewId: 'x', draft }, null])
      await expect(saveScorecardDraft(input)).rejects.toThrow('NOT_FOUND');
    expect(fake.workspace).not.toHaveBeenCalled();
  });

  it('a refusal is the 403 page, with no workspace too; a closed interview or a failure answers false', async () => {
    // As inActiveWorkspace does for the module's ForbiddenError.
    fake.workspace.mockImplementation(async (fn: (c: typeof ctx) => Promise<unknown>) => {
      try {
        return { value: await fn(ctx) };
      } catch (error) {
        if (error instanceof ForbiddenError) fake.forbidden();
        throw error;
      }
    });
    fake.save.mockRejectedValue(new ForbiddenError());
    await expect(saveScorecardDraft({ interviewId: ID, draft })).rejects.toThrow('FORBIDDEN');
    fake.save.mockRejectedValue(new Error('connection lost'));
    expect(await saveScorecardDraft({ interviewId: ID, draft })).toBe(false);
    fake.workspace.mockResolvedValue(null);
    await expect(saveScorecardDraft({ interviewId: ID, draft })).rejects.toThrow('FORBIDDEN');
  });
});

describe('Scenario: No AI or overall judgement of the person', () => {
  it('nothing in the scorecard feature, its page or the interviews module imports the AI platform', () => {
    const root = join(import.meta.dirname, '../../../../../..');
    const files = [
      'apps/web/src/features/scorecard/**/*.{ts,tsx}',
      'apps/web/src/app/(recruiter)/app/interviews/\\[interviewId\\]/*.tsx',
      'modules/interviews/src/**/*.ts',
    ].flatMap((pattern) => globSync(pattern, { cwd: root }));
    expect(files.length).toBeGreaterThan(10);
    const importsAi = files.filter(
      (file) =>
        !file.endsWith('.test.ts') &&
        /from '(@credalent\/ai|@\/server\/ai)['/]/.test(readFileSync(join(root, file), 'utf8')),
    );
    // AIV-P1-115: the module's one model call is the meeting-summary analysis, wired in its composition for the worker.
    // It rates no person: it proposes a change per competency, which a person confirms. Nothing of the scorecard (its
    // feature, its page, the module's domain, use cases and store) may import the AI platform, and no other file may.
    expect(importsAi).toEqual(['modules/interviews/src/composition.ts']);
  });
});
