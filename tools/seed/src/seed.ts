// pnpm db:seed (AIV-P0-031): the synthetic demo workspace, written through each module's contract, never raw SQL.
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import type { Db } from '@credalent/db/client';
import { createEvidence } from '@credalent/evidence/composition';
import { createIdentity } from '@credalent/identity/composition';
import { createIntake, findApplication } from '@credalent/intake/composition';
import { createInterviews } from '@credalent/interviews/composition';
import type { Competency } from '@credalent/jobs';
import { createApprovedRubricReads, createCatalogueReads, createJobs } from '@credalent/jobs/composition';
import type { WorkspaceContext } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import {
  CANDIDATES,
  EVIDENCE,
  HIRING_OWNERS,
  INDUSTRY_JOBS,
  industryRubric,
  INTERVIEWS,
  JOBS,
  RECRUITER,
  WORKSPACE,
  type CastCandidate,
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
 * `now` sets the day the demo interviews count from. Returns the demo workspace id.
 */
export async function seedDemo(
  db: Db,
  { appEnv, reset = false, now = new Date() }: { appEnv: string | undefined; reset?: boolean; now?: Date },
) {
  // shortcut: trusts APP_ENV, not the database; APP_ENV=local against a pilot DATABASE_URL would add (never purge) a
  // synthetic workspace there. Check the server's environment marker once databases carry one.
  if (!SYNTHETIC_ENVS.includes(appEnv ?? '')) throw new SeedRefused();
  const identity = createIdentity(db, { trustedIssuer: SEED_ISSUER });
  const audit = createAudit(db);
  const workspaces = createWorkspaces(db, audit);
  const candidates = createCandidates(workspaces);
  const jobs = createJobs(workspaces, audit);
  const evidence = createEvidence(workspaces, audit);
  const { approvedRubric } = createApprovedRubricReads();
  const intake = createIntake(workspaces, candidates, jobs, displayNamesInWorkspace, audit, () => now);
  const interviews = createInterviews(workspaces, jobs, approvedRubric, findApplication, () => now);
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
  // shortcut: the demo is the recruiter's active workspace, so two seeds started at once can create two; find it by the synthetic
  // flag under a lock if concurrent seeding ever matters.
  let workspaceId = await workspaces.activeWorkspace(recruiter);
  if (workspaceId && reset) {
    await workspaces.withWorkspace(session, workspaceId, async (ctx) => {
      // Interviews and applications first: no foreign key across modules would stop them outliving their people and jobs.
      // shortcut: assessment.* has no purge; if a worker assessed the demo's applicants (a rubric approved again on
      // dev), their results outlive the reset under the old workspace id. Add purgeSyntheticAssessments when the seed
      // adds scores (AIV-P1-030).
      // shortcut: decisions.* has no purge either (and its members and decisions cannot be deleted by the app role);
      // the seed writes no pack, so only packs made by hand on dev outlive the reset. Add a purge with the seeded pack.
      await interviews.purgeSyntheticInterviews(ctx);
      await intake.purgeSyntheticApplications(ctx);
      await evidence.purgeSyntheticEvidence(ctx);
      await candidates.purgeSyntheticPeople(ctx);
      await jobs.purgeSyntheticJobs(ctx);
      await workspaces.purgeSyntheticWorkspace(ctx);
    });
    workspaceId = null;
  }
  workspaceId ??= (await workspaces.createWorkspace({ ...WORKSPACE, creatorUserId: recruiter })).id;

  // Read before the transaction below: it holds the seed's one connection (cli.ts max: 1), so a read on `db` inside it
  // would wait for a connection that never frees and the seed would hang.
  const catalogue = await createCatalogueReads(db).getPublishedCatalogue();
  const owners = await Promise.all(HIRING_OWNERS.map(userId));
  const ownerOf = (key: string) => owners[HIRING_OWNERS.findIndex((o) => o.key === key)] ?? null;
  const asRecruiter = <T>(fn: (ctx: WorkspaceContext) => Promise<T>) =>
    workspaces.withWorkspace(session, workspaceId, fn);
  const seeded = await asRecruiter(async (ctx) => {
    // First, though audited before the jobs (AGENTS.md 3.6 asks audit last): a job's hiring owner must already be an
    // active member, and gets the job's grant, audited, as the job is saved (AIV-P1-056).
    // AIV-P2-002: each with their title, which the Interviews list and My desk name them by ("CPO, Payments").
    for (const [i, owner] of owners.entries())
      await workspaces.addSyntheticMember(ctx, owner, 'hiring_owner', HIRING_OWNERS[i]?.title);
    for (const c of CANDIDATES) await candidates.findOrCreatePerson(ctx, personOf(c));
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
          competencies: industryRubric(job, catalogue),
        });
        jobIds.set(job.title, created.job.id);
      }
    return new Set(jobIds.keys());
  });

  // AIV-P1-067: each design job as the design shows it, on the seed clock so a reseed writes the same dates: added
  // on its own date, each rubric version saved and sent by the recruiter and approved by the job's hiring owner, then moved to its stage.
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
    // Each job on its own date and hour, so the demo's timeline does not read as one script run.
    const hour = 8 + JOBS.indexOf(job);
    at(job.addedOn, hour);
    const { job: created } = await asRecruiter((ctx) =>
      designJobs.createJobWithDraftRubric(ctx, {
        title: job.title,
        jobType: job.jobType,
        team: job.team,
        location: job.location,
        description: job.description,
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
      at(approvedOn, hour + 1);
      await asRecruiter((ctx) => designJobs.submitRubric(ctx, saved.id));
      at(approvedOn, hour + 3);
      await workspaces.withWorkspace({ userId: owner }, workspaceId, (ctx) => designJobs.approveRubric(ctx, saved.id));
    }
    await asRecruiter((ctx) => designJobs.changeStage(ctx, created.id, job.stage));
  }

  // AIV-P1-024: the design candidates' Senior AI Engineer evidence; a rerun skips a candidate who has some.
  // shortcut: items are not linked to rubric competencies (cast.ts names each one) because the jobs contract does not
  // expose competency ids yet; link them, with a level each, in AIV-P1-027, then assess with @credalent/assessment
  // (AIV-P1-030), which scores Sara 63 up to 83, not the design's illustrative 68 up to 84.
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

  // AIV-P2-001: the Interviews artboard's five ongoing interviews, each on its candidate's application to the job. A
  // rerun skips an application that has an interview.
  // shortcut: a cancelled interview is in neither list, so its application would get a second one; nothing cancels yet.
  await asRecruiter(async (ctx) => {
    const jobIds = new Map((await jobs.listJobs(ctx)).map((j) => [j.title, j.id]));
    const planned = new Set(
      [
        ...(await interviews.listInterviews(ctx, 'ongoing')),
        ...(await interviews.listInterviews(ctx, 'completed')),
      ].map((i) => i.applicationId),
    );
    for (const i of INTERVIEWS) {
      const jobId = jobIds.get(i.job);
      const candidate = CANDIDATES.find((c) => c.displayName === i.candidate);
      if (!jobId || !candidate) throw new Error('A demo interview names a job or candidate the cast lacks');
      const rubric = await approvedRubric(ctx.tx, ctx.workspaceId, jobId);
      if (!rubric) throw new Error(`The demo job ${i.job} has no approved rubric to interview on`);
      const interviewerUserId = i.interviewer ? ownerOf(i.interviewer) : recruiter;
      if (!interviewerUserId) throw new Error(`No hiring owner ${i.interviewer}`);
      const applied = (await intake.listApplicationsForJob(ctx, jobId)).find((a) => a.displayName === i.candidate);
      // No batch: the worker never reads the arrival, so the demo's applications cost no AI call.
      // shortcut: the application stays at stage `new` though its interview is under way; intake has no contract to
      // move a stage yet. Set `in_process` here when choose-for-interview (AIV-P1-114) adds one.
      const applicationId =
        applied?.applicationId ??
        (await intake.receiveApplication(ctx, { jobId, person: personOf(candidate), source: 'linkedin' }))
          .applicationId;
      if (planned.has(applicationId)) continue;
      const { interviewId } = await interviews.createInterview(ctx, {
        applicationId,
        round: i.round,
        interviewerUserId,
        scheduledAt: new Date(`${gulfDay(now, i.day)}T${i.time}:00+04:00`),
        competencyIds: i.competencies.map((name) => {
          const found = rubric.competencies.find((c) => c.name === name);
          if (!found) throw new Error(`No competency ${name} in the approved rubric`);
          return found.id;
        }),
      });
      if (i.started) await interviews.startInterview(ctx, interviewId);
    }
  });
  return workspaceId;
}

/** The Gulf (UTC+4) calendar date `days` from `now`, as YYYY-MM-DD. */
const gulfDay = (now: Date, days: number) =>
  new Date(now.getTime() + (4 + 24 * days) * 3_600_000).toISOString().slice(0, 10);

const personOf = (c: CastCandidate) => ({
  displayName: c.displayName,
  identifiers: [
    { type: 'email' as const, value: c.email },
    { type: 'phone' as const, value: c.phone },
  ],
  location: c.location,
  synthetic: c.synthetic,
});

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
