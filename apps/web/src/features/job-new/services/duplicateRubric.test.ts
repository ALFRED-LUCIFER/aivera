import { ForbiddenError, type Role } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { duplicateRubric } from './duplicateRubric.ts';

// AIV-P1-165 "An agency can start from an earlier job or rubric" (seed cast: Omar Agency at Gulf Talent Partners).
const job = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
let role: Role = 'recruiter';
const ctx = () => ({ userId: 'u1', workspaceId: 'w1', role, tx: {} });

// As the workspaces module: every role may view a job it reaches, only admins and recruiters may create one.
const authorize = vi.fn(async (c: { role: Role }, action: string) => {
  if (action !== 'job.view' && c.role !== 'admin' && c.role !== 'recruiter') throw new ForbiddenError();
});
const competency = (name: string, weightPercent: number) => ({
  name,
  evidenceExpected: `Work that shows ${name}`,
  weightPercent,
  levelNeeded: 4,
  type: 'mandatory' as const,
  origin: 'domain_pack' as const,
  packKey: 'payments_fintech',
  packVersion: 1,
});
// A stored version as the jobs module returns it: who approved it, its notes and its ids ride along.
const version = (status: string, names: [string, number][]) => ({
  id: `v-${status}`,
  workspaceId: 'w1',
  jobId: job,
  version: 1,
  status,
  successStatement: 'Ships the ledger',
  changeNote: 'Raised API design',
  returnNote: 'Too heavy on Go',
  createdBy: 'u9',
  approvedBy: 'u8',
  competencies: names.map(([name, weight]) => competency(name, weight)),
});
const listRubricVersions = vi.fn();

// As in server/workspace.ts: the declared policy runs before the handler, and a refusal renders the 403 page.
vi.mock('@/server/workspace', () => ({
  workspaceAction:
    (
      action: string,
      handler: (c: ReturnType<typeof ctx>, input: string) => Promise<unknown>,
      options: { input: { parse: (raw: unknown) => string } },
    ) =>
    async (raw: unknown) => {
      const input = options.input.parse(raw);
      try {
        await authorize(ctx(), action);
      } catch (error) {
        if (error instanceof ForbiddenError) throw new Error('NEXT_HTTP_ERROR_FALLBACK;403', { cause: error });
        throw error;
      }
      return handler(ctx(), input);
    },
}));
vi.mock('@/server/jobs', () => ({ getJobs: () => ({ listRubricVersions }) }));

beforeEach(() => {
  vi.clearAllMocks();
  role = 'recruiter';
});

describe('duplicateRubric', () => {
  // SAFETY: mutation check: returned `source.competencies` instead of mapping through copiedCompetency -> this test
  // failed (origin domain_pack, packKey and packVersion came through)
  it('copies the competencies of the approved version, field by field, and nothing else of the job', async () => {
    listRubricVersions.mockResolvedValueOnce([
      version('draft', [['Newer draft only', 100]]),
      version('approved', [
        ['API design', 60],
        ['Ledger domain', 40],
      ]),
    ]);
    const copied = await duplicateRubric(job);
    expect(listRubricVersions).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1' }), job);
    // Exactly these fields: no id, no note, no approver, and the copy is the recruiter's own row from here on.
    expect(copied).toEqual([
      {
        name: 'API design',
        evidenceExpected: 'Work that shows API design',
        weightPercent: 60,
        levelNeeded: 4,
        type: 'mandatory',
        origin: 'added_by_recruiter',
        why: null,
        excerpts: [],
        pack: null,
      },
      {
        name: 'Ledger domain',
        evidenceExpected: 'Work that shows Ledger domain',
        weightPercent: 40,
        levelNeeded: 4,
        type: 'mandatory',
        origin: 'added_by_recruiter',
        why: null,
        excerpts: [],
        pack: null,
      },
    ]);
    expect(JSON.stringify(copied)).not.toMatch(/Raised API design|Too heavy on Go|Ships the ledger|u8|u9|v-approved/);
  });

  it('copies the latest version when none is approved yet', async () => {
    listRubricVersions.mockResolvedValueOnce([version('draft', [['Go services', 100]]), version('superseded', [])]);
    expect((await duplicateRubric(job))?.map((c) => c.name)).toEqual(['Go services']);
  });

  it("a job the caller's workspace does not hold, or with no rubric, copies nothing", async () => {
    // The jobs module answers null for a job outside the workspace or the caller's job scope (ADR-005).
    listRubricVersions.mockResolvedValueOnce(null);
    expect(await duplicateRubric(job)).toBeNull();
    listRubricVersions.mockResolvedValueOnce([]);
    expect(await duplicateRubric(job)).toBeNull();
  });

  // SAFETY: mutation check: changed the declared action from 'job.create' to 'job.view' -> this test failed (the
  // interviewer's call reached listRubricVersions)
  it.each(['interviewer', 'hiring_owner'] as const)('refuses a %s before anything is read', async (refused) => {
    role = refused;
    await expect(duplicateRubric(job)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
    expect(listRubricVersions).not.toHaveBeenCalled();
  });

  it('refuses an id that is not a uuid before anything is read', async () => {
    await expect(duplicateRubric("x' OR 1=1")).rejects.toThrow();
    expect(authorize).not.toHaveBeenCalled();
    expect(listRubricVersions).not.toHaveBeenCalled();
  });
});
