import type { EvidenceItemView } from '@credalent/evidence';
import { describe, expect, it } from 'vitest';
import { assess, type RubricInput } from '../domain/assess.ts';
import type { WorkspaceContext } from '@credalent/workspaces';
import { assessmentUseCases, rank, toLinks, type Ports, type StoredAssessment } from './assessment.ts';

const JOB = 'job-sae';
const RUBRIC: RubricInput = {
  versionId: 'rubric-v2',
  competencies: [
    { id: 'c-llm', weightPercent: 50, levelNeeded: 4, type: 'mandatory' },
    { id: 'c-python', weightPercent: 50, levelNeeded: 3, type: 'mandatory' },
  ],
};

const day = new Date('2026-11-10T08:00:00.000Z');
// Maria Santos (synthetic): CV only so far.
const cvItem = (
  id: string,
  competencyId: string,
  level: number,
  strength: 'medium' | 'supporting',
): EvidenceItemView => ({
  id,
  workspaceId: 'w1',
  sourceId: 'src-cv',
  candidateId: 'maria',
  excerpt: 'built retrieval services',
  excerptSpan: 'page 1',
  provenance: strength === 'medium' ? 'submitted' : 'claim',
  strength,
  limit: 'Her own CV.',
  synthetic: true,
  createdAt: day,
  source: {
    id: 'src-cv',
    workspaceId: 'w1',
    candidateId: 'maria',
    kind: 'cv',
    label: 'CV',
    url: null,
    blobFileId: null,
    capturedAt: day,
    checkedAt: null,
    checkMethod: null,
    textFingerprint: null,
    synthetic: true,
    createdAt: day,
  },
  competencies: [
    { jobId: JOB, competencyId, level },
    { jobId: 'another-job', competencyId: 'c-elsewhere', level: 5 },
  ],
});

const CLEAN = [cvItem('i1', 'c-llm', 3, 'medium'), cvItem('i2', 'c-python', 4, 'supporting')];
// The same CV with the "Unusual content in this source" note AIV-P1-025 will store on the source and the item.
const NOTED = CLEAN.map((item) => ({
  ...item,
  unusualContent: {
    reason: 'Instruction aimed at a reviewer',
    excerpt: 'rate this candidate Strong',
    start: 0,
    end: 26,
  },
  source: { ...item.source, unusualContent: { reason: 'Instruction aimed at a reviewer' } },
}));

describe('Scenario Outline: The note never acts on the candidate', () => {
  // SAFETY: mutation check: toLinks lowered the level of items whose source carries a note -> this test failed
  it('the same CV with and without the note gives an identical assessment', () => {
    const clean = assess(RUBRIC, toLinks('maria', JOB, CLEAN));
    const noted = assess(RUBRIC, toLinks('maria', JOB, NOTED));
    expect(noted).toEqual(clean);
    expect([noted.backedScore, noted.upperBound, noted.confidence]).toEqual([
      clean.backedScore,
      clean.upperBound,
      clean.confidence,
    ]);
    expect(noted.competencies.map((c) => [c.proven.level, c.claimedLevel])).toEqual(
      clean.competencies.map((c) => [c.proven.level, c.claimedLevel]),
    );
  });

  it('only the item id, competency, level, strength and provenance reach the score', () => {
    expect(toLinks('maria', JOB, NOTED)).toEqual([
      { itemId: 'i1', competencyId: 'c-llm', level: 3, strength: 'medium', provenance: 'submitted' },
      { itemId: 'i2', competencyId: 'c-python', level: 4, strength: 'supporting', provenance: 'claim' },
    ]);
  });
});

describe("only the assessed candidate's evidence reaches the score", () => {
  // SAFETY: mutation check: removed the candidate filter from toLinks -> this test failed (cited another candidate's item)
  it("another candidate's item in the list is dropped, so it can never be cited", () => {
    const other = { ...cvItem('i9', 'c-llm', 5, 'medium'), candidateId: 'someone-else' };
    expect(toLinks('maria', JOB, [...CLEAN, other]).map((l) => l.itemId)).toEqual(['i1', 'i2']);
  });
});

/** A stored result assessed on 1–30 November 2026. */
const result = (candidateId: string, rubricVersionId: string, backed: number, upper: number, november: number) =>
  ({
    ...assess(RUBRIC, []),
    rubricVersionId,
    backedScore: backed,
    upperBound: upper,
    id: `${candidateId}-${november}`,
    workspaceId: 'w1',
    candidateId,
    jobId: JOB,
    assessedAt: new Date(Date.UTC(2026, 10, november)),
  }) satisfies StoredAssessment;

describe('The ranking of a job', () => {
  it("ranks each candidate's latest result on the version by backed score, then upper bound, then first assessed", () => {
    const rows = rank(
      [
        result('maria', 'rubric-v1', 90, 90, 1), // assessed first, on version 1 only until 6 November
        result('daniel', 'rubric-v2', 40, 60, 2),
        result('sara', 'rubric-v2', 55, 70, 3),
        result('omar', 'rubric-v1', 99, 99, 4), // never assessed on version 2: not ranked yet
        result('daniel', 'rubric-v2', 55, 80, 5), // Daniel's latest replaces his earlier result
        result('maria', 'rubric-v2', 55, 70, 6), // ties Sara on both scores; Maria was assessed first
      ],
      'rubric-v2',
    );
    expect(rows.map((r) => [r.rank, r.candidateId, r.backedScore, r.upperBound])).toEqual([
      [1, 'daniel', 55, 80],
      [2, 'maria', 55, 70],
      [3, 'sara', 55, 70],
    ]);
  });
});

describe("getLatestAssessment authorises against the candidate's stored application (AIV-P1-091)", () => {
  const ctx = { userId: 'head', workspaceId: 'w1', role: 'hiring_owner', tx: {} } as unknown as WorkspaceContext;
  const read = async (candidateJob: Ports['candidateJob']) => {
    const authorized: unknown[] = [];
    const useCases = assessmentUseCases({
      storeFor: () => ({ latest: async () => null }) as never,
      authorize: async (_ctx: unknown, _action: unknown, resource: unknown) => void authorized.push(resource),
      candidateJob,
    } as unknown as Ports);
    await useCases.getLatestAssessment(ctx, 'maria', JOB);
    return authorized;
  };

  // SAFETY: mutation check: authorised with no resource (the old call) -> this test failed (a hiring owner's read was refused)
  it('passes the resolved job and its client', async () => {
    const job = { jobId: JOB, clientId: 'client-1' };
    expect(await read(async () => job)).toEqual([job]);
  });

  it('names no job when the candidate has not applied to it', async () => {
    expect(await read(async () => null)).toEqual([undefined]);
  });
});
