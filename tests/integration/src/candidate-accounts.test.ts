import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@aivera/audit/composition';
import { CandidateAccountError, type CandidateAccountsContract, type Consent } from '@aivera/candidate-accounts';
import { createCandidateAccounts } from '@aivera/candidate-accounts/composition';
import type { CandidatesContract } from '@aivera/candidates';
import { createCandidates } from '@aivera/candidates/composition';
import { createDb, withCandidateAccount, type Db } from '@aivera/db';
import { createIdentity } from '@aivera/identity/composition';
import type { WorkspacesContract } from '@aivera/workspaces';
import { createWorkspaces } from '@aivera/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P3-006 acceptance scenarios against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-009).
// Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
// Identity user ids (opaque, from @aivera/identity), which are also the account ids.
const SARA = '0190d4a2-0000-7000-8000-00000000c501';
const ARJUN = '0190d4a2-0000-7000-8000-00000000c502';
const JOB = '0190d4a2-0000-7000-8000-00000000a001';
const OTHER_WORKSPACE = '0190d4a2-0000-7000-8000-000000000002';
const ARJUN_IN_DEMO = '0190d4a2-0000-7000-8000-00000000b002';
const NOW = new Date('2026-11-19T09:00:00.000Z');
const TEXT_VERSION = 'apply-to-job-v1';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let accounts: CandidateAccountsContract;
let workspaces: WorkspacesContract;
let candidates: CandidatesContract;
let demo: string;
let saraInDemo: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const consentFor = (account: string, workspaceId = demo) =>
  accounts.withAccount(account, (ctx) =>
    accounts.recordConsent(ctx, { purpose: 'apply_to_job', workspaceId, jobId: JOB, textVersion: TEXT_VERSION }),
  );
const link = (account: string, consentId: string) =>
  accounts.withAccount(account, (ctx) =>
    accounts.linkToWorkspace(ctx, {
      consentId,
      workspaceId: demo,
      workspaceCandidateId: saraInDemo,
      reason: 'applied',
    }),
  );
const linksOf = (account: string) => accounts.withAccount(account, (ctx) => accounts.listMyWorkspaceLinks(ctx));

/** Every table in the candidate_accounts schema, from the catalogue, so a new table is checked with no edit here. */
const accountTables = async () => [
  ...(await admin.execute<{ name: string; key: string }>(sql`
      select c.relname as name,
        case when c.relname = 'account' then 'identity_user_id' else 'account_id' end as key
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'candidate_accounts' and c.relkind in ('r', 'p') order by name`)),
];

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 1 });
  accounts = createCandidateAccounts(app, () => NOW);
  workspaces = createWorkspaces(app, createAudit(app));
  candidates = createCandidates(workspaces, () => NOW);
  demo = (
    await workspaces.createWorkspace({
      name: 'Demo',
      company: 'Demo Hiring Co',
      hiringFocus: 'AI',
      synthetic: true,
      creatorUserId: ALEX,
    })
  ).id;
  // What Sara submitted with her application: the workspace's own candidate record (AIV-P3-008 creates it).
  saraInDemo = (
    await workspaces.withWorkspace({ userId: ALEX }, demo, (ctx) =>
      candidates.findOrCreatePerson(ctx, {
        displayName: 'Sara Al Qahtani',
        identifiers: [{ type: 'email', value: 'sara.alqahtani@example.com' }],
        synthetic: true,
      }),
    )
  ).personId;
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Scenario: An account is created from the identity user', () => {
  it('the first withAccount creates the account, keyed on the identity user, with no workspace id', async () => {
    const account = await accounts.withAccount(SARA, (ctx) => accounts.getMyAccount(ctx));
    expect(account).toEqual({
      id: SARA,
      fullName: null,
      workType: null,
      headline: null,
      location: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    // Signing in again finds the same account.
    expect(await accounts.withAccount(SARA, (ctx) => accounts.getMyAccount(ctx))).toEqual(account);
    const columns = await admin.execute<{ column_name: string }>(sql`select column_name from information_schema.columns
      where table_schema = 'candidate_accounts' and table_name in ('account', 'profile')`);
    expect([...columns].map((c) => c.column_name)).not.toContain('workspace_id');
  });
});

describe("Scenario: One candidate cannot read another's account", () => {
  beforeAll(async () => {
    await accounts.withAccount(ARJUN, (ctx) => accounts.getMyAccount(ctx));
    // Every table gets a row for each account, so the isolation check below has something to leak.
    for (const account of [SARA, ARJUN]) {
      const consent = await consentFor(account);
      await accounts.withAccount(account, (ctx) =>
        accounts.linkToWorkspace(ctx, {
          consentId: consent.id,
          workspaceId: demo,
          workspaceCandidateId: account === SARA ? saraInDemo : ARJUN_IN_DEMO,
          reason: 'applied',
        }),
      );
    }
  });

  // SAFETY: mutation check: consent_owner_isolation replaced by USING (true) in 0000_init -> this test failed (saw Arjun's consent)
  // SAFETY: mutation check: dropped consent_owner_isolation from 0000_init -> the suite failed (Sara's own consent writes refused)
  it("as Sara's account, a query with no WHERE clause returns only Sara's rows, in every table", async () => {
    const tables = await accountTables();
    expect(tables.map((t) => t.name)).toEqual(['account', 'consent', 'profile', 'workspace_link']);
    for (const { name, key } of tables) {
      const from = sql`candidate_accounts.${sql.identifier(name)}`;
      const [seeded] = await admin.execute<{ n: number }>(
        sql`select count(distinct ${sql.identifier(key)})::int as n from ${from}`,
      );
      expect(seeded?.n, `${name} needs rows for both accounts`).toBe(2);
      const seen = await withCandidateAccount(app, SARA, (tx) =>
        tx.execute<{ k: string }>(sql`select distinct ${sql.identifier(key)}::text as k from ${from}`),
      );
      expect(
        [...seen].map((r) => r.k),
        name,
      ).toEqual([SARA]);
    }
  });

  it('with no account context (a plain query, or a recruiter workspace transaction) every table returns no rows', async () => {
    for (const { name } of await accountTables()) {
      const from = sql`candidate_accounts.${sql.identifier(name)}`;
      expect([...(await app.execute(sql`select * from ${from}`))], name).toEqual([]);
      const inWorkspace = await workspaces.withWorkspace({ userId: ALEX }, demo, ({ tx }) =>
        tx.execute(sql`select * from ${from}`),
      );
      expect([...inWorkspace], name).toEqual([]);
    }
  });

  it("Sara cannot write a row for Arjun's account (WITH CHECK)", async () => {
    await expect(
      withCandidateAccount(app, SARA, (tx) =>
        tx.execute(sql`insert into candidate_accounts.profile (account_id) values (${ARJUN})`),
      ),
    ).rejects.toThrow();
  });
});

describe('Scenario: Consent is recorded with the exact text version', () => {
  it('records purpose apply_to_job, the workspace, the job, the time and the text version', async () => {
    const consent = await consentFor(SARA);
    const [row] = await admin.execute(sql`select account_id, purpose, workspace_id, job_id, granted_at, text_version,
      withdrawn_at from candidate_accounts.consent where id = ${consent.id}`);
    expect(row).toEqual({
      account_id: SARA,
      purpose: 'apply_to_job',
      workspace_id: demo,
      job_id: JOB,
      granted_at: '2026-11-19 09:00:00+00',
      text_version: TEXT_VERSION,
      withdrawn_at: null,
    });
  });

  it('a consent without a text version, or to apply without a job, is refused', async () => {
    await expect(
      accounts.withAccount(SARA, (ctx) =>
        accounts.recordConsent(ctx, { purpose: 'apply_to_job', workspaceId: demo, jobId: JOB, textVersion: ' ' }),
      ),
    ).rejects.toEqual(new CandidateAccountError('text_version'));
    await expect(
      accounts.withAccount(SARA, (ctx) =>
        accounts.recordConsent(ctx, { purpose: 'apply_to_job', workspaceId: demo, jobId: null, textVersion: 'v1' }),
      ),
    ).rejects.toEqual(new CandidateAccountError('consent_target'));
  });
});

describe('Scenario Outline: A workspace link needs consent', () => {
  it('consented: linked (and linking again returns the same link)', async () => {
    const consent = await consentFor(SARA);
    const linked = await link(SARA, consent.id);
    expect(linked).toMatchObject({ accountId: SARA, workspaceId: demo, workspaceCandidateId: saraInDemo });
    expect(await link(SARA, consent.id)).toEqual(linked);
  });

  // SAFETY: mutation check: removed checkLinkConsent from linkToWorkspace -> these tests failed (linkToWorkspace resolved)
  it.each<[string, () => Promise<string>]>([
    ['has not consented', async () => '0190d4a2-0000-7000-8000-00000000dead'],
    [
      'consented and then withdrew',
      async () => {
        const consent = await consentFor(SARA);
        await accounts.withAccount(SARA, (ctx) => accounts.withdrawConsent(ctx, consent.id));
        return consent.id;
      },
    ],
    ["used Arjun's consent", async () => (await consentFor(ARJUN)).id],
    ['consented for another workspace', async () => (await consentFor(SARA, OTHER_WORKSPACE)).id],
  ])('%s: refused, no link created', async (_, consentIdFor) => {
    const consentId = await consentIdFor();
    const before = await linksOf(SARA);
    await expect(link(SARA, consentId)).rejects.toEqual(new CandidateAccountError('consent_required'));
    expect(await linksOf(SARA)).toEqual(before);
  });
});

describe('Scenario: Nothing else reaches the workspace', () => {
  it("the Demo recruiter's candidate record holds only what Sara submitted: no account id or profile", async () => {
    const person = await workspaces.withWorkspace({ userId: ALEX }, demo, (ctx) =>
      candidates.getPerson(ctx, saraInDemo),
    );
    expect(Object.keys(person ?? {}).toSorted()).toEqual(
      [
        'createdAt',
        'displayName',
        'emails',
        'id',
        'location',
        'mergedIntoId',
        'phones',
        'synthetic',
        'workspaceId',
      ].toSorted(),
    );
    expect(JSON.stringify(person)).not.toContain(SARA);
    // No recruiter-side table has a column that could hold the account or the profile.
    const columns = await admin.execute<{
      name: string;
    }>(sql`select table_schema || '.' || table_name || '.' || column_name as name
      from information_schema.columns
      where table_schema not in ('candidate_accounts', 'migrations', 'information_schema', 'pg_catalog')
        and (column_name like '%account%' or column_name in ('headline', 'identity_user_id'))`);
    expect([...columns]).toEqual([]);
  });
});

describe('Scenario: Withdrawing consent is recorded, not deleted', () => {
  let consent: Consent;
  beforeAll(async () => {
    consent = await consentFor(SARA);
  });

  it('the consent row gets a withdrawn time and stays; a second withdrawal is refused', async () => {
    const withdrawn = await accounts.withAccount(SARA, (ctx) => accounts.withdrawConsent(ctx, consent.id));
    expect(withdrawn).toEqual({ ...consent, withdrawnAt: NOW });
    const [row] = await admin.execute(
      sql`select withdrawn_at from candidate_accounts.consent where id = ${consent.id}`,
    );
    expect(row).toEqual({ withdrawn_at: '2026-11-19 09:00:00+00' });
    await expect(accounts.withAccount(SARA, (ctx) => accounts.withdrawConsent(ctx, consent.id))).rejects.toEqual(
      new CandidateAccountError('already_withdrawn'),
    );
  });

  it("Arjun cannot withdraw Sara's consent", async () => {
    await expect(accounts.withAccount(ARJUN, (ctx) => accounts.withdrawConsent(ctx, consent.id))).rejects.toEqual(
      new CandidateAccountError('consent_not_found'),
    );
  });
});

// AIV-P3-007: a recruiter's verified email becomes the same login on the candidate site (ADR-009).
describe('Scenario: A recruiter signs up on the candidate site', () => {
  it('the existing identity user gets a candidate account, not a second user; a second sign-up is refused', async () => {
    const identity = createIdentity(app, { trustedIssuer: 'https://tenant.aivera.example' });
    const token = {
      issuer: 'https://tenant.aivera.example',
      subject: 'nadia-sub',
      email: 'nadia@example.com',
      emailVerified: true,
      displayName: 'Nadia Freelance',
    };
    const nadia = (await identity.upsertUserFromIdToken(token)).id;
    // The candidate sign-in returns the same user (one per verified email).
    expect((await identity.upsertUserFromIdToken(token)).id).toBe(nadia);
    const users = async () =>
      [...(await admin.execute<{ id: string }>(sql`select id from identity.user where email = 'nadia@example.com'`))]
        .length;
    expect(await users()).toBe(1);

    // Opening sign-up creates the empty account; signing up fills it.
    expect(await accounts.withAccount(nadia, (ctx) => accounts.getMyAccount(ctx))).toMatchObject({ fullName: null });
    const signedUp = await accounts.withAccount(nadia, (ctx) =>
      accounts.signUp(ctx, { fullName: '  Nadia Freelance ', workType: 'ai_llm_engineering' }),
    );
    expect(signedUp).toMatchObject({ id: nadia, fullName: 'Nadia Freelance', workType: 'ai_llm_engineering' });
    expect(await users()).toBe(1);

    // SAFETY: mutation check: dropped the not-signed-up guard from setSignUp's WHERE -> this test failed
    await expect(
      accounts.withAccount(nadia, (ctx) => accounts.signUp(ctx, { fullName: 'Someone Else', workType: 'sales' })),
    ).rejects.toThrow(new CandidateAccountError('already_signed_up'));
    const rows = await admin.execute<{ full_name: string; work_type: string }>(
      sql`select full_name, work_type from candidate_accounts.account where identity_user_id = ${nadia}`,
    );
    expect([...rows]).toEqual([{ full_name: 'Nadia Freelance', work_type: 'ai_llm_engineering' }]);
  });

  it('a blank full name is refused and nothing is stored', async () => {
    const id = '0190d4a2-0000-7000-8000-00000000c503';
    await expect(
      accounts.withAccount(id, (ctx) => accounts.signUp(ctx, { fullName: '   ', workType: 'sales' })),
    ).rejects.toThrow(new CandidateAccountError('full_name'));
    expect(await accounts.withAccount(id, (ctx) => accounts.getMyAccount(ctx))).toMatchObject({ fullName: null });
  });
});
