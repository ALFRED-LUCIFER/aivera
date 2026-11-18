import { createAudit } from '@aivera/audit/composition';
import { createDb } from '@aivera/db/client';
import { withWorkspace } from '@aivera/db/with-workspace';
import { createIdentity } from '@aivera/identity/composition';
import type { Competency } from '@aivera/jobs';
import { createJobs } from '@aivera/jobs/composition';
import type { WorkspaceContext } from '@aivera/workspaces';
import { createWorkspaces } from '@aivera/workspaces/composition';
import { sql } from 'drizzle-orm';

// Playwright global setup (AIV-P0-010): the synthetic cast (docs/00-product/personas.md) gets its workspaces before the
// browser signs in. Each run creates new workspaces, which become their creators' active workspaces, so a reused local
// database works too. Huda signs in as she would before Gulf Talent Partners invites her (AIV-P1-003): no workspace.

export default async function seed() {
  // The same database as the dev server in playwright.config.ts.
  const db = createDb(process.env['E2E_DATABASE_URL'] ?? 'postgres://aivera_app:local_dev_only@localhost:5432/aivera', {
    max: 1,
  });
  // Seed sign-ins say email_verified: true, so which issuer is trusted does not matter here.
  const identity = createIdentity(db, { trustedIssuer: 'e2e-seed' });
  const workspaces = createWorkspaces(db, createAudit(db));
  const person = async (email: string, displayName: string) =>
    (
      await identity.upsertUserFromIdToken({
        issuer: 'e2e-seed',
        subject: email,
        email,
        emailVerified: true,
        displayName,
      })
    ).id;
  const workspaceOf = async (name: string, creatorUserId: string) =>
    (
      await workspaces.createWorkspace({
        name,
        company: name,
        hiringFocus: 'AI and LLM engineering',
        synthetic: true,
        creatorUserId,
      })
    ).id;

  try {
    const demo = await workspaceOf('Demo Hiring Co', await person('alex@example.com', 'Alex Recruiter'));
    // AIV-P1-007: the Senior AI Engineer's hiring owner, and an interviewer, who may not add jobs, in Demo Hiring Co.
    const headOfEngineering = await person('hassan@example.com', 'Head of Engineering');
    const rami = await person('rami@example.com', 'Rami Panel');
    await withWorkspace(db, demo, (tx) =>
      tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
        values (${demo}, ${headOfEngineering}, 'hiring_owner', 'active'), (${demo}, ${rami}, 'interviewer', 'active')`),
    );
    await workspaces.switchWorkspace({ userId: rami }, demo);
    // AIV-P1-006: "AP", the talent partner, runs workspace "Demo" with the five demo jobs (personas.md).
    const ap = await person('ap@example.com', 'AP');
    await seedDemoJobs(await workspaceOf('Demo', ap), ap);
    await workspaceOf('Nadia Freelance', await person('nadia@example.com', 'Nadia Freelance'));
    const gulf = await workspaceOf('Gulf Talent Partners', await person('omar.agency@example.com', 'Omar Agency'));

    // Lina was an interviewer at Gulf Talent Partners with it as her active workspace, then her membership was removed.
    const lina = await person('lina@example.com', 'Lina Panel');
    await withWorkspace(db, gulf, (tx) =>
      tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
        values (${gulf}, ${lina}, 'interviewer', 'active')`),
    );
    await workspaces.switchWorkspace({ userId: lina }, gulf);
    await withWorkspace(db, gulf, (tx) =>
      tx.execute(sql`update workspaces.member set status = 'removed' where user_id = ${lina}`),
    );
  } finally {
    await db.$client.end();
  }

  // The five demo jobs (personas.md) for the Jobs list (AIV-P1-006). The recruiter, as admin, approves the four approved
  // rubrics; stages are set directly because moving a job through its stages arrives with later tickets.
  async function seedDemoJobs(workspaceId: string, recruiter: string) {
    const jobs = createJobs(workspaces, createAudit(db));
    const owners = new Map<string, string>();
    for (const [title, email] of [
      ['Head of Engineering', 'head.engineering@example.com'],
      ['CPO, Payments', 'cpo.payments@example.com'],
      ['Head of Quality', 'head.quality@example.com'],
      ['VP Engineering', 'vp.engineering@example.com'],
      ['Design Director', 'design.director@example.com'],
    ] as const) {
      const id = await person(email, title);
      owners.set(title, id);
      await withWorkspace(db, workspaceId, (tx) =>
        tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
          values (${workspaceId}, ${id}, 'hiring_owner', 'active')`),
      );
    }
    const competencies: Competency[] = [
      { name: 'Delivery', evidenceExpected: 'A repository or a document', weightPercent: 60, levelNeeded: 4 },
      { name: 'Communication', evidenceExpected: 'A write-up or a reference', weightPercent: 40, levelNeeded: 3 },
    ].map((c) => ({ ...c, type: 'mandatory', origin: 'from_description' }));
    const as = <T>(fn: (ctx: WorkspaceContext) => Promise<T>) =>
      workspaces.withWorkspace({ userId: recruiter }, workspaceId, fn);
    for (const [title, jobType, team, location, owner, stage] of [
      ['Senior AI Engineer', 'ai_llm_engineering', 'Engineering', 'DIFC, Dubai', 'Head of Engineering', 'round_1'],
      [
        'Senior Product Manager, Payments',
        'product_management',
        'Product',
        'Dubai Internet City',
        'CPO, Payments',
        'round_1',
      ],
      [
        'QA Automation Engineer',
        'qa_test_automation',
        'Quality',
        'Dubai, hybrid',
        'Head of Quality',
        'collecting_evidence',
      ],
      [
        'Staff Backend Engineer',
        'software_engineering',
        'Engineering',
        'Riyadh, hybrid',
        'VP Engineering',
        'collecting_evidence',
      ],
      ['Senior Product Designer', 'product_design', 'Design', 'Abu Dhabi', 'Design Director', 'defining_rubric'],
    ] as const) {
      await as(async (ctx) => {
        const job = await jobs.createJob(ctx, {
          title,
          jobType,
          team,
          location,
          hiringOwnerUserId: owners.get(owner) ?? null,
          description: `${title}, synthetic demo job.`,
          synthetic: true,
        });
        const version = await jobs.saveRubric(ctx, job.id, { successStatement: 'Ships reliable work.', competencies });
        if (stage === 'defining_rubric') return;
        await jobs.submitRubric(ctx, version.id);
        await jobs.approveRubric(ctx, version.id);
        await ctx.tx.execute(sql`update jobs.job set stage = ${stage} where id = ${job.id}`);
      });
    }
  }
}
