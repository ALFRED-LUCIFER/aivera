import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import type { CandidatesContract } from '@credalent/candidates';
import { createCandidates } from '@credalent/candidates/composition';
import type { AssessmentContract } from '@credalent/assessment';
import { createAssessment } from '@credalent/assessment/composition';
import type { IntakeContract } from '@credalent/intake';
import { createIntake } from '@credalent/intake/composition';
import type { EvidenceContract } from '@credalent/evidence';
import { createEvidence } from '@credalent/evidence/composition';
import type { JobsContract } from '@credalent/jobs';
import { createJobs } from '@credalent/jobs/composition';
import { createFiles, type BlobStore } from '@credalent/files/composition';
import { createNotifications } from '@credalent/notifications/composition';
import { createDb, DbQueryError, withCandidateAccount, withWorkspace, type Db, type Tx } from '@credalent/db';
import { ForbiddenError, WorkspaceError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createAiTokenBudget, createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P0-012: the cross-workspace leak suite (ADR-005, AGENTS.md 1.4 and 3.4). It discovers every table from the
// catalogue, so a table added by any module later is checked with no edit here. Synthetic cast only (personas.md).

/** Tables without workspace row-level security, each with the reason it is not workspace-owned. */
const GLOBAL_TABLES: Record<string, string> = {
  'identity.user': 'A person signs in before choosing a workspace, and one user belongs to many (ADR-009).',
  'identity.sign_in_method': 'Belongs to identity.user: read at sign-in, before any workspace is open (ADR-009).',
  'workspaces.active_workspace':
    'Keyed on the user and read before any workspace is open; two opaque ids, membership re-checked per request.',
  'workspaces.directory':
    'The operator console lists workspaces from it (ADR-012): workspace id and created date only, nothing a tenant wrote.',
  'audit.platform_entry':
    'What Credalent operators did, outside any workspace (ADR-012); aivera_app may only insert, never read it.',
  'ops.platform_setting':
    'One row of platform settings the operators change (ADR-012 point 9, AIV-P2-039): no tenant data, no personal data.',
  // SAFETY: mutation check: removed 'regional_hint' from this list -> the forced-RLS test failed (named jobs.catalogue_regional_hint)
  ...Object.fromEntries(
    ['version', 'job_type', 'region', 'pack', 'pack_competency', 'regional_hint'].map((t) => [
      `jobs.catalogue_${t}`,
      'The catalogue every workspace is offered (ADR-013 point 2): no workspace or candidate data, no personal data; its actors are opaque operator ids or system:seed.',
    ]),
  ),
};
/**
 * The only permissive policies allowed that do not compare with app.workspace_id: read-only, for the aivera_public role
 * alone, on the candidate site's public projection (AIV-P3-002). Each must match its expression exactly.
 */
const PUBLIC_READ: Record<string, { name: string; qual: string }> = {
  'jobs.public_job': { name: 'public_job_public_read', qual: "(CURRENT_USER = 'aivera_public'::name)" },
};
/**
 * The one platform reader (ADR-005 point 4, AIV-P0-014): the outbox relay's policies, on `<schema>.outbox` tables only
 * and for the role aivera_relay only, which has no grant on any other table (tests/integration/src/outbox.test.ts).
 */
const isRelayPolicy = (p: { table: string; name: string; cmd: string; roles: string[] }) =>
  p.table.endsWith('.outbox') &&
  ((p.name === 'outbox_relay_read' && p.cmd === 'SELECT') || (p.name === 'outbox_relay_mark' && p.cmd === 'UPDATE')) &&
  p.roles.join() === 'aivera_relay';

/**
 * The ACS delivery-report webhook's policies (AIV-P0-017): on notifications.message only, for aivera_app, reaching the
 * one row whose provider id the transaction names. Expression matched exactly (tests/integration/src/notifications.test.ts).
 */
const PROVIDER_ID_EXPR =
  "(provider_message_id = NULLIF(current_setting('app.provider_message_id'::text, true), ''::text))";
const isDeliveryReportPolicy = (p: {
  table: string;
  name: string;
  cmd: string;
  roles: string[];
  qual: string | null;
}) =>
  p.table === 'notifications.message' &&
  ((p.name === 'message_delivery_report_read' && p.cmd === 'SELECT') ||
    (p.name === 'message_delivery_report_mark' && p.cmd === 'UPDATE')) &&
  p.roles.join() === 'aivera_app' &&
  p.qual === PROVIDER_ID_EXPR;

/**
 * Tables a candidate account may own instead of a workspace (ADR-009): a row's workspace_id is null exactly when its
 * account column is set (a check constraint, tests/integration/src/files.test.ts). Their one extra permissive policy
 * must be the account policy on that column, exactly as `candidateAccountPolicy` generates it.
 */
const ACCOUNT_OWNED: Record<string, string> = { 'files.file': 'candidate_account_id' };

/** Tables whose tenant key is not `workspace_id`. */
const TENANT_KEY: Record<string, string> = { 'workspaces.workspace': 'id' };
/**
 * The candidate's own tables (ADR-009), each with its account key. They belong to a person, not a workspace, so they
 * are checked for the `app.candidate_account_id` policy instead of the workspace one. A table in the schema that is
 * missing here is a violation, never skipped. Row isolation between two accounts: candidate-accounts.test.ts.
 */
const ACCOUNT_SCHEMA = 'candidate_accounts';
const ACCOUNT_TABLES: Record<string, string> = {
  'candidate_accounts.account': 'identity_user_id',
  'candidate_accounts.profile': 'account_id',
  'candidate_accounts.consent': 'account_id',
  'candidate_accounts.workspace_link': 'account_id',
};
const isAccountTable = (table: string) => table.startsWith(`${ACCOUNT_SCHEMA}.`);

type Setting = 'app.workspace_id' | 'app.candidate_account_id';
/** The expression every policy must use, exactly as PostgreSQL prints the one `tenantPolicy` (or `candidateAccountPolicy`) generates. */
const tenantExpr = (column: string, setting: Setting = 'app.workspace_id') =>
  `(${column} = (NULLIF(current_setting('${setting}'::text, true), ''::text))::uuid)`;

type Table = {
  name: string;
  kind: string;
  appOwns: boolean;
  invoker: boolean;
  rls: boolean;
  forced: boolean;
  hasWorkspaceId: boolean;
};
type Policy = {
  table: string;
  name: string;
  permissive: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  check: string | null;
};

/**
 * Every application relation (tables, views, materialized views, foreign tables): all schemas except PostgreSQL's
 * own and the migrations journals.
 */
const listTables = async (db: Db | Tx) => [
  ...(await db.execute<Table>(sql`
    select n.nspname || '.' || c.relname as name, c.relkind::text as kind,
      pg_has_role('aivera_app', c.relowner, 'MEMBER') as "appOwns",
      coalesce('security_invoker=true' = any (c.reloptions), false) as invoker,
      c.relrowsecurity as rls, c.relforcerowsecurity as forced,
      exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped)
        as "hasWorkspaceId"
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('information_schema', 'migrations')
      and n.nspname !~ '^pg_'
    order by name`)),
];

const tenantTables = (tables: Table[]) =>
  tables.filter((t) => ['r', 'p'].includes(t.kind) && !(t.name in GLOBAL_TABLES) && !isAccountTable(t.name));
const keyOf = (table: string) => TENANT_KEY[table] ?? 'workspace_id';

/** Every way a table breaks workspace isolation, as "schema.table: reason". Empty when isolation holds. */
async function isolationViolations(db: Db | Tx): Promise<string[]> {
  const tables = await listTables(db);
  const policies = [
    ...(await db.execute<Policy>(sql`
      select schemaname || '.' || tablename as table, policyname as name, permissive, roles::text[] as roles, cmd,
        qual, with_check as check
      from pg_policies`)),
  ];
  const violations: string[] = [];
  for (const t of tables) {
    if (t.appOwns)
      violations.push(
        `${t.name}: owned by aivera_app or a role it belongs to, which can switch its row-level security off`,
      );
    if (t.name in GLOBAL_TABLES) continue;
    // A view reads as its owner unless security_invoker is set; matviews and foreign tables have no RLS at all.
    if (t.kind === 'v') {
      if (!t.invoker) violations.push(`${t.name}: view without security_invoker=true bypasses row-level security`);
      continue;
    }
    if (t.kind === 'm' || t.kind === 'f') {
      violations.push(`${t.name}: materialized views and foreign tables have no row-level security`);
      continue;
    }
    const account = isAccountTable(t.name);
    if (account && !(t.name in ACCOUNT_TABLES)) {
      violations.push(`${t.name}: not in ACCOUNT_TABLES (add it with its account key)`);
      continue;
    }
    if (!account && !t.hasWorkspaceId && !(t.name in TENANT_KEY)) {
      violations.push(`${t.name}: no workspace_id column (add one, or list it in GLOBAL_TABLES with the reason)`);
      continue;
    }
    if (!t.rls) violations.push(`${t.name}: row-level security not enabled`);
    if (!t.forced) violations.push(`${t.name}: row-level security not forced`);
    const [key, setting]: [string, Setting] = account
      ? [ACCOUNT_TABLES[t.name] ?? '', 'app.candidate_account_id']
      : [keyOf(t.name), 'app.workspace_id'];
    const expected = tenantExpr(key, setting);
    const permissive = policies.filter((p) => p.table === t.name && p.permissive === 'PERMISSIVE');
    const isTenant = (p: Policy) => p.qual === expected && p.check === expected;
    if (!permissive.some((p) => isTenant(p) && p.cmd === 'ALL' && p.roles.join() === 'public'))
      violations.push(`${t.name}: no policy comparing ${key} with current_setting('${setting}')`);
    // Permissive policies are OR-ed, so any looser one opens the table to other workspaces. Restrictive ones (the jobs
    // job_scope policies) are AND-ed and only narrow access, so they are allowed.
    const accountOwner = ACCOUNT_OWNED[t.name];
    const isAccountOwner = (p: Policy) =>
      accountOwner !== undefined &&
      p.qual === tenantExpr(accountOwner, 'app.candidate_account_id') &&
      p.check === p.qual &&
      p.cmd === 'ALL' &&
      p.roles.join() === 'public';
    const isPublicRead = (p: Policy) =>
      PUBLIC_READ[t.name]?.name === p.name && PUBLIC_READ[t.name]?.qual === p.qual && p.cmd === 'SELECT';
    for (const loose of permissive.filter(
      (p) => !isTenant(p) && !isPublicRead(p) && !isRelayPolicy(p) && !isDeliveryReportPolicy(p) && !isAccountOwner(p),
    ))
      violations.push(`${t.name}: permissive policy ${loose.name} does not compare with ${setting}`);
  }
  return violations;
}

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const OMAR = '0190d4a2-0000-7000-8000-00000000a1e2'; // Omar Agency, W2's admin only
const LINA = '0190d4a2-0000-7000-8000-0000000011aa';
const NOW = new Date('2026-11-18T09:00:00.000Z');
const ACCOUNT = '0190d4a2-0000-7000-8000-0000000ca0a1';
const unused = () => Promise.reject(new Error('not used by the tenancy suite'));
const stubBlobs: BlobStore = {
  uploadUrl: async (path) => `https://storage.credalent.example/${path}?sig=test`,
  read: unused,
  write: unused,
  delete: unused,
  stream: unused,
};

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;

type Modules = {
  workspaces: WorkspacesContract;
  candidates: CandidatesContract;
  evidence: EvidenceContract;
  assessment: AssessmentContract;
  jobs: JobsContract;
  intake: IntakeContract;
  audit: AuditContract;
};
const modulesOn = (db: Db): Modules => {
  const audit = createAudit(db);
  const workspaces = createWorkspaces(db, audit);
  const candidates = createCandidates(workspaces, () => NOW);
  const jobs = createJobs(workspaces, audit, () => NOW);
  return {
    audit,
    workspaces,
    candidates,
    evidence: createEvidence(workspaces, audit, () => NOW),
    assessment: createAssessment(workspaces, audit, () => NOW),
    jobs,
    intake: createIntake(workspaces, candidates, jobs, () => NOW),
  };
};

type Seeded = {
  workspaceId: string;
  personId: string;
  clientId: string;
  grantId: string;
  jobId: string;
  rubricId: string;
};
let w1: Seeded;
let w2: Seeded;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

/**
 * One workspace with a member, an agency client, a job with a rubric, a job grant, a candidate and audit entries,
 * through the contracts. A new tenant table needs a line here (the per-table check says so).
 */
async function seed(
  { workspaces, evidence, assessment, jobs, intake }: Modules,
  name: string,
  creator: string,
  person: string,
): Promise<Seeded> {
  const { id: workspaceId } = await workspaces.createWorkspace({
    name,
    company: name,
    hiringFocus: 'AI and LLM engineering',
    synthetic: true,
    creatorUserId: creator,
  });
  // Inviting is not built yet (AIV-P1-003), so the interviewer is added directly, as other suites do.
  await withWorkspace(app, workspaceId, (tx) =>
    tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
      values (${workspaceId}, ${LINA}, 'interviewer', 'active')`),
  );
  await createAiTokenBudget(app).add(workspaceId, '2026-11-18', 1_500);
  return workspaces.withWorkspace({ userId: creator }, workspaceId, async (ctx) => {
    await workspaces.setWorkspaceType(ctx, 'agency');
    await workspaces.updateSettings(ctx, { clientShareLinkDays: 7 });
    const client = await workspaces.addClient(ctx, `${name} client`);
    const job = await jobs.createJob(ctx, {
      title: 'Senior AI Engineer',
      jobType: 'ai_llm_engineering',
      description: 'Senior AI Engineer, synthetic demo job.',
      synthetic: true,
    });
    const rubric = await jobs.saveRubric(ctx, job.id, {
      successStatement: 'Ships reliable work.',
      competencies: [
        {
          name: 'Evaluation design',
          evidenceExpected: 'A repository or a document',
          weightPercent: 100,
          levelNeeded: 4,
          type: 'mandatory',
          origin: 'from_description',
        },
      ],
    });
    // Approved, so the cross-workspace getApprovedRubric check has a real rubric to miss.
    await jobs.submitRubric(ctx, rubric.id);
    await jobs.approveRubric(ctx, rubric.id);
    // Published, so the candidate site's read model (jobs.public_job, AIV-P3-002) has a row to leak.
    await jobs.publishJob(ctx, job.id, { publicDescriptor: 'A synthetic employer' });
    await workspaces.grantJobAccess(ctx, { userId: LINA, jobId: job.id });
    const [grant] = await workspaces.listJobGrants(ctx);
    // An open invitation (workspaces.invitation, AIV-P1-003).
    await workspaces.inviteMember(ctx, {
      email: 'huda@example.com',
      role: 'interviewer',
      title: null,
      jobIds: [job.id],
      clientIds: [],
    });
    // An application (intake.application and .application_source, AIV-P1-017); it finds or creates the person.
    const { personId } = await intake.receiveApplication(ctx, {
      jobId: job.id,
      person: {
        displayName: person,
        identifiers: [{ type: 'email', value: `${person.toLowerCase().replaceAll(' ', '.')}@example.com` }],
        synthetic: true,
      },
      source: 'email',
    });
    // A source, its item and a competency link (evidence.*, AIV-P1-024).
    const competencyId = crypto.randomUUID();
    const { itemIds } = await evidence.recordEvidence(ctx, {
      candidateId: personId,
      source: {
        kind: 'cv',
        label: 'CV',
        url: null,
        blobFileId: null,
        capturedAt: NOW,
        checkedAt: null,
        checkMethod: null,
      },
      items: [
        {
          excerpt: 'built an evaluation set',
          excerptSpan: 'page 1',
          provenance: 'claim',
          strength: 'supporting',
          limit: 'A claim until a second source supports it.',
          competencies: [{ jobId: job.id, competencyId, level: 3 }],
        },
      ],
      synthetic: true,
    });
    // An assessment result (assessment.result, AIV-P1-030).
    await assessment.assessCandidate(ctx, {
      candidateId: personId,
      jobId: job.id,
      rubric: {
        versionId: rubric.id,
        competencies: [{ id: competencyId, weightPercent: 100, levelNeeded: 4, type: 'mandatory' }],
      },
      evidence: await evidence.listEvidenceForCandidate(ctx, personId, job.id),
    });
    // The same write-up from a second candidate id (opaque here), so a flag is raised (evidence.duplicate_flag, AIV-P1-071).
    for (const candidateId of [personId, crypto.randomUUID()])
      await evidence.recordEvidence(ctx, {
        candidateId,
        source: {
          kind: 'document',
          label: 'Write-up',
          url: null,
          blobFileId: null,
          capturedAt: NOW,
          checkedAt: null,
          checkMethod: null,
        },
        items: [
          {
            excerpt: 'scored the top five passages every week',
            excerptSpan: null,
            provenance: 'submitted',
            strength: 'medium',
            limit: 'Shows the method, not who wrote it.',
          },
        ],
        synthetic: true,
        text: 'We built an evaluation set of four hundred support questions for the merchant help assistant, scored the top five passages for relevance every week, and compared recall with the previous release before shipping.',
      });
    // A repository read, a merged pull request on the item and a handled message (evidence.*, AIV-P1-026).
    const login = `${person.split(' ')[0]?.toLowerCase()}-credalent-example`;
    await evidence.requestRepositoryRead(ctx, {
      candidateId: personId,
      url: `https://github.com/${login}/eval-harness`,
      githubLogin: login,
      emails: [],
      synthetic: true,
    });
    await ctx.tx.execute(sql`insert into evidence.merged_pull_request
      (workspace_id, item_id, candidate_id, repository, number, merged_at, merged_by, self_merged)
      values (${workspaceId}, ${itemIds[0]}, ${personId}, 'saga-maintainer-credalent-example/saga', 41, now(),
        'saga-maintainer-credalent-example', false)`);
    await ctx.tx.execute(sql`insert into evidence.inbox (consumer, message_id, workspace_id, handled_at)
      values ('evidence.repository.read', ${crypto.randomUUID()}, ${workspaceId}, now())`);
    // An evidence request email (notifications.message and .outbox, AIV-P0-017) and a handled message (.inbox).
    const { messageId } = await createNotifications({
      encryptionKey: randomBytes(32).toString('base64'),
      origin: 'https://credalent.example',
      synthetic: true,
    }).queueEmail(ctx, {
      template: 'evidence-request',
      to: `${person.toLowerCase().replaceAll(' ', '.')}@example.com`,
      causedBy: rubric.id,
      sender: { name: 'Layla Haddad', shortName: 'Layla', email: 'layla.haddad@example.com', workspace: name },
      data: {
        jobTitle: 'Senior AI Engineer',
        items: [{ competency: 'Evaluation design', ask: 'Send a link to the evaluation set.' }],
        link: 'https://credalent.example/l/9fK2xQ7mT4vB',
        deleteUrl: 'https://credalent.example/l/delete-9fK2xQ',
      },
    });
    await ctx.tx.execute(sql`insert into notifications.inbox (consumer, message_id, workspace_id, handled_at)
      values ('notifications.send', ${messageId}, ${workspaceId}, now())`);
    // A pending upload (files.file, AIV-P0-016; the blob store is not reached past the SAS) and its settled event
    // (files.outbox, written by the scan handler in production).
    const { fileId } = await createFiles({
      db: app,
      workspaces,
      blobs: stubBlobs,
      malwareScanning: true,
    }).requestUpload(ctx, {
      purpose: 'evidence',
      fileName: 'eval-set-sample.pdf',
      contentType: 'application/pdf',
      size: 2048,
    });
    await ctx.tx.execute(sql`insert into files.outbox (id, workspace_id, type, payload, dedupe_key, occurred_at,
      next_attempt_at) values (gen_random_uuid(), ${workspaceId}, 'FileClean.v1', ${JSON.stringify({ fileId })}::jsonb,
      ${`file:${fileId}`}, now(), now())`);
    return { workspaceId, personId, clientId: client.id, grantId: grant?.id ?? '', jobId: job.id, rubricId: rubric.id };
  });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 1 });
  const modules = modulesOn(app);
  w1 = await seed(modules, 'Demo Hiring Co', ALEX, 'Sara Al Qahtani');
  w2 = await seed(modules, 'Gulf Talent Partners', OMAR, 'Arjun Menon');
  // A candidate-site upload (no workspace): the leak check below fails if any workspace's scope can see it.
  await withCandidateAccount(app, ACCOUNT, (tx) =>
    tx.execute(sql`insert into files.file (id, candidate_account_id, purpose, content_type, size_bytes, status,
      blob_path, uploaded_by, created_at) values (gen_random_uuid(), ${ACCOUNT}, 'cv', 'application/pdf', 10,
      'pending', 'uploads-quarantine/c/x', ${ACCOUNT}, now())`),
  );
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Scenario: Every tenant table has forced row-level security', () => {
  // SAFETY: mutation check: dropped policy member_tenant_isolation on workspaces.member -> this test failed (named workspaces.member)
  // SAFETY: mutation check: ALTER TABLE candidates.person NO FORCE ROW LEVEL SECURITY -> this test failed (not forced)
  // SAFETY: mutation check: added permissive policy USING (true) on workspaces.client -> this test failed (named the policy)
  // SAFETY: mutation check: public_job_public_read loosened to USING (true) in jobs 0003 -> this test failed (named the policy)
  // SAFETY: mutation check: consent_owner_isolation replaced by USING (true) in candidate_accounts 0000 -> this test failed (named it)
  // SAFETY: mutation check: GRANT aivera_migrator TO aivera_app -> this test failed (owned by a role aivera_app belongs to)
  // SAFETY: mutation check: dropped `&& !isAccountOwner(p)` from the loose-policy filter -> this test failed (named file_owner_isolation)
  it('every table with a workspace_id column has RLS enabled, forced, and the app.workspace_id policy', async () => {
    const tables = await listTables(admin);
    // The discovery really reaches the module schemas, so an empty catalogue cannot pass.
    expect(tenantTables(tables).map((t) => t.name)).toEqual(
      expect.arrayContaining(['workspaces.member', 'candidates.person', 'audit.entry']),
    );
    expect(await isolationViolations(admin)).toEqual([]);
  });

  it('every GLOBAL_TABLES and ACCOUNT_TABLES entry is a real table, so the allowlists cannot go stale', async () => {
    const names = (await listTables(admin)).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([...Object.keys(GLOBAL_TABLES), ...Object.keys(ACCOUNT_TABLES)]));
  });

  // The migrator too: a view or function it owns would otherwise read across workspaces.
  // SAFETY: mutation check: ALTER ROLE aivera_migrator BYPASSRLS -> this test failed
  // SAFETY: mutation check: ALTER ROLE aivera_public BYPASSRLS -> this test failed (aivera_app can switch to it)
  it('aivera_app, aivera_migrator, aivera_public and aivera_relay are neither superuser nor BYPASSRLS', async () => {
    const roles = await admin.execute<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolname, rolsuper, rolbypassrls from pg_roles
        where rolname in ('aivera_app', 'aivera_migrator', 'aivera_public', 'aivera_relay') order by rolname`,
    );
    expect([...roles]).toEqual([
      { rolname: 'aivera_app', rolsuper: false, rolbypassrls: false },
      { rolname: 'aivera_migrator', rolsuper: false, rolbypassrls: false },
      { rolname: 'aivera_public', rolsuper: false, rolbypassrls: false },
      { rolname: 'aivera_relay', rolsuper: false, rolbypassrls: false },
    ]);
  });
});

/** Thrown to roll back a probe transaction: DDL is transactional, so the probe table is never left behind. */
class Rollback extends Error {}

describe('Scenario: A new table without RLS fails the build', () => {
  it('a migration adding jobs.note with a workspace_id column and no policy is named', async () => {
    const probe = admin.transaction(async (tx) => {
      await tx.execute(sql`create schema if not exists jobs`);
      await tx.execute(sql`create table jobs.note (id uuid primary key, workspace_id uuid not null)`);
      expect((await isolationViolations(tx)).filter((v) => v.startsWith('jobs.note:'))).toEqual([
        'jobs.note: row-level security not enabled',
        'jobs.note: row-level security not forced',
        "jobs.note: no policy comparing workspace_id with current_setting('app.workspace_id')",
      ]);
      throw new Rollback();
    });
    await expect(probe).rejects.toBeInstanceOf(Rollback);
  });

  // SAFETY: mutation check: isRelayPolicy without its role check -> this test failed (the public policy passed)
  it("the outbox relay's policy exception holds only for the aivera_relay role", async () => {
    const probe = admin.transaction(async (tx) => {
      await tx.execute(sql`drop policy outbox_relay_read on candidates.outbox`);
      await tx.execute(sql`create policy outbox_relay_read on candidates.outbox for select to public using (true)`);
      expect((await isolationViolations(tx)).filter((v) => v.startsWith('candidates.outbox:'))).toEqual([
        'candidates.outbox: permissive policy outbox_relay_read does not compare with app.workspace_id',
      ]);
      throw new Rollback();
    });
    await expect(probe).rejects.toBeInstanceOf(Rollback);
  });

  // SAFETY: mutation check: isAccountOwner without its expression check (any policy on an ACCOUNT_OWNED table) -> this test failed
  it('the account-owner exception holds only for the exact account policy on files.file', async () => {
    const probe = admin.transaction(async (tx) => {
      await tx.execute(sql`drop policy file_owner_isolation on files.file`);
      await tx.execute(sql`create policy file_owner_isolation on files.file
        using (candidate_account_id is not null) with check (candidate_account_id is not null)`);
      expect((await isolationViolations(tx)).filter((v) => v.startsWith('files.file:'))).toEqual([
        'files.file: permissive policy file_owner_isolation does not compare with app.workspace_id',
      ]);
      throw new Rollback();
    });
    await expect(probe).rejects.toBeInstanceOf(Rollback);
  });

  it('a table with neither workspace_id nor an allowlist entry is named', async () => {
    const probe = admin.transaction(async (tx) => {
      await tx.execute(sql`create table candidates.note (id uuid primary key)`);
      expect((await isolationViolations(tx)).filter((v) => v.startsWith('candidates.note:'))).toEqual([
        'candidates.note: no workspace_id column (add one, or list it in GLOBAL_TABLES with the reason)',
      ]);
      throw new Rollback();
    });
    await expect(probe).rejects.toBeInstanceOf(Rollback);
  });

  // SAFETY: mutation check: isolationViolations with `account = false` (no account branch) -> this test and the forced-RLS test failed
  it('a candidate_accounts table not in ACCOUNT_TABLES, or with the workspace policy instead of the account one, is named', async () => {
    const probe = admin.transaction(async (tx) => {
      await tx.execute(sql`create table candidate_accounts.note (id uuid primary key, account_id uuid not null)`);
      await tx.execute(sql`drop policy consent_owner_isolation on candidate_accounts.consent`);
      await tx.execute(sql`create policy consent_ws on candidate_accounts.consent
        using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)`);
      expect((await isolationViolations(tx)).filter((v) => v.startsWith('candidate_accounts.'))).toEqual([
        "candidate_accounts.consent: no policy comparing account_id with current_setting('app.candidate_account_id')",
        'candidate_accounts.consent: permissive policy consent_ws does not compare with app.candidate_account_id',
        'candidate_accounts.note: not in ACCOUNT_TABLES (add it with its account key)',
      ]);
      throw new Rollback();
    });
    await expect(probe).rejects.toBeInstanceOf(Rollback);
  });

  it('a materialized view, or a view without security_invoker, over a tenant table is named', async () => {
    const probe = admin.transaction(async (tx) => {
      await tx.execute(sql`create materialized view candidates.probe_mv as select * from candidates.person`);
      await tx.execute(sql`create view candidates.probe_v as select * from candidates.person`);
      await tx.execute(
        sql`create view candidates.probe_ok with (security_invoker = true) as select * from candidates.person`,
      );
      expect((await isolationViolations(tx)).filter((v) => v.startsWith('candidates.probe_'))).toEqual([
        'candidates.probe_mv: materialized views and foreign tables have no row-level security',
        'candidates.probe_v: view without security_invoker=true bypasses row-level security',
      ]);
      throw new Rollback();
    });
    await expect(probe).rejects.toBeInstanceOf(Rollback);
  });
});

/** Runs `fn` as `userId` in `workspaceId` through the workspaces contract, as a request does. */
const as = <T>(m: Modules, userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  m.workspaces.withWorkspace({ userId }, workspaceId, fn);

describe("Scenario: The app role cannot read or write another workspace's rows, in any tenant table", () => {
  // Discovered, not listed: a new tenant table is checked here, and fails until the seed gives it W2 rows.
  // SAFETY: mutation check: added permissive policy USING (true) on workspaces.client -> this test failed (saw W2 rows)
  it('in W1, a query with no WHERE clause returns only W1 rows, and an update of W2 rows touches none', async () => {
    // W1's admin's request context, so the job-scope settings the jobs policies read are set as in production.
    const w1Modules = modulesOn(app);
    for (const { name } of tenantTables(await listTables(admin))) {
      const [schema = '', table = ''] = name.split('.');
      const from = sql`${sql.identifier(schema)}.${sql.identifier(table)}`;
      const key = sql.identifier(keyOf(name));
      const [seeded] = await admin.execute<{ n: number }>(
        sql`select count(*)::int as n from ${from} where ${key} = ${w2.workspaceId}`,
      );
      expect(seeded?.n, `${name} has no W2 rows: extend seed() so the leak check reaches it`).toBeGreaterThan(0);

      const keys = await as(w1Modules, ALEX, w1.workspaceId, ({ tx }) =>
        tx.execute<{ k: string }>(sql`select distinct ${key}::text as k from ${from}`),
      );
      expect(
        [...keys].map((r) => r.k),
        name,
      ).toEqual([w1.workspaceId]);

      // Either RLS hides the rows (0 updated) or the role has no UPDATE at all (audit.entry is append-only; the app
      // cannot mark an outbox event, AIV-P0-014; an assessment result is history, AIV-P1-030).
      const updated = await as(w1Modules, ALEX, w1.workspaceId, ({ tx }) =>
        tx.execute(sql`update ${from} set ${key} = ${key} where ${key} = ${w2.workspaceId}`),
      ).then(
        (result) => result.count,
        (error: unknown) => (error instanceof DbQueryError ? error.code : String(error)),
      );
      const noUpdate = name === 'audit.entry' || name === 'assessment.result' || name.endsWith('.outbox');
      expect(noUpdate ? [0, '42501'] : [0], name).toContain(updated);
    }
  });
});

/** What W1's list functions return, for a module build on the given connection. */
const listedInW1 = async (m: Modules) => ({
  // These two open their own transaction, so they run outside the request context (one pooled connection).
  members: (await m.workspaces.listMembers(w1.workspaceId)).map((r) => r.workspaceId),
  ownAudit: new Set(
    (await m.audit.listFor(w1.workspaceId, { type: 'workspace', id: w1.workspaceId })).map((r) => r.workspaceId),
  ),
  w2Audit: await m.audit.listFor(w1.workspaceId, { type: 'workspace', id: w2.workspaceId }),
  ...(await as(m, ALEX, w1.workspaceId, async (ctx) => ({
    workspace: (await m.workspaces.getWorkspace(ctx))?.id,
    clients: (await m.workspaces.listClients(ctx)).map((r) => r.id),
    grants: (await m.workspaces.listJobGrants(ctx)).map((r) => r.id),
    people: (await m.candidates.listPeople(ctx)).map((r) => r.id),
    jobs: (await m.jobs.listJobs(ctx)).map((r) => r.id),
    w2Assessment: await m.assessment.getLatestAssessment(ctx, w2.personId, w2.jobId),
  }))),
});

const onlyW1 = () => ({
  members: [w1.workspaceId, w1.workspaceId],
  workspace: w1.workspaceId,
  clients: [w1.clientId],
  grants: [w1.grantId],
  people: [w1.personId],
  jobs: [w1.jobId],
  ownAudit: new Set([w1.workspaceId]),
  w2Audit: [],
  w2Assessment: null,
});

describe('Scenario: Repositories return nothing from another workspace', () => {
  it('W1 and W2 each have a job, a candidate and a member (plus a client and a grant); every W1 list returns only W1 rows', async () => {
    expect(await listedInW1(modulesOn(app))).toEqual(onlyW1());
  });
});

describe("Scenario: Fetching another workspace's record by id finds nothing", () => {
  it('W1 asking for the W2 candidate gets null, so no field of it is returned', async () => {
    const m = modulesOn(app);
    expect(await as(m, ALEX, w1.workspaceId, (ctx) => m.candidates.getPerson(ctx, w2.personId))).toBeNull();
  });

  it('W1 asking for the W2 job, or its approved rubric, gets null; its own approved rubric is found', async () => {
    const m = modulesOn(app);
    const found = await as(m, ALEX, w1.workspaceId, async (ctx) => ({
      w2Job: await m.jobs.getJob(ctx, w2.jobId),
      w2Rubric: await m.jobs.getApprovedRubric(ctx, w2.jobId),
      ownRubric: await m.jobs.getApprovedRubric(ctx, w1.jobId),
    }));
    expect(found).toEqual({ w2Job: null, w2Rubric: null, ownRubric: expect.objectContaining({ id: w1.rubricId }) });
  });

  it("W1 renaming or archiving W2's client, or revoking W2's grant, finds nothing and changes nothing", async () => {
    const m = modulesOn(app);
    await expect(
      as(m, ALEX, w1.workspaceId, (ctx) => m.workspaces.renameClient(ctx, w2.clientId, 'Renamed')),
    ).rejects.toEqual(new WorkspaceError('client_not_found'));
    await expect(as(m, ALEX, w1.workspaceId, (ctx) => m.workspaces.archiveClient(ctx, w2.clientId))).rejects.toEqual(
      new WorkspaceError('client_not_found'),
    );
    await as(m, ALEX, w1.workspaceId, (ctx) => m.workspaces.revokeJobAccess(ctx, w2.grantId));
    const w2State = await as(m, OMAR, w2.workspaceId, async (ctx) => ({
      clients: await m.workspaces.listClients(ctx),
      grants: (await m.workspaces.listJobGrants(ctx)).map((g) => g.id),
    }));
    expect(w2State).toEqual({
      clients: [expect.objectContaining({ id: w2.clientId, name: 'Gulf Talent Partners client', archivedAt: null })],
      grants: [w2.grantId],
    });
  });

  it("W2's admin is not a member of W1 and cannot open it", async () => {
    const m = modulesOn(app);
    expect(await m.workspaces.getMembership(OMAR, w1.workspaceId)).toBeNull();
    await expect(as(m, OMAR, w1.workspaceId, async () => 'opened')).rejects.toThrow(ForbiddenError);
  });
});

describe('Scenario: Both layers are needed', () => {
  // RLS alone: the per-table check above queries with no WHERE clause in W1 and sees only W1 rows.
  // The repository filter alone: the same contracts on the superuser connection, which row-level security skips.
  // SAFETY: mutation check: removed inWorkspace(workspaceId) from listMembers -> this test failed (saw W2's member rows)
  // SAFETY: mutation check: removed eq(person.workspaceId, workspaceId) from listPeople -> this test failed (saw W2's person)
  // SAFETY: mutation check: removed eq(job.workspaceId, workspaceId) from jobWhere -> this test failed (saw W2's job)
  // SAFETY: mutation check: removed eq(result.workspaceId, workspaceId) from the assessment store's latest -> this test failed (saw W2's result)
  it('with row-level security out of the way, the repository filter alone still returns no W2 rows', async () => {
    const [role] = await admin.execute<{ bypass: boolean }>(
      sql`select rolsuper or rolbypassrls as bypass from pg_roles where rolname = current_user`,
    );
    expect(role?.bypass).toBe(true);
    expect(await listedInW1(modulesOn(admin))).toEqual(onlyW1());
  });
});
