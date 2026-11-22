import { createHash } from 'node:crypto';
import type { Tx } from '@credalent/db';
import type { WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it } from 'vitest';
import type { DuplicateFlag, FingerprintedSource } from '../domain/fingerprint.ts';
import { ContradictionResolvedV1 } from '../contracts/index.ts';
import { evidenceUseCases, type EvidenceStore, type Ports, type RecordEvidenceInput } from './evidence.ts';

// AIV-P1-071: the flag path records a flag and nothing else, and resolving it is audited last. Synthetic text only.
const writeUp = Array.from(
  { length: 40 },
  (_, i) =>
    `In week ${i + 1} the harness replayed ${i * 9 + 20} merchant questions and compared recall with release ${i}.`,
).join(' ');

/** Fakes that log every port call in order; the store keeps sources and flags in memory. */
function harness(candidateJob: Ports['candidateJob'] = async () => null) {
  const calls: string[] = [];
  const authorized: unknown[] = [];
  const sources: FingerprintedSource[] = [];
  const flags: DuplicateFlag[] = [];
  const inserted: unknown[] = [];
  const logged: unknown[] = [];
  let id = 0;
  const store = {
    async insert(source, items) {
      calls.push('insert');
      sources.push(source);
      inserted.push(items.map(({ id: _id, sourceId: _s, candidateId: _c, ...item }) => item));
    },
    async fingerprints(_w, candidateId) {
      calls.push('fingerprints');
      return sources.filter((s) => (candidateId ? s.candidateId === candidateId : s.textFingerprint));
    },
    async insertFlags(f) {
      calls.push('insertFlags');
      flags.push(...f);
    },
    async resolveFlag(_w, flagId, resolution) {
      calls.push('resolveFlag');
      const flag = flags.find((f) => f.id === flagId);
      if (!flag) return null;
      const before = { ...flag };
      Object.assign(flag, resolution);
      return before;
    },
    async list() {
      return [];
    },
    async comparisons() {
      return [];
    },
  } as Partial<EvidenceStore> as EvidenceStore;
  const useCases = evidenceUseCases({
    storeFor: () => store,
    publishRecorded: async () => void calls.push('publishRecorded'),
    publishContradictionResolved: async () => void calls.push('publishContradictionResolved'),
    candidateJob,
    authorize: async (_ctx, _action, resource) => void (calls.push('authorize'), authorized.push(resource)),
    isSyntheticWorkspace: async () => true,
    audit: async () => void calls.push('audit'),
    logFlagged: (fields) => void (calls.push('logFlagged'), logged.push(fields)),
    sha1: (input) => createHash('sha1').update(input).digest(),
    newId: () => `0190d4a2-0000-7000-8000-${String(++id).padStart(12, '0')}`,
    now: () => new Date('2026-11-18T09:00:00.000Z'),
  });
  return { calls, authorized, flags, inserted, logged, useCases };
}

const ctx = { userId: 'alex', workspaceId: 'demo', role: 'recruiter', tx: {} as Tx } as WorkspaceContext;
const input = (candidateId: string, text?: string): RecordEvidenceInput => ({
  candidateId,
  source: {
    kind: 'document',
    label: 'Retrieval evaluation harness',
    url: null,
    blobFileId: null,
    capturedAt: new Date('2026-11-10T08:00:00.000Z'),
    checkedAt: null,
    checkMethod: null,
  },
  items: [
    {
      excerpt: 'replayed merchant questions weekly',
      excerptSpan: null,
      provenance: 'submitted',
      strength: 'medium',
      limit: 'Shows the harness, not who wrote it.',
    },
  ],
  synthetic: true,
  ...(text === undefined ? {} : { text }),
});

describe('the near-duplicate flag never acts (AGENTS.md 1.5)', () => {
  // SAFETY: mutation check: added a publishRecorded call after insertFlags in flagCrossApplicantCopies -> this test failed
  it('recording a copy stores the same items and event as any source, then only a flag and a log line', async () => {
    const { calls, flags, inserted, logged, useCases } = harness();
    await useCases.recordEvidence(ctx, input('maria', writeUp));
    calls.length = 0;
    const { sourceId } = await useCases.recordEvidence(ctx, input('omar', writeUp));
    expect(calls).toEqual(['authorize', 'insert', 'publishRecorded', 'fingerprints', 'insertFlags', 'logFlagged']);
    expect(inserted[1]).toEqual(inserted[0]);
    expect(flags).toMatchObject([{ sourceId, candidateId: 'omar', otherCandidateId: 'maria', similarity: 1 }]);
    expect(Object.keys(logged[0] as object).toSorted()).toEqual(['flagId', 'otherSourceId', 'similarity', 'sourceId']);
  });

  it('a source with no text, or the same candidate twice, raises no flag', async () => {
    const { calls, flags, useCases } = harness();
    await useCases.recordEvidence(ctx, input('maria'));
    await useCases.recordEvidence(ctx, input('maria', writeUp));
    await useCases.recordEvidence(ctx, input('maria', writeUp));
    expect(flags).toEqual([]);
    expect(calls).not.toContain('logFlagged');
  });

  // SAFETY: mutation check: wrote the audit entry before resolveFlag instead of after -> this test failed
  it('resolving changes the flag alone and writes the audit entry last', async () => {
    const { calls, flags, useCases } = harness();
    await useCases.recordEvidence(ctx, input('maria', writeUp));
    await useCases.recordEvidence(ctx, input('omar', writeUp));
    calls.length = 0;
    await useCases.resolveDuplicateFlag(ctx, flags[0]?.id ?? '', 'shared_group_project');
    expect(calls).toEqual(['authorize', 'resolveFlag', 'audit']);
    expect(flags[0]).toMatchObject({ resolution: 'shared_group_project', resolvedBy: 'alex' });
    await expect(useCases.resolveDuplicateFlag(ctx, flags[0]?.id ?? '', 'cheating' as never)).rejects.toThrow(
      'Choose a reason from the list',
    );
  });
});

describe('job-named reads authorise against the stored application, not the request (AIV-P1-091)', () => {
  const job = { jobId: 'job-a', clientId: 'client-1' };
  // SAFETY: mutation check: authorised with the request's { jobId } instead of the resolved record -> this test failed (no clientId)
  it('listEvidenceForCandidate and listComparisons pass the resolved job and its client to authorize', async () => {
    const { authorized, useCases } = harness(async (_ctx, candidateId, jobId) =>
      candidateId === 'maria' && jobId === 'job-a' ? job : null,
    );
    await useCases.listEvidenceForCandidate(ctx, 'maria', 'job-a');
    await useCases.listComparisons(ctx, 'maria', 'job-a');
    expect(authorized).toEqual([job, job]);
  });

  it('a candidate with no application on the job names no job, so a job-scoped role is refused', async () => {
    const { authorized, useCases } = harness();
    await useCases.listEvidenceForCandidate(ctx, 'maria', 'job-b');
    expect(authorized).toEqual([undefined]);
  });
});

describe('ContradictionResolved.v1 carries opaque ids only (AGENTS.md 1.2, AIV-P1-098)', () => {
  const ids = {
    candidateId: '0190d4a2-0000-7000-8000-000000000001',
    jobId: '0190d4a2-0000-7000-8000-000000000002',
    rubricVersionId: '0190d4a2-0000-7000-8000-000000000003',
    comparisonId: '0190d4a2-0000-7000-8000-000000000004',
  };
  // SAFETY: mutation check: z.strictObject -> z.object in ContradictionResolvedV1 -> this test failed (a note was accepted)
  it('rejects a note, a limit or a name', () => {
    expect(ContradictionResolvedV1.payload.safeParse(ids).success).toBe(true);
    expect(ContradictionResolvedV1.payload.safeParse({ ...ids, note: 'The CV overstates the team' }).success).toBe(
      false,
    );
  });
});
