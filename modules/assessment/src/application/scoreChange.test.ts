import type { WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it } from 'vitest';
import { assess, type RubricInput } from '../domain/assess.ts';
import type { AssessmentStore, StoredAssessment } from './assessment.ts';
import { scoreChangeUseCases, type ScoreChangePorts } from './scoreChange.ts';

// AIV-P1-117: the preview over faked ports; the database scenarios are in tests/integration/src/score-change.test.ts.
const id = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const [PYTHON, RETRIEVAL, INTERVIEW] = [id(1), id(2), id(3)] as const;
const RUBRIC: RubricInput = {
  versionId: id(4),
  competencies: [
    { id: PYTHON, weightPercent: 60, levelNeeded: 4, type: 'mandatory' },
    { id: RETRIEVAL, weightPercent: 40, levelNeeded: 3, type: 'mandatory' },
  ],
};
const SNAPSHOT: StoredAssessment = {
  ...assess(RUBRIC, []),
  id: id(5),
  workspaceId: 'w1',
  candidateId: id(6),
  jobId: id(7),
  assessedAt: new Date('2026-11-24T09:00:00.000Z'),
};
const ctx = { workspaceId: 'w1', userId: id(8), role: 'recruiter', tx: {} } as unknown as WorkspaceContext;

const useCases = scoreChangeUseCases({
  storeFor: () =>
    ({
      byId: async () => SNAPSHOT,
      latest: async () => SNAPSHOT,
      interviewChanges: async () => [],
    }) as unknown as AssessmentStore,
  authorize: async () => undefined,
  candidateJob: async () => null,
  evidenceForJob: async () => [],
  interviewOf: async () => ({
    candidateId: SNAPSHOT.candidateId,
    jobId: SNAPSHOT.jobId,
    competencyIds: [PYTHON, RETRIEVAL],
    status: 'completed',
  }),
} as unknown as ScoreChangePorts);

describe('Scenario: Preview shows the strength and backed score before and after', () => {
  // The interview summary (AIV-P1-115) and the scorecard send their changes in their own order.
  // Mutation check: hashed the changes in the caller's order (the sort removed) -> this test failed (two preview ids)
  it('names one preview whatever order the changes come in', async () => {
    const python = { competencyId: PYTHON, rating: 'clearly_shown' } as const;
    const retrieval = { competencyId: RETRIEVAL, rating: 'strongly_shown' } as const;
    const preview = (changes: (typeof python | typeof retrieval)[]) =>
      useCases.previewScoreChange(ctx, { assessmentId: SNAPSHOT.id, interviewId: INTERVIEW, changes });
    const [one, other] = await Promise.all([preview([python, retrieval]), preview([retrieval, python])]);
    expect(other.previewId).toBe(one.previewId);
    expect(other.backedScore).toEqual(one.backedScore);
  });
});
