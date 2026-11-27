import { ForbiddenError, type Role, type WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it, vi } from 'vitest';
import type { Decision, DecisionPack, PackMember } from '../domain/pack.ts';
import { packUseCases, type PackStore, type Ports } from './packs.ts';

// AIV-P2-009: the pack use cases over faked ports; the database scenarios are in
// tests/integration/src/decisions.test.ts. Synthetic cast and opaque ids only.
const id = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const AYESHA = id(1); // recruiter
const FAISAL = id(2); // the job's hiring owner
const JOB = { jobId: id(10), clientId: null, hiringOwnerUserId: FAISAL };
const V2 = id(11);
const [SARA, ARJUN, HUDA] = [id(20), id(21), id(22)] as const;
const PACK = id(30);
const NOW = new Date('2026-11-17T08:00:00.000Z');
const LATER = new Date('2026-11-18T09:30:00.000Z');
const ALEX = id(3); // admin
const ctxAs = (role: Role, userId = AYESHA) => ({ workspaceId: 'w1', userId, role, tx: {} }) as WorkspaceContext;

const pack = (over: Partial<DecisionPack> = {}): DecisionPack => ({
  id: PACK,
  workspaceId: 'w1',
  jobId: JOB.jobId,
  rubricVersionId: V2,
  name: 'Round 2 shortlist: Senior AI Engineer',
  preparedBy: AYESHA,
  preparedAt: NOW,
  status: 'ready',
  ...over,
});
const member = (candidateId: string, position: number, backedScore = 68, upperBound = 84): PackMember => ({
  workspaceId: 'w1',
  packId: PACK,
  candidateId,
  assessmentId: `a-${candidateId}`,
  backedScore,
  upperBound,
  position,
  addedBy: AYESHA,
  addedAt: NOW,
});

function setup(over: Partial<Ports> = {}, stored: DecisionPack | null = pack(), members: PackMember[] = []) {
  const store = {
    insertPack: vi.fn<PackStore['insertPack']>(async () => undefined),
    findPack: vi.fn<PackStore['findPack']>(async (_w, packId) => (stored?.id === packId ? stored : null)),
    setStatus: vi.fn<PackStore['setStatus']>(async () => undefined),
    insertMembers: vi.fn<PackStore['insertMembers']>(async () => undefined),
    listMembers: vi.fn<PackStore['listMembers']>(async () => members),
    insertDecisions: vi.fn<PackStore['insertDecisions']>(async () => undefined),
    listDecisions: vi.fn<PackStore['listDecisions']>(async () => []),
    listForJob: vi.fn<PackStore['listForJob']>(async () => [
      { id: PACK, name: 'Round 2 shortlist', status: 'ready', candidateIds: [SARA] },
    ]),
    listSummaries: vi.fn<PackStore['listSummaries']>(async () => []),
    insertSummary: vi.fn<PackStore['insertSummary']>(async () => undefined),
  };
  const ports: Ports = {
    storeFor: () => store,
    publishPackReady: vi.fn(async () => undefined),
    publishMembersAdded: vi.fn(async () => undefined),
    publishDecisionsRecorded: vi.fn(async () => undefined),
    authorize: vi.fn(async () => undefined),
    job: async (_ctx, jobId) => (jobId === JOB.jobId ? JOB : null),
    ranking: async () => ({ rubricVersionId: V2, candidateIds: [SARA, ARJUN, HUDA] }),
    latestAssessment: vi.fn(async (_ctx, candidateId: string) => ({
      id: `a-${candidateId}`,
      rubricVersionId: V2,
      backedScore: 68,
      upperBound: 84,
    })),
    auditDecision: vi.fn(async () => undefined),
    auditPackCreated: vi.fn(async () => undefined),
    auditMemberAdded: vi.fn(async () => undefined),
    newId: () => PACK,
    now: () => NOW,
    ...over,
  };
  return { useCases: packUseCases(ports), store, ports };
}

const shortlist = (over: Record<string, unknown> = {}) => ({
  jobId: JOB.jobId,
  name: 'Round 2 shortlist: Senior AI Engineer',
  members: [{ candidateId: SARA }, { candidateId: ARJUN }, { candidateId: HUDA }],
  ...over,
});
const advanceAll = (candidates: readonly string[] = [SARA, ARJUN, HUDA]) => ({
  packId: PACK,
  decisions: candidates.map((candidateId) => ({
    candidateId,
    decision: 'advance' as const,
    note: 'Strong on the two heaviest competencies.',
  })),
});

describe('createPack', () => {
  it('stores a ready pack on the approved rubric version with a snapshot per member, and announces it', async () => {
    const { useCases, store, ports } = setup();
    expect(await useCases.createPack(ctxAs('recruiter'), shortlist())).toEqual({ packId: PACK });
    const written = store.insertPack.mock.calls[0]?.[0];
    expect(written).toEqual(pack());
    expect(store.insertMembers.mock.calls[0]?.[0]).toEqual([member(SARA, 0), member(ARJUN, 1), member(HUDA, 2)]);
    expect(ports.authorize).toHaveBeenCalledWith(ctxAs('recruiter'), 'pack.prepare', JOB);
    expect(ports.publishPackReady).toHaveBeenCalledWith({}, written);
  });

  // SAFETY: mutation check: removed the auditMemberAdded loop from createPack -> this test failed (no member_added call)
  it('audits the pack and each member who joins it, after every other write (AGENTS.md 3.6)', async () => {
    const { useCases, store, ports } = setup();
    await useCases.createPack(ctxAs('recruiter'), shortlist());
    expect(ports.auditPackCreated).toHaveBeenCalledWith(ctxAs('recruiter'), pack());
    expect(vi.mocked(ports.auditMemberAdded).mock.calls).toEqual(
      [member(SARA, 0), member(ARJUN, 1), member(HUDA, 2)].map((m) => [ctxAs('recruiter'), JOB.jobId, m]),
    );
    const lastOther = Math.max(
      ...[store.insertPack, store.insertMembers, vi.mocked(ports.publishPackReady)].map(
        (f) => f.mock.invocationCallOrder[0] ?? 0,
      ),
    );
    const audits = [ports.auditPackCreated, ports.auditMemberAdded].flatMap(
      (f) => vi.mocked(f).mock.invocationCallOrder,
    );
    expect(Math.min(...audits)).toBeGreaterThan(lastOther);
  });

  it('a candidate named twice is a member once', async () => {
    const { useCases, store } = setup();
    await useCases.createPack(
      ctxAs('recruiter'),
      shortlist({ members: [{ candidateId: SARA }, { candidateId: SARA }] }),
    );
    expect(store.insertMembers.mock.calls[0]?.[0]).toEqual([member(SARA, 0)]);
  });

  // SAFETY: mutation check: removed the rubric version comparison from snapshot() -> the "older version" row failed (pack stored)
  it.each<[string, Partial<Ports>, string]>([
    ['a job the context cannot see', { job: async () => null }, 'job_not_found'],
    ['no approved rubric', { ranking: async () => null }, 'rubric_not_approved'],
    [
      'a candidate not ranked on the job',
      { ranking: async () => ({ rubricVersionId: V2, candidateIds: [SARA] }) },
      'candidate_not_assessed',
    ],
    ['a candidate with no assessment', { latestAssessment: async () => null }, 'candidate_not_assessed'],
    [
      'a latest assessment on an older version',
      { latestAssessment: async () => ({ id: id(40), rubricVersionId: id(12), backedScore: 1, upperBound: 2 }) },
      'candidate_not_assessed',
    ],
  ])('%s: refused (%s) and nothing is stored', async (_label, over, code) => {
    const { useCases, store, ports } = setup(over);
    await expect(useCases.createPack(ctxAs('recruiter'), shortlist())).rejects.toMatchObject({ code });
    expect(store.insertPack).not.toHaveBeenCalled();
    expect(ports.publishPackReady).not.toHaveBeenCalled();
    expect(ports.auditPackCreated).not.toHaveBeenCalled();
    expect(ports.auditMemberAdded).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed authorize(ctx, 'pack.prepare', job) from createPack -> this test failed (pack stored)
  it('a refused pack.prepare reads no assessment and stores nothing', async () => {
    const { useCases, store, ports } = setup({ authorize: async () => Promise.reject(new ForbiddenError()) });
    await expect(useCases.createPack(ctxAs('hiring_owner', FAISAL), shortlist())).rejects.toThrow(ForbiddenError);
    expect(ports.latestAssessment).not.toHaveBeenCalled();
    expect(store.insertPack).not.toHaveBeenCalled();
  });

  it.each([
    ['no member', { members: [] }],
    ['a blank name', { name: '   ' }],
    ['a recommendation, which no caller supplies', { members: [{ candidateId: SARA, recommendation: 'advance' }] }],
  ])('a malformed input (%s) is refused before anything is read', async (_label, over) => {
    const { useCases, store } = setup();
    await expect(useCases.createPack(ctxAs('recruiter'), shortlist(over))).rejects.toThrow();
    expect(store.insertPack).not.toHaveBeenCalled();
  });
});

describe('addMembers', () => {
  // SAFETY: mutation check: replaced newMembers(...) with `adding` in addMembers -> this test failed (Sara read and inserted again)
  it('a candidate already in the pack is ignored and keeps the snapshot she has; a new one joins after the last', async () => {
    const { useCases, store, ports } = setup({}, pack(), [member(SARA, 0, 58, 80)]);
    expect(
      await useCases.addMembers(ctxAs('recruiter'), PACK, [{ candidateId: SARA }, { candidateId: ARJUN }]),
    ).toEqual({
      added: 1,
    });
    expect(ports.latestAssessment).toHaveBeenCalledTimes(1);
    expect(store.insertMembers.mock.calls).toEqual([[[member(ARJUN, 1)]]]);
  });

  // SAFETY: mutation check: removed the auditMemberAdded loop from addMembers -> this test failed (no member_added call)
  it('records who added the new member and when, and audits only that member, after storing it', async () => {
    const { useCases, store, ports } = setup({ now: () => LATER }, pack(), [member(SARA, 0)]);
    await useCases.addMembers(ctxAs('admin', ALEX), PACK, [{ candidateId: SARA }, { candidateId: ARJUN }]);
    const arjun = { ...member(ARJUN, 1), addedBy: ALEX, addedAt: LATER };
    expect(store.insertMembers.mock.calls).toEqual([[[arjun]]]);
    expect(vi.mocked(ports.auditMemberAdded).mock.calls).toEqual([[ctxAs('admin', ALEX), JOB.jobId, arjun]]);
    expect(ports.auditPackCreated).not.toHaveBeenCalled();
    expect(vi.mocked(ports.auditMemberAdded).mock.invocationCallOrder[0]).toBeGreaterThan(
      store.insertMembers.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  // SAFETY: mutation check: removed publishMembersAdded from addMembers -> this test failed (no call)
  it('announces the added members from their first position, so the worker summarises them (AIV-P2-011); nothing new, nothing announced', async () => {
    const { useCases, ports } = setup({ now: () => LATER }, pack(), [member(SARA, 0)]);
    await useCases.addMembers(ctxAs('recruiter'), PACK, [{ candidateId: ARJUN }]);
    expect(ports.publishMembersAdded).toHaveBeenCalledWith({}, pack(), 1, LATER);
    await useCases.addMembers(ctxAs('recruiter'), PACK, [{ candidateId: SARA }]);
    expect(ports.publishMembersAdded).toHaveBeenCalledTimes(1);
  });

  it('adding only candidates already in the pack writes nothing', async () => {
    const { useCases, store, ports } = setup({}, pack(), [member(SARA, 0)]);
    expect(await useCases.addMembers(ctxAs('recruiter'), PACK, [{ candidateId: SARA }])).toEqual({ added: 0 });
    expect(store.insertMembers).not.toHaveBeenCalled();
    expect(ports.auditMemberAdded).not.toHaveBeenCalled();
  });

  it('locks the pack, and refuses a decided one', async () => {
    const { useCases, store, ports } = setup({}, pack({ status: 'decided' }), [member(SARA, 0)]);
    await expect(useCases.addMembers(ctxAs('recruiter'), PACK, [{ candidateId: ARJUN }])).rejects.toMatchObject({
      code: 'pack_decided',
    });
    expect(store.findPack).toHaveBeenCalledWith('w1', PACK, true);
    expect(store.insertMembers).not.toHaveBeenCalled();
    expect(ports.auditMemberAdded).not.toHaveBeenCalled();
  });

  it("nobody joins once the job's approved rubric version is no longer the pack's", async () => {
    const { useCases, store } = setup({ ranking: async () => ({ rubricVersionId: id(12), candidateIds: [ARJUN] }) });
    await expect(useCases.addMembers(ctxAs('recruiter'), PACK, [{ candidateId: ARJUN }])).rejects.toMatchObject({
      code: 'candidate_not_assessed',
    });
    expect(store.insertMembers).not.toHaveBeenCalled();
  });
});

describe('recordDecisions', () => {
  const members = [member(SARA, 0), member(ARJUN, 1), member(HUDA, 2)];

  it('the hiring owner records all three: stored with who and when, decided, one event, each audited last', async () => {
    const { useCases, store, ports } = setup({}, pack(), members);
    expect(await useCases.recordDecisions(ctxAs('hiring_owner', FAISAL), advanceAll())).toEqual({ decidedAt: NOW });
    const written = store.insertDecisions.mock.calls[0]?.[0] as Decision[];
    expect(written).toHaveLength(3);
    expect(written.every((d) => d.decidedBy === FAISAL && d.decidedAt === NOW && d.decision === 'advance')).toBe(true);
    expect(store.setStatus).toHaveBeenCalledWith('w1', PACK, 'decided');
    expect(ports.publishDecisionsRecorded).toHaveBeenCalledTimes(1);
    expect(ports.auditDecision).toHaveBeenCalledTimes(3);
    // The audit writes come after every other write (AGENTS.md 3.6).
    const lastOther = Math.max(
      ...[store.insertDecisions, store.setStatus, vi.mocked(ports.publishDecisionsRecorded)].map(
        (f) => f.mock.invocationCallOrder[0] ?? 0,
      ),
    );
    expect(Math.min(...vi.mocked(ports.auditDecision).mock.invocationCallOrder)).toBeGreaterThan(lastOther);
  });

  // SAFETY: mutation check: removed the mayDecide check from recordDecisions -> this test failed (decisions stored)
  it('a recruiter, allowed decision.record by role, is not the hiring owner of this job: 403 and nothing is stored', async () => {
    const { useCases, store, ports } = setup({}, pack(), members);
    await expect(useCases.recordDecisions(ctxAs('recruiter'), advanceAll())).rejects.toThrow(ForbiddenError);
    expect(store.insertDecisions).not.toHaveBeenCalled();
    expect(store.setStatus).not.toHaveBeenCalled();
    expect(ports.publishDecisionsRecorded).not.toHaveBeenCalled();
    expect(ports.auditDecision).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed authorize(ctx, 'decision.record', job) from recordDecisions -> this test failed (decisions stored)
  it('a refused decision.record stores nothing, even for the named owner', async () => {
    const { useCases, store } = setup({ authorize: async () => Promise.reject(new ForbiddenError()) }, pack(), members);
    await expect(useCases.recordDecisions(ctxAs('hiring_owner', FAISAL), advanceAll())).rejects.toThrow(ForbiddenError);
    expect(store.insertDecisions).not.toHaveBeenCalled();
  });

  it.each([
    ['a member left out', advanceAll([SARA, ARJUN]), pack(), 'decisions_incomplete'],
    ['a candidate not in the pack', advanceAll([SARA, ARJUN, id(23)]), pack(), 'decisions_incomplete'],
    ['a pack already decided', advanceAll(), pack({ status: 'decided' }), 'pack_decided'],
    ['a draft pack', advanceAll(), pack({ status: 'draft' }), 'pack_not_ready'],
    ['an unknown pack', { ...advanceAll(), packId: id(31) }, pack(), 'pack_not_found'],
  ] as const)('%s: refused (%s) and nothing is stored', async (_label, input, stored, code) => {
    const { useCases, store, ports } = setup({}, stored, members);
    await expect(useCases.recordDecisions(ctxAs('hiring_owner', FAISAL), input)).rejects.toMatchObject({ code });
    expect(store.insertDecisions).not.toHaveBeenCalled();
    expect(ports.publishDecisionsRecorded).not.toHaveBeenCalled();
  });

  it('a decision with no reason is refused before anything is read', async () => {
    const { useCases, store } = setup({}, pack(), members);
    const input = { packId: PACK, decisions: [{ candidateId: SARA, decision: 'hold' as const, note: ' ' }] };
    await expect(useCases.recordDecisions(ctxAs('hiring_owner', FAISAL), input)).rejects.toThrow();
    expect(store.findPack).not.toHaveBeenCalled();
  });
});

describe('getPack', () => {
  it("returns the pack with its members, decisions and the members' summaries so far", async () => {
    const { useCases, ports, store } = setup({}, pack(), [member(SARA, 0)]);
    const sara = {
      workspaceId: 'w1',
      packId: PACK,
      candidateId: SARA,
      status: 'unavailable' as const,
      promptVersion: null,
      summary: null,
      createdAt: NOW,
    };
    store.listSummaries.mockResolvedValue([sara]);
    expect(await useCases.getPack(ctxAs('hiring_owner', FAISAL), PACK)).toEqual({
      ...pack(),
      members: [member(SARA, 0)],
      decisions: [],
      summaries: [sara],
      mayDecide: true,
    });
    expect(ports.authorize).toHaveBeenCalledWith(ctxAs('hiring_owner', FAISAL), 'pack.view', JOB);
  });

  // AIV-P2-012: the page shows the decision controls read-only to anyone who may not record them.
  it('says only the member named on the job may decide: not a recruiter, nor an admin who is not named', async () => {
    const { useCases } = setup();
    expect((await useCases.getPack(ctxAs('recruiter'), PACK))?.mayDecide).toBe(false);
    expect((await useCases.getPack(ctxAs('admin', ALEX), PACK))?.mayDecide).toBe(false);
    expect((await useCases.getPack(ctxAs('admin', FAISAL), PACK))?.mayDecide).toBe(true);
  });

  // SAFETY: mutation check: made visible() ignore a null job -> this test failed (pack returned)
  it('is null for a pack on a job the context cannot see, and for an id that is not one', async () => {
    const { useCases } = setup({ job: async () => null });
    expect(await useCases.getPack(ctxAs('hiring_owner', FAISAL), PACK)).toBeNull();
    expect(await setup().useCases.getPack(ctxAs('recruiter'), 'not-an-id')).toBeNull();
  });
});

// AIV-P2-010: the ranking reads which packs the job has, for "Add to decision pack" and "In shortlist pack".
describe('listPacks', () => {
  it("lists the job's packs with their members, after pack.view on the job", async () => {
    const { useCases, ports, store } = setup();
    expect(await useCases.listPacks(ctxAs('recruiter'), JOB.jobId)).toEqual([
      { id: PACK, name: 'Round 2 shortlist', status: 'ready', candidateIds: [SARA] },
    ]);
    expect(ports.authorize).toHaveBeenCalledWith(ctxAs('recruiter'), 'pack.view', JOB);
    expect(store.listForJob).toHaveBeenCalledWith('w1', JOB.jobId);
  });

  // SAFETY: mutation check: removed authorize(ctx, 'pack.view', job) from listPacks -> this test failed (packs read)
  it('an interviewer is refused before anything is read', async () => {
    const { useCases, store } = setup({
      authorize: async () => {
        throw new ForbiddenError();
      },
    });
    await expect(useCases.listPacks(ctxAs('interviewer'), JOB.jobId)).rejects.toThrow(ForbiddenError);
    expect(store.listForJob).not.toHaveBeenCalled();
  });

  it('a job the context cannot see, or a malformed id, is not found', async () => {
    const { useCases, store } = setup();
    await expect(useCases.listPacks(ctxAs('recruiter'), id(99))).rejects.toMatchObject({ code: 'job_not_found' });
    await expect(useCases.listPacks(ctxAs('recruiter'), 'not-a-uuid')).rejects.toMatchObject({
      code: 'job_not_found',
    });
    expect(store.listForJob).not.toHaveBeenCalled();
  });
});
