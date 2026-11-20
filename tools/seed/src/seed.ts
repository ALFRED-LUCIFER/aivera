// pnpm db:seed (AIV-P0-031): the synthetic demo workspace, written through each module's contract, never raw SQL.
import { createAudit } from '@credalent/audit/composition';
import { createCandidates } from '@credalent/candidates/composition';
import type { Db } from '@credalent/db/client';
import { createEvidence } from '@credalent/evidence/composition';
import { createIdentity } from '@credalent/identity/composition';
import type { Competency } from '@credalent/jobs';
import { createCatalogueReads, createJobs } from '@credalent/jobs/composition';
import type { WorkspaceContext } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import {
  CANDIDATES,
  EVIDENCE,
  HIRING_OWNERS,
  INDUSTRY_JOBS,
  industryRubric,
  JOBS,
  RECRUITER,
  WORKSPACE,
  type CastCompetency,
  type CastUser,
} from './cast.ts';

/** The cast's sign-in method: no real issuer, so no one can sign in as a seeded user. */
// Kept after the Credalent rename: seeded identities on dev are keyed by this issuer; a new one would duplicate them.
export const SEED_ISSUER = 'https://seed.aivera.example';

/** The APP_ENV values that hold synthetic data only (apps/web/src/server/env.ts); anything else, unset too, is refused. */
const SYNTHETIC_ENVS = ['local', 'dev'];

export class SeedRefused extends Error {
  constructor() {
    super('Seeding is not allowed in production');
    this.name = 'SeedRefused';
  }
}

/**
 * Seeds the demo workspace, or tops it up: running it again adds and changes nothing. `reset` first purges the demo
 * workspace (the recruiter's active workspace), which each module refuses unless it is flagged synthetic.
 * Returns the demo workspace id.
 */
export async function seedDemo(db: Db, { appEnv, reset = false }: { appEnv: string | undefined; reset?: boolean }) {
  // shortcut: trusts APP_ENV, not the database; APP_ENV=local against a pilot DATABASE_URL would add (never purge) a
  // synthetic workspace there. Check the server's environment marker once databases carry one.
  if (!SYNTHETIC_ENVS.includes(appEnv ?? '')) throw new SeedRefused();
  const identity = createIdentity(db, { trustedIssuer: SEED_ISSUER });
  const audit = createAudit(db);
  const workspaces = createWorkspaces(db, audit);
  const candidates = createCandidates(workspaces);
  const jobs = createJobs(workspaces, audit);
  const evidence = createEvidence(workspaces, audit);
  const userId = async (u: CastUser) =>
    (
      await identity.upsertUserFromIdToken({
        issuer: SEED_ISSUER,
        subject: u.key,
        email: u.email,
        emailVerified: true,
        displayName: u.displayName,
      })
    ).id;

  const recruiter = await userId(RECRUITER);
  const session = { userId: recruiter };
  // shortcut: the demo is AP's active workspace, so two seeds started at once can create two; find it by the synthetic
  // flag under a lock if concurrent seeding ever matters.
  let workspaceId = await workspaces.activeWorkspace(recruiter);
  if (workspaceId && reset) {
    await workspaces.withWorkspace(session, workspaceId, async (ctx) => {
      await evidence.purgeSyntheticEvidence(ctx);
      await candidates.purgeSyntheticPeople(ctx);
      await jobs.purgeSyntheticJobs(ctx);
      await workspaces.purgeSyntheticWorkspace(ctx);
    });
    workspaceId = null;
  }
  workspaceId ??= (await workspaces.createWorkspace({ ...WORKSPACE, creatorUserId: recruiter })).id;

  const owners = await Promise.all(HIRING_OWNERS.map(userId));
  const ownerOf = (key: string) => owners[HIRING_OWNERS.findIndex((o) => o.key === key)] ?? null;
  const asRecruiter = <T>(fn: (ctx: WorkspaceContext) => Promise<T>) =>
    workspaces.withWorkspace(session, workspaceId, fn);
  const seeded = await asRecruiter(async (ctx) => {
    // First, though audited before the jobs (AGENTS.md 3.6 asks audit last): a job's hiring owner must already be an
    // active member, and gets the job's grant, audited, as the job is saved (AIV-P1-056).
    for (const owner of owners) await workspaces.addSyntheticMember(ctx, owner, 'hiring_owner');
    for (const c of CANDIDATES)
      await candidates.findOrCreatePerson(ctx, {
        displayName: c.displayName,
        identifiers: [
          { type: 'email', value: c.email },
          { type: 'phone', value: c.phone },
        ],
        location: c.location,
        synthetic: c.synthetic,
      });
    // AIV-P1-065: a job is found again by its title; each new one gets its draft rubric v1, audited as `job.created`.
    // shortcut: a demo job renamed in the app is seeded again on the next run; match on a seed key if that matters.
    const jobIds = new Map((await jobs.listJobs(ctx)).map((j) => [j.title, j.id]));
    const catalogue = await createCatalogueReads(db).getPublishedCatalogue();
    for (const job of INDUSTRY_JOBS)
      if (!jobIds.has(job.title)) {
        const created = await jobs.createJobWithDraftRubric(ctx, {
          title: job.title,
          jobType: job.jobType,
          team: job.team,
          location: job.location,
          description: job.description,
          hiringOwnerUserId: ownerOf(job.hiringOwner),
          synthetic: true,
          competencies: industryRubric(job, catalogue),
        });
        jobIds.set(job.title, created.job.id);
      }
    return new Set(jobIds.keys());
  });

  // AIV-P1-067: each design job as the design shows it, on the seed clock so a reseed writes the same dates: added
  // 3 Nov, each rubric version saved and sent by AP and approved by the job's hiring owner, then moved to its stage.
  // shortcut: one transaction per step (the hiring owner approves in their own), so a seed stopped midway leaves a job
  // part-seeded, which a rerun skips; run with --reset then. Resume from the job's state if that ever bites.
  // Only the jobs module's writes and audit entries take this clock; the hiring owner's grant is audited at real time.
  let seedTime = new Date(0);
  const at = (date: string, hour: number) => (seedTime = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`));
  const clock = () => seedTime;
  const designJobs = createJobs(workspaces, createAudit(db, clock), clock);
  for (const job of JOBS.filter((j) => !seeded.has(j.title))) {
    const owner = ownerOf(job.hiringOwner);
    if (!owner) throw new Error(`No hiring owner ${job.hiringOwner}`);
    const versions = [...(job.supersedes ? [job.supersedes] : []), job.rubric];
    at('2026-11-03', 8);
    const { job: created } = await asRecruiter((ctx) =>
      designJobs.createJobWithDraftRubric(ctx, {
        title: job.title,
        jobType: job.jobType,
        team: job.team,
        location: job.location,
        description: `${job.title}, a synthetic demo job.`,
        hiringOwnerUserId: owner,
        synthetic: true,
        competencies: rubricOf(versions[0]?.competencies ?? []),
      }),
    );
    for (const { approvedOn, competencies, ...version } of versions) {
      // Version 1 is the draft above, edited in place; a later one starts the next version.
      const saved = await asRecruiter((ctx) =>
        designJobs.saveRubric(ctx, created.id, {
          successStatement: job.successStatement,
          changeNote: 'changeNote' in version ? version.changeNote : null,
          competencies: rubricOf(competencies),
        }),
      );
      if (!approvedOn) break;
      at(approvedOn, 8);
      await asRecruiter((ctx) => designJobs.submitRubric(ctx, saved.id));
      at(approvedOn, 10);
      await workspaces.withWorkspace({ userId: owner }, workspaceId, (ctx) => designJobs.approveRubric(ctx, saved.id));
    }
    await asRecruiter((ctx) => designJobs.changeStage(ctx, created.id, job.stage));
  }

  // AIV-P1-024: the design candidates' Senior AI Engineer evidence; a rerun skips a candidate who has some.
  // shortcut: items are not linked to rubric competencies (cast.ts names each one) because the jobs contract does not
  // expose competency ids yet, and the design's scores (Sara 68 up to 84, …) need scoring; link them with AIV-P1-027
  // and check the scores with AIV-P1-030.
  await asRecruiter(async (ctx) => {
    const people = new Map((await candidates.listPeople(ctx)).map((p) => [p.displayName, p.id]));
    const jobId = (await jobs.listJobs(ctx)).find((j) => j.title === 'Senior AI Engineer')?.id;
    if (!jobId) throw new Error('No Senior AI Engineer job');
    for (const name of new Set(EVIDENCE.map((e) => e.candidate))) {
      const candidateId = people.get(name);
      if (!candidateId) throw new Error('A design candidate with evidence is missing from the cast');
      if ((await evidence.listEvidenceForCandidate(ctx, candidateId, jobId)).length > 0) continue;
      for (const { source, items } of EVIDENCE.filter((e) => e.candidate === name))
        await evidence.recordEvidence(ctx, {
          candidateId,
          source: {
            kind: source.kind,
            label: source.label,
            url: source.url ?? null,
            blobFileId: null,
            capturedAt: day(source.capturedOn),
            checkedAt: source.checkedOn ? day(source.checkedOn) : null,
            checkMethod: source.checkMethod ?? null,
          },
          items: items.map((i) => ({
            excerpt: i.excerpt,
            excerptSpan: i.excerptSpan ?? null,
            provenance: i.provenance,
            strength: i.strength,
            limit: i.limit,
          })),
          synthetic: true,
        });
    }
  });
  return workspaceId;
}

const day = (date: string) => new Date(`${date}T08:00:00Z`);

/** The cast's competencies as rubric rows: from the description, or suggested by Credalent and accepted. */
function rubricOf(competencies: CastCompetency[]): Competency[] {
  return competencies.map((c) => ({
    name: c.name,
    evidenceExpected: c.evidence,
    weightPercent: c.weight,
    levelNeeded: c.level,
    type: c.type,
    origin: c.suggested ? 'suggested_by_aivera' : 'from_description',
  }));
}
