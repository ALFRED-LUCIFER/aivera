import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadJobPacks, loadPack, loadPackPreview } from './loadPack.ts';

// AIV-P2-010, AIV-P2-011: the pack page's reads, with the workspace context, decisions, jobs and intake faked. Their own checks are
// proven against PostgreSQL in tests/integration/src/decisions.test.ts. Synthetic cast and ids only.
const id = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const [JOB, OTHER_JOB, PACK, V2] = [id(1), id(2), id(3), id(4)];
const at = new Date('2026-11-17T08:00:00.000Z');
const AYESHA = id(6);
const fake = vi.hoisted(() => ({
  workspace: true,
  getPack: vi.fn(),
  listPacks: vi.fn(),
  header: vi.fn(),
  applicants: vi.fn(),
  getUser: vi.fn(),
  getWorkspace: vi.fn(),
  approvedRubric: vi.fn(),
  latest: vi.fn(),
}));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (c: object) => Promise<unknown>) => (fake.workspace ? { value: await fn({}) } : null),
  getWorkspaces: () => ({ getWorkspace: fake.getWorkspace }),
}));
vi.mock('@/server/decisions', () => ({ getDecisions: () => ({ getPack: fake.getPack, listPacks: fake.listPacks }) }));
vi.mock('@/server/jobs', () => ({
  getJobs: () => ({ getJobHeader: fake.header }),
  getApprovedRubricReads: () => ({ approvedRubric: fake.approvedRubric }),
}));
vi.mock('@/server/assessment', () => ({ getAssessment: () => ({ getLatestAssessment: fake.latest }) }));
vi.mock('@/server/auth', () => ({ getIdentity: () => ({ getUser: fake.getUser }) }));
vi.mock('@/server/intake', () => ({ getIntake: () => ({ listApplicationsForJob: fake.applicants }) }));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
}));

const stored = (jobId = JOB) => ({
  id: PACK,
  jobId,
  name: 'Round 2 shortlist',
  rubricVersionId: V2,
  preparedAt: at,
  members: [{ candidateId: 'p1', backedScore: 68, upperBound: 84, addedBy: AYESHA, addedAt: at }],
  summaries: [],
  decisions: [] as { candidateId: string; decision: string; decidedBy: string; decidedAt: Date }[],
  mayDecide: false,
});
const [LLM, COST] = [id(10), id(11)];
const RUBRIC = {
  id: V2,
  competencies: [
    { id: LLM, name: 'LLM systems in production', weightPercent: 60 },
    { id: COST, name: 'Cost and reliability', weightPercent: 40 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.workspace = true;
  fake.getPack.mockResolvedValue(stored());
  fake.getUser.mockResolvedValue({ id: AYESHA, email: 'ap@example.com', displayName: 'Ayesha Perera' });
  fake.header.mockResolvedValue({
    job: { title: 'Senior AI Engineer' },
    approved: { id: V2, version: 2, successStatement: 'Ships reliable AI features.' },
  });
  fake.applicants.mockResolvedValue([
    { personId: 'p1', displayName: 'Sara Al Qahtani' },
    { personId: 'p2', displayName: 'Arjun Menon' },
  ]);
  fake.approvedRubric.mockResolvedValue(RUBRIC);
});

describe('loadPack', () => {
  it('the pack with the job, its rubric version, each member by name, and how many others stay in the ranking', async () => {
    expect(await loadPack(JOB, PACK)).toEqual({
      jobId: JOB,
      packId: PACK,
      name: 'Round 2 shortlist',
      job: 'Senior AI Engineer',
      preparedAt: at,
      rubricVersion: 2,
      role: {
        successStatement: 'Ships reliable AI features.',
        competencies: [
          { name: 'LLM systems in production', weightPercent: 60 },
          { name: 'Cost and reliability', weightPercent: 40 },
        ],
      },
      members: [
        {
          candidateId: 'p1',
          name: 'Sara Al Qahtani',
          backedScore: 68,
          upperBound: 84,
          added: { by: 'Ayesha Perera', at },
          summary: { status: 'preparing' },
          decision: null,
        },
      ],
      others: 1,
      mayDecide: false,
      decided: null,
    });
    expect(fake.getUser).toHaveBeenCalledWith(AYESHA);
  });

  // AIV-P2-012: "Already decided": the decisions are shown read-only with who recorded them and when.
  it('a decided pack: each member with their decision, and who recorded the decisions and when', async () => {
    const HASSAN = id(8);
    const decidedAt = new Date('2026-11-18T09:30:00.000Z');
    fake.getPack.mockResolvedValue({
      ...stored(),
      mayDecide: true,
      decisions: [{ candidateId: 'p1', decision: 'advance', decidedBy: HASSAN, decidedAt }],
    });
    fake.getUser.mockImplementation(async (userId: string) =>
      userId === HASSAN ? { id: HASSAN, email: 'hassan@example.com', displayName: 'Hassan Haddad' } : null,
    );
    const page = await loadPack(JOB, PACK);
    expect(page !== 'notFound' && page && [page.mayDecide, page.decided, page.members[0]?.decision]).toEqual([
      true,
      { by: 'Hassan Haddad', at: decidedAt },
      'advance',
    ]);
  });

  it('who added a member: their email with no display name; no line once the account is gone, nor on older members', async () => {
    fake.getPack.mockResolvedValue({
      ...stored(),
      members: [
        { candidateId: 'p1', backedScore: 68, upperBound: 84, addedBy: AYESHA, addedAt: at },
        { candidateId: 'p2', backedScore: 64, upperBound: 76, addedBy: id(7), addedAt: at },
        { candidateId: 'p3', backedScore: 60, upperBound: 76, addedBy: null, addedAt: null },
      ],
    });
    fake.getUser.mockImplementation(async (userId: string) =>
      userId === AYESHA ? { id: AYESHA, email: 'ap@example.com', displayName: null } : null,
    );
    const page = await loadPack(JOB, PACK);
    expect(page !== 'notFound' && page?.members.map((m) => m.added)).toEqual([
      { by: 'ap@example.com', at },
      null,
      null,
    ]);
  });

  it('no rubric version, role or weights once the job has approved another', async () => {
    fake.header.mockResolvedValue({ job: { title: 'Senior AI Engineer' }, approved: { id: id(9), version: 3 } });
    fake.approvedRubric.mockResolvedValue({ ...RUBRIC, id: id(9) });
    expect(await loadPack(JOB, PACK)).toMatchObject({ rubricVersion: null, role: null });
  });

  // SAFETY: mutation check: removed the `pack?.jobId !== jobId` check from loadPack -> this test failed (the pack was returned)
  it("a pack of another job under this job's address is not found, and nothing else is read", async () => {
    fake.getPack.mockResolvedValue(stored(OTHER_JOB));
    expect(await loadPack(JOB, PACK)).toBe('notFound');
    expect(fake.applicants).not.toHaveBeenCalled();
  });

  it('a missing pack, or a malformed id, is not found', async () => {
    fake.getPack.mockResolvedValue(null);
    expect(await loadPack(JOB, PACK)).toBe('notFound');
    fake.getPack.mockClear();
    expect(await loadPack('not-a-uuid', PACK)).toBe('notFound');
    expect(await loadPack(JOB, 'not-a-uuid')).toBe('notFound');
    expect(fake.getPack).not.toHaveBeenCalled();
  });

  it('an interviewer gets the 403 page; no workspace is null', async () => {
    fake.getPack.mockRejectedValue(new ForbiddenError());
    await expect(loadPack(JOB, PACK)).rejects.toThrow('403');
    fake.workspace = false;
    expect(await loadPack(JOB, PACK)).toBeNull();
  });
});

describe('card text (AIV-P2-011) and loadPackPreview (AIV-P1-116)', () => {
  const [SNAP_SARA, SNAP_ARJUN] = [id(12), id(13)];
  const result = (proven: number, claimed: number, needed: number, competencyId: string, weightPercent: number) => ({
    competencyId,
    weightPercent,
    levelNeeded: needed,
    mandatory: true,
    proven: proven === 0 ? { level: 0, itemIds: [] } : { level: proven, itemIds: [id(20)] },
    claimedLevel: claimed,
    claimItemIds: [],
  });
  const summary = {
    strengths: [
      {
        text: 'The candidate authored 412 of 460 commits.',
        citations: [{ itemId: id(20), label: 'llm-eval-harness', quote: 'authored 412 of 460 commits' }],
      },
    ],
    risks: [],
    round1: null,
    recommendation: {
      action: 'advance',
      focus: null,
      citations: [{ itemId: null, label: 'Assessment', quote: 'Work meets' }],
    },
  };
  const summaryRow = (candidateId: string, ready: boolean) => ({
    candidateId,
    status: ready ? 'ready' : 'unavailable',
    promptVersion: ready ? 'decisions.summariseMember@1' : null,
    summary: ready ? summary : null,
  });

  beforeEach(() => {
    fake.getPack.mockResolvedValue({
      ...stored(),
      members: [
        { candidateId: 'p1', assessmentId: SNAP_SARA, backedScore: 68, upperBound: 84, addedBy: null, addedAt: null },
        { candidateId: 'p2', assessmentId: SNAP_ARJUN, backedScore: 64, upperBound: 76, addedBy: null, addedAt: null },
      ],
      summaries: [summaryRow('p1', true), summaryRow('p2', false)],
    });
    fake.getWorkspace.mockResolvedValue({ name: 'Gulf Talent Partners' });
    fake.latest.mockImplementation(async (_ctx: object, candidateId: string) => ({
      id: candidateId === 'p1' ? SNAP_SARA : SNAP_ARJUN,
      competencies: [result(4, 4, 3, LLM, 60), result(1, 4, 2, COST, 40)],
    }));
  });

  it("the workspace's name, the pack, and per member the stored cited summary, or the assessment's own levels when it is unavailable; no model is called", async () => {
    const preview = await loadPackPreview(JOB, PACK);
    expect(preview).toEqual({
      workspace: 'Gulf Talent Partners',
      name: 'Round 2 shortlist',
      job: 'Senior AI Engineer',
      preparedAt: at,
      members: [
        {
          candidateId: 'p1',
          name: 'Sara Al Qahtani',
          backedScore: 68,
          upperBound: 84,
          summary: { status: 'ready', summary },
        },
        {
          candidateId: 'p2',
          name: 'Arjun Menon',
          backedScore: 64,
          upperBound: 76,
          summary: {
            status: 'unavailable',
            strengths: [{ competencyId: LLM, name: 'LLM systems in production', proven: 4, claimed: 4, needed: 3 }],
            risks: [{ competencyId: COST, name: 'Cost and reliability', proven: 1, claimed: 4, needed: 2 }],
          },
        },
      ],
    });
    // Only the unavailable member's assessment is read, for its levels.
    expect(fake.latest).toHaveBeenCalledTimes(1);
  });

  it('a member with no summary stored yet is "preparing", and nothing is read for it', async () => {
    fake.getPack.mockResolvedValue({ ...(await fake.getPack()), summaries: [] });
    fake.getPack.mockClear();
    const page = await loadPack(JOB, PACK);
    expect(page !== 'notFound' && page?.members.map((m) => m.summary)).toEqual([
      { status: 'preparing' },
      { status: 'preparing' },
    ]);
    expect(fake.latest).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed the `latest?.id !== member.assessmentId` check from cardOf -> this test failed (Arjun's newer levels were shown)
  it('an unavailable member whose assessment changed after joining shows no levels from the newer one', async () => {
    fake.latest.mockResolvedValue({ id: id(14), competencies: [result(4, 4, 3, LLM, 60)] });
    const page = await loadPack(JOB, PACK);
    expect(page !== 'notFound' && page?.members[1]?.summary).toEqual({
      status: 'unavailable',
      strengths: [],
      risks: [],
    });
  });

  it('once another rubric version is approved, an unavailable member reads no assessment (its competencies would have no names)', async () => {
    fake.approvedRubric.mockResolvedValue({ ...RUBRIC, id: id(15) });
    const page = await loadPack(JOB, PACK);
    expect(page !== 'notFound' && page?.members[1]?.summary).toEqual({
      status: 'unavailable',
      strengths: [],
      risks: [],
    });
    expect(fake.latest).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed the `pack?.jobId !== jobId` check from withPack -> this test failed (another job's pack was previewed)
  it("another job's pack, or none for a hiring owner not granted the job (getPack hides it): not found, no assessment read", async () => {
    fake.getPack.mockResolvedValue({ ...stored(OTHER_JOB), summaries: [] });
    expect(await loadPackPreview(JOB, PACK)).toBe('notFound');
    fake.getPack.mockResolvedValue(null);
    expect(await loadPackPreview(JOB, PACK)).toBe('notFound');
    expect(fake.latest).not.toHaveBeenCalled();
  });

  it('an interviewer gets the 403 page; a malformed id is not found', async () => {
    fake.getPack.mockRejectedValue(new ForbiddenError());
    await expect(loadPackPreview(JOB, PACK)).rejects.toThrow('403');
    expect(await loadPackPreview(JOB, 'not-a-uuid')).toBe('notFound');
  });
});

describe('loadJobPacks', () => {
  it("the job's undecided packs, each with its member count", async () => {
    fake.listPacks.mockResolvedValue([
      { id: PACK, name: 'Round 2 shortlist', status: 'ready', candidateIds: ['p1', 'p2'] },
      { id: id(5), name: 'Round 1 shortlist', status: 'decided', candidateIds: ['p3'] },
    ]);
    expect(await loadJobPacks(JOB)).toEqual([{ id: PACK, name: 'Round 2 shortlist', members: 2 }]);
  });

  it('an interviewer gets the 403 page; a malformed id is not found', async () => {
    fake.listPacks.mockRejectedValue(new ForbiddenError());
    await expect(loadJobPacks(JOB)).rejects.toThrow('403');
    expect(await loadJobPacks('not-a-uuid')).toBe('notFound');
  });
});
