import { createAudit } from '@aivera/audit/composition';
import { CandidateAccountError } from '@aivera/candidate-accounts';
import { createCandidateAccounts } from '@aivera/candidate-accounts/composition';
import { createDb } from '@aivera/db/client';
import { withWorkspace } from '@aivera/db/with-workspace';
import { createIdentity } from '@aivera/identity/composition';
import type { Competency } from '@aivera/jobs';
import { createJobs } from '@aivera/jobs/composition';
import type { WorkspaceContext } from '@aivera/workspaces';
import { createAiTokenBudget, createWorkspaces } from '@aivera/workspaces/composition';
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
    // AIV-P2-038 Background: Demo Hiring Co has used 1,500 AI tokens today (the UTC day).
    await createAiTokenBudget(db).add(demo, new Date().toISOString().slice(0, 10), 1_500);
    // AIV-P1-006: "AP", the talent partner, runs workspace "Demo" with the five demo jobs (personas.md).
    const ap = await person('ap@example.com', 'AP');
    await seedDemoJobs(await workspaceOf('Demo', ap), ap);
    await seedCandidateSiteJobs(await person('employer@example.com', 'Employer Recruiter'));
    // AIV-P3-007: Sara has signed up on the candidate site, so her sign-in lands on My applications.
    const accounts = createCandidateAccounts(db);
    await accounts
      .withAccount(await person('sara@example.com', 'Sara Al Qahtani'), (ctx) =>
        accounts.signUp(ctx, { fullName: 'Sara Al Qahtani', workType: 'ai_llm_engineering' }),
      )
      .catch((error: unknown) => {
        // A reused local database: she signed up on an earlier run.
        if (!(error instanceof CandidateAccountError && error.code === 'already_signed_up')) throw error;
      });
    // AIV-P1-008: drafting spends AI tokens, so it runs in workspaces whose figures no other spec reads. Karim's has
    // used its whole daily budget (the platform default, AI_DAILY_TOKEN_BUDGET) today.
    await workspaceOf('Draft Studio', await person('mira@example.com', 'Mira Recruiter'));
    const spent = await workspaceOf('Spent Budget Co', await person('karim@example.com', 'Karim Recruiter'));
    await createAiTokenBudget(db).add(spent, new Date().toISOString().slice(0, 10), 2_000_000);
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
    // AIV-P2-036 Background: Gulf Talent Partners is an agency with 4 active members (Lina's removed membership is not
    // counted) and 2 jobs, for the operator console. Nadia and Faisal per personas.md; Rami also interviews here.
    const nadia = await person('nadia@example.com', 'Nadia Freelance');
    const faisal = await person('faisal@example.com', 'Faisal Client');
    await withWorkspace(db, gulf, (tx) =>
      tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
        values (${gulf}, ${nadia}, 'recruiter', 'active'), (${gulf}, ${faisal}, 'hiring_owner', 'active'),
          (${gulf}, ${rami}, 'interviewer', 'active')`),
    );
    const omar = await person('omar.agency@example.com', 'Omar Agency');
    const gulfJobs = createJobs(workspaces, createAudit(db));
    await workspaces.withWorkspace({ userId: omar }, gulf, async (ctx) => {
      await workspaces.setWorkspaceType(ctx, 'agency');
      for (const title of ['Senior Product Manager, Payments', 'Staff Backend Engineer'])
        await gulfJobs.createJob(ctx, {
          title,
          jobType: 'software_engineering',
          description: `${title}, synthetic demo job.`,
          synthetic: true,
        });
    });

    // AIV-P1-052: Zaid is a recruiter (not an admin) in Oasis Talent, her active workspace. Its own workspace, so the
    // operator console's figures for the workspaces above do not change.
    const oasis = await workspaceOf('Oasis Talent', await person('leila@example.com', 'Leila Agency'));
    const zaid = await person('zaid@example.com', 'Zaid Recruiter');
    await withWorkspace(db, oasis, (tx) =>
      tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
        values (${oasis}, ${zaid}, 'recruiter', 'active')`),
    );
    await workspaces.switchWorkspace({ userId: zaid }, oasis);
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

  // The candidate site's five published jobs (AIV-P3-004 Background, AIV-P3-005 Examples), in their own synthetic
  // employer workspace so the recruiter tests above see none of them. Posted dates are set back so the list shows
  // "Posted 2 days ago". A rerun on a reused database first unpublishes the previous run's five, so the counts hold.
  async function seedCandidateSiteJobs(employer: string) {
    const jobs = createJobs(workspaces, createAudit(db));
    const previous = await workspaces.activeWorkspace(employer);
    if (previous)
      await workspaces.withWorkspace({ userId: employer }, previous, async (ctx) => {
        for (const job of await jobs.listJobs(ctx)) await jobs.unpublishJob(ctx, job.id);
      });
    const workspaceId = await workspaceOf('Candidate site employers', employer);
    const others: [string, string][] = [
      ['Delivery with a team', 'Work shipped with others, and their part in it'],
      ['Clear communication', 'A write-up, a talk or a reference'],
      ['Ownership', 'Something they kept running after launch'],
      ['Learning from feedback', 'A change they made after a review'],
      ['Testing and quality', 'Tests or checks they wrote'],
    ];
    for (const [title, jobType, location, pay, descriptor, [name, evidence], daysAgo] of [
      [
        'Senior AI Engineer',
        'ai_llm_engineering',
        'DIFC, Dubai',
        [3_500_000, 4_800_000],
        'A BNPL fintech',
        ['LLM systems in production', 'A shipped assistant or RAG system with real users, and their part in it'],
        6,
      ],
      [
        'QA Automation Engineer',
        'qa_test_automation',
        'Dubai, hybrid',
        null,
        'A logistics platform',
        ['Test automation design', 'A test suite they wrote, and what it covers'],
        9,
      ],
      [
        'Senior Product Manager, Payments',
        'product_management',
        'Dubai Internet City',
        [3_800_000, 5_000_000],
        'A payments scale-up',
        ['Discovery to decision', 'Research write-ups that show how evidence became a decision'],
        9,
      ],
      [
        'Real Estate Sales Consultant',
        'sales',
        'Dubai',
        null,
        'A property brokerage',
        ['Closing sales', 'Deals they closed, with the value and their part confirmed'],
        2,
      ],
      [
        'Senior Software Engineer, Banking',
        'software_engineering',
        'Dubai',
        null,
        'A retail bank',
        [
          'System design in production',
          'A service they designed that runs in production, and the trade-offs they made',
        ],
        12,
      ],
    ] as const) {
      await workspaces.withWorkspace({ userId: employer }, workspaceId, async (ctx) => {
        const job = await jobs.createJob(ctx, {
          title,
          jobType,
          location,
          payBand: pay && { minMinor: pay[0], maxMinor: pay[1], currency: 'AED' },
          description: `${title}, synthetic demo job.`,
          synthetic: true,
        });
        const competencies: Competency[] = [[name, evidence] as const, ...others].map(([n, e], i) => ({
          name: n,
          evidenceExpected: e,
          weightPercent: [30, 20, 15, 15, 10, 10][i] ?? 0,
          levelNeeded: i === 0 ? 4 : 3,
          type: i < 2 ? 'mandatory' : 'desirable',
          origin: 'from_description',
        }));
        const version = await jobs.saveRubric(ctx, job.id, { successStatement: 'Ships reliable work.', competencies });
        await jobs.submitRubric(ctx, version.id);
        await jobs.approveRubric(ctx, version.id);
        await jobs.publishJob(ctx, job.id, { publicDescriptor: descriptor });
        await ctx.tx.execute(
          sql`update jobs.public_job set posted_at = now() - make_interval(days => ${daysAgo}) where job_id = ${job.id}`,
        );
      });
    }
  }
}
