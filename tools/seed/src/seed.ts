// pnpm db:seed (AIV-P0-031): the synthetic demo workspace, written through each module's contract, never raw SQL.
import { createAudit } from '@aivera/audit/composition';
import { createCandidates } from '@aivera/candidates/composition';
import type { Db } from '@aivera/db/client';
import { createIdentity } from '@aivera/identity/composition';
import { createJobs } from '@aivera/jobs/composition';
import { createWorkspaces } from '@aivera/workspaces/composition';
import {
  CANDIDATES,
  HIRING_OWNERS,
  INDUSTRY_JOBS,
  industryRubric,
  RECRUITER,
  WORKSPACE,
  type CastUser,
} from './cast.ts';

/** The cast's sign-in method: no real issuer, so no one can sign in as a seeded user. */
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
      await candidates.purgeSyntheticPeople(ctx);
      await jobs.purgeSyntheticJobs(ctx);
      await workspaces.purgeSyntheticWorkspace(ctx);
    });
    workspaceId = null;
  }
  workspaceId ??= (await workspaces.createWorkspace({ ...WORKSPACE, creatorUserId: recruiter })).id;

  const owners = await Promise.all(HIRING_OWNERS.map(userId));
  const ownerOf = (key: string) => owners[HIRING_OWNERS.findIndex((o) => o.key === key)] ?? null;
  await workspaces.withWorkspace(session, workspaceId, async (ctx) => {
    // First: a job's hiring owner must be an active member, and gets the job's grant as the job is saved (AIV-P1-056).
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
          competencies: industryRubric(job),
        });
        jobIds.set(job.title, created.job.id);
      }
  });
  return workspaceId;
}
