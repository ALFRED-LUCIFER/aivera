import { createAudit } from '@credalent/audit/composition';
import { CandidateAccountError } from '@credalent/candidate-accounts';
import { createCandidateAccounts } from '@credalent/candidate-accounts/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb } from '@credalent/db/client';
import { withWorkspace } from '@credalent/db/with-workspace';
import { createIdentity } from '@credalent/identity/composition';
import { createIntake } from '@credalent/intake/composition';
import type { Source } from '@credalent/intake';
import type { Competency } from '@credalent/jobs';
import { createApprovedRubricReads, createJobs } from '@credalent/jobs/composition';
import type { WorkspaceContext } from '@credalent/workspaces';
import { createAiTokenBudget, createWorkspaces } from '@credalent/workspaces/composition';
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
    const alex = await person('alex@example.com', 'Alex Recruiter');
    const demo = await workspaceOf('Demo Hiring Co', alex);
    // AIV-P1-007: the Senior AI Engineer's hiring owner, and an interviewer, who may not add jobs, in Demo Hiring Co.
    const headOfEngineering = await person('hassan@example.com', 'Head of Engineering');
    const rami = await person('rami@example.com', 'Rami Panel');
    await withWorkspace(db, demo, (tx) =>
      tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
        values (${demo}, ${headOfEngineering}, 'hiring_owner', 'active'), (${demo}, ${rami}, 'interviewer', 'active')`),
    );
    await workspaces.switchWorkspace({ userId: rami }, demo);
    // AIV-P1-013: "Applied AI Engineer" carries the Rubric artboard's two versions, for the rubric edit spec to revise.
    const applied = await workspaces.withWorkspace({ userId: alex }, demo, (ctx) =>
      createJobs(workspaces, createAudit(db)).createJob(ctx, {
        title: 'Applied AI Engineer',
        jobType: 'ai_llm_engineering',
        team: 'Engineering',
        location: 'DIFC, Dubai',
        hiringOwnerUserId: headOfEngineering,
        description: 'Applied AI Engineer, synthetic demo job.',
        synthetic: true,
      }),
    );
    await artboardRubric(demo, alex, headOfEngineering, applied.id);
    // AIV-P2-038 Background: Demo Hiring Co has used 1,500 AI tokens today (the UTC day).
    await createAiTokenBudget(db).add(demo, new Date().toISOString().slice(0, 10), 1_500);
    // AIV-P1-006: "AP", the talent partner, runs workspace "Demo" with the five demo jobs (personas.md).
    const ap = await person('ap@example.com', 'AP');
    const apDemo = await workspaceOf('Demo', ap);
    await seedDemoJobs(apDemo, ap);
    // AIV-P0-032: the hiringOwner fixture's own person, named as the mocked tenant names her: a sign-in renames a user
    // to the tenant's name, and other specs read the Head of Engineering's.
    const hana = await person('hana.owner@example.com', 'hana.owner');
    await withWorkspace(db, apDemo, (tx) =>
      tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
        values (${apDemo}, ${hana}, 'hiring_owner', 'active')`),
    );
    await workspaces.switchWorkspace({ userId: hana }, apDemo);
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
    // AIV-P1-014: Tariq adds jobs owned by the Head of Engineering, who approves them. Its own workspace, as drafting
    // spends its AI tokens.
    const tariqRecruiter = await person('tariq@example.com', 'Tariq Recruiter');
    const approvals = await workspaceOf('Approvals Co', tariqRecruiter);
    const approver = await person('head.approvals@example.com', 'Head of Engineering');
    await withWorkspace(db, approvals, (tx) =>
      tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status, title)
        values (${approvals}, ${approver}, 'hiring_owner', 'active', 'Head of Engineering')`),
    );
    await workspaces.switchWorkspace({ userId: approver }, approvals);
    // AIV-P1-015: Senior AI Engineer with an approved rubric and the ticket's pay band, and Senior Product Designer with
    // only a draft, for publishing.
    const tariqJobs = createJobs(workspaces, createAudit(db));
    await workspaces.withWorkspace({ userId: tariqRecruiter }, approvals, async (ctx) => {
      for (const [title, approve] of [
        ['Senior AI Engineer', true],
        ['Senior Product Designer', false],
      ] as const) {
        const job = await tariqJobs.createJob(ctx, {
          title,
          jobType: 'ai_llm_engineering',
          location: 'DIFC, Dubai',
          payBand: { minMinor: 3_500_000, maxMinor: 4_800_000, currency: 'AED' },
          description: `${title}, synthetic demo job.`,
          synthetic: true,
        });
        const version = await tariqJobs.saveRubric(ctx, job.id, {
          successStatement: 'Ships reliable work.',
          competencies: [
            {
              name: 'LLM systems in production',
              evidenceExpected: 'A shipped assistant',
              weightPercent: 60,
              levelNeeded: 4,
            },
            { name: 'Retrieval and evaluation', evidenceExpected: 'Eval sets', weightPercent: 40, levelNeeded: 3 },
          ].map((c) => ({ ...c, type: 'mandatory', origin: 'from_description' })),
        });
        if (!approve) continue;
        await tariqJobs.submitRubric(ctx, version.id);
        await tariqJobs.approveRubric(ctx, version.id);
      }
    });
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

    // AIV-P1-052: Zaid is a recruiter (not an admin) in Oasis Talent, his active workspace. Its own workspace, so the
    // operator console's figures for the workspaces above do not change.
    const leila = await person('leila@example.com', 'Leila Agency');
    const oasis = await workspaceOf('Oasis Talent', leila);
    const zaid = await person('zaid@example.com', 'Zaid Recruiter');
    await withWorkspace(db, oasis, (tx) =>
      tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
        values (${oasis}, ${zaid}, 'recruiter', 'active'), (${oasis}, ${faisal}, 'hiring_owner', 'active')`),
    );
    await workspaces.switchWorkspace({ userId: zaid }, oasis);
    // AIV-P1-056: Oasis Talent is an agency with no clients yet; Faisal is its hiring owner with no grants.
    await workspaces.withWorkspace({ userId: leila }, oasis, (ctx) => workspaces.setWorkspaceType(ctx, 'agency'));

    // AIV-P1-003: Tariq's agency "Harbour Talent" has the same two clients and jobs as Gulf Talent Partners, so
    // invite-members.spec.ts can invite and accept without changing the counts the operator specs read. Faisal's
    // invitation to all of Dune Logistics' jobs is opened by its link; the token reaches the spec through the environment.
    const tariq = await person('tariq.agency@example.com', 'Tariq Agency');
    const harbour = await workspaceOf('Harbour Talent', tariq);
    process.env['E2E_INVITE_TOKEN'] = await workspaces.withWorkspace({ userId: tariq }, harbour, async (ctx) => {
      await workspaces.setWorkspaceType(ctx, 'agency');
      const falcon = await workspaces.addClient(ctx, 'Falcon Pay');
      const dune = await workspaces.addClient(ctx, 'Dune Logistics');
      for (const [title, clientId] of [
        ['Senior Product Manager, Payments', falcon.id],
        ['Staff Backend Engineer', dune.id],
      ] as const)
        await gulfJobs.createJob(ctx, {
          title,
          jobType: 'software_engineering',
          clientId,
          description: `${title}, synthetic demo job.`,
          synthetic: true,
        });
      // Rami interviews for Staff Backend Engineer (his jobs are edited) and Lina recruits (she is removed); neither has
      // Harbour Talent as their active workspace, so their other specs are unchanged.
      await ctx.tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
        values (${harbour}, ${rami}, 'interviewer', 'active'), (${harbour}, ${lina}, 'recruiter', 'active')`);
      const [staffBackend] = (await gulfJobs.listJobs(ctx)).filter((j) => j.title === 'Staff Backend Engineer');
      if (staffBackend) await workspaces.grantJobAccess(ctx, { userId: rami, jobId: staffBackend.id });
      const { token } = await workspaces.inviteMember(ctx, {
        email: 'faisal@example.com',
        role: 'hiring_owner',
        title: 'Head of Engineering, Dune Logistics',
        jobIds: [],
        clientIds: [dune.id],
      });
      return token;
    });
  } finally {
    await db.$client.end();
  }

  // The five demo jobs (personas.md) for the Jobs list (AIV-P1-006). The recruiter, as admin, approves the four approved
  // rubrics and moves each job to its stage (AIV-P1-067's changeStage).
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
    // AIV-P1-011, AIV-P1-012: the Senior AI Engineer as the Rubric artboard shows it, on a fixed clock: added 3 Nov,
    // version 1 approved by the Head of Engineering, then version 2 approved on 12 Nov.
    const added = new Date('2026-11-03T08:00:00.000Z');
    const clocked = createJobs(workspaces, createAudit(db), () => added);
    let sae = '';
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
        const job = await (title === 'Senior AI Engineer' ? clocked : jobs).createJob(ctx, {
          title,
          jobType,
          team,
          location,
          hiringOwnerUserId: owners.get(owner) ?? null,
          description: `${title}, synthetic demo job.`,
          synthetic: true,
        });
        // Its rubric versions are seeded below, then it moves to Round 1.
        if (title === 'Senior AI Engineer') {
          sae = job.id;
          return;
        }
        const version = await jobs.saveRubric(ctx, job.id, { successStatement: 'Ships reliable work.', competencies });
        if (stage === 'defining_rubric') return;
        await jobs.submitRubric(ctx, version.id);
        await jobs.approveRubric(ctx, version.id);
        await jobs.changeStage(ctx, job.id, stage);
      });
    }

    const head = owners.get('Head of Engineering');
    if (!head) throw new Error('The Head of Engineering was not seeded.');
    // AIV-P1-012: the hiring owner signs in to this workspace to read the rubric.
    await workspaces.switchWorkspace({ userId: head }, workspaceId);
    await artboardRubric(workspaceId, recruiter, head, sae);
    await as((ctx) => jobs.changeStage(ctx, sae, 'round_1'));
    // AIV-P1-086: applicants received 14 Nov, a minute apart, as "Add applicants" files them (this harness has no Blob
    // storage, so not through the dialog), for the Candidates tab. AIV-P1-034: the seven Senior AI Engineer candidates
    // of personas.md and Tarek Mansour ("in 2 jobs") carry its scores; Youssef Aziz, an Inbox arrival, is not assessed.
    // The worker never runs in this harness, so these rows are hand-written into assessment.result, not produced by
    // assessCandidate: their `competencies` are empty and they have no score.changed audit entry. Missing critical
    // evidence lists only rubric v2's mandatory competencies, as assessment does (owner's decision, #98's Gherkin).
    let received: Date;
    const intake = createIntake(
      workspaces,
      createCandidates(workspaces),
      jobs,
      displayNamesInWorkspace,
      () => received,
    );
    const rubric = await withWorkspace(db, workspaceId, (tx) =>
      createApprovedRubricReads().approvedRubric(tx, workspaceId, sae),
    );
    if (!rubric) throw new Error('The Senior AI Engineer rubric was not approved.');
    const competency = (name: string) => {
      const found = rubric.competencies.find((c) => c.name === name);
      if (!found) throw new Error(`No competency "${name}" on the Senior AI Engineer rubric.`);
      return found.id;
    };
    // [name, source, backed, up to, meets the need (of 6), confidence, missing critical evidence]; null: not assessed.
    const cast: [string, Source, ...([number, number, number, string, string[]] | [null])][] = [
      ['Sara Al Qahtani', 'linkedin', 68, 84, 4, 'High', ['Product judgement']],
      ['Arjun Menon', 'referral', 64, 76, 3, 'High', ['Retrieval and evaluation']],
      ['Layla Haddad', 'email', 61, 82, 3, 'Medium', ['Retrieval and evaluation']],
      ['Daniel Novak', 'linkedin', 55, 78, 3, 'Medium', ['Product judgement']],
      ['Priya Nair', 'careers_page', 49, 77, 2, 'Medium', ['Python service engineering', 'Product judgement']],
      [
        'Omar Al Suwaidi',
        'referral',
        38,
        74,
        1,
        'Low',
        ['LLM systems in production', 'Python service engineering', 'Product judgement'],
      ],
      [
        'Maria Santos',
        'linkedin',
        31,
        69,
        1,
        'Low',
        ['LLM systems in production', 'Python service engineering', 'Product judgement'],
      ],
      ['Tarek Mansour', 'referral', 63, 80, 3, 'Medium', ['LLM systems in production']],
      ['Youssef Aziz', 'whatsapp', null],
    ];
    for (const [i, [name, source, ...score]] of cast.entries()) {
      received = new Date(Date.UTC(2026, 10, 14, 8, i));
      const { personId } = await as((ctx) =>
        intake.receiveApplication(ctx, {
          jobId: sae,
          person: {
            displayName: name,
            identifiers: [{ type: 'cv_hash', value: String(i + 1).padStart(64, '0') }],
            synthetic: true,
          },
          source,
          fileIds: [crypto.randomUUID()],
        }),
      );
      const [backed, upTo, meets, confidence, missing] = score;
      if (backed === null) continue;
      await withWorkspace(db, workspaceId, (tx) =>
        tx.execute(sql`insert into assessment.result (id, workspace_id, candidate_id, job_id, rubric_version_id,
            backed_score, upper_bound, meets_need, competency_count, missing_critical, confidence, competencies, assessed_at)
          values (${crypto.randomUUID()}, ${workspaceId}, ${personId}, ${sae}, ${rubric.id}, ${backed}, ${upTo}, ${meets},
            6, ${JSON.stringify(missing.map(competency))}::jsonb, ${confidence}, '[]'::jsonb,
            ${new Date(Date.UTC(2026, 10, 14, 10, i)).toISOString()})`),
      );
    }
  }

  /**
   * The Rubric artboard's two versions on a job (AIV-P1-012), on a fixed clock: version 1 approved 5 Nov, version 2
   * approved 12 Nov by `head`, the job's hiring owner, who is granted the job.
   */
  async function artboardRubric(workspaceId: string, recruiter: string, head: string, jobId: string) {
    let clock = new Date();
    const clocked = createJobs(workspaces, createAudit(db), () => clock);
    const as = <T>(fn: (ctx: WorkspaceContext) => Promise<T>) =>
      workspaces.withWorkspace({ userId: recruiter }, workspaceId, fn);
    await as((ctx) => workspaces.grantJobAccess(ctx, { userId: head, jobId }));
    // shortcut: repeats the Senior AI Engineer rubric of tools/seed/src/cast.ts (JOBS), which the e2e specs read as
    // it is here; keep both in step, or build these rows from the cast if they ever change.
    const sixCompetencies: [string, string, number, number][] = [
      ['LLM systems in production', 'A shipped assistant or RAG system with real users, and their part in it', 25, 4],
      ['Retrieval and evaluation', 'Eval sets and retrieval metrics, and how they changed decisions', 20, 4],
      ['Python service engineering', 'Production Python they wrote: services, tests, deployment', 15, 3],
      ['Cost and reliability', 'Numbers on latency, cost per request and incidents handled', 15, 2],
      ['Arabic and bilingual NLP', 'Work on Arabic or bilingual text: models, evals, tokenisation', 10, 2],
      [
        'Product judgement',
        'Decisions made with product and business, shown in a doc or confirmed by a reference',
        15,
        3,
      ],
    ];
    const v2: Competency[] = sixCompetencies.map(([name, evidenceExpected, weightPercent, levelNeeded], i) => ({
      name,
      evidenceExpected,
      weightPercent,
      levelNeeded,
      type: i === 3 || i === 4 ? 'desirable' : 'mandatory',
      origin: i >= 4 ? 'suggested_by_aivera' : 'from_description',
    }));
    // Version 1: Arabic NLP mandatory at 15%, Product judgement at 10%.
    const v1 = v2.map((c, i): Competency =>
      i === 4 ? { ...c, type: 'mandatory', weightPercent: 15 } : i === 5 ? { ...c, weightPercent: 10 } : c,
    );
    const versions: [string, string, Competency[], string | null][] = [
      ['2026-11-03T08:00:00.000Z', '2026-11-05T08:00:00.000Z', v1, null],
      [
        '2026-11-10T08:00:00.000Z',
        '2026-11-12T08:00:00.000Z',
        v2,
        'Product judgement raised from 10% to 15%; Arabic NLP changed to desirable.',
      ],
    ];
    for (const [saved, approved, rubric, changeNote] of versions) {
      clock = new Date(saved);
      const version = await as((ctx) =>
        clocked.saveRubric(ctx, jobId, {
          successStatement:
            'Within six months, a bilingual assistant that answers merchant questions in English and Arabic is live, ' +
            'measured against an evaluation set, and running within an agreed cost per request.',
          changeNote,
          competencies: rubric,
        }),
      );
      await as((ctx) => clocked.submitRubric(ctx, version.id));
      clock = new Date(approved);
      await workspaces.withWorkspace({ userId: head }, workspaceId, (ctx) => clocked.approveRubric(ctx, version.id));
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
