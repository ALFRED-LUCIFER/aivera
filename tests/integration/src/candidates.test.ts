import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import type { CandidatesContract, FindOrCreatePersonInput, Identifier } from '@credalent/candidates';
import { createCandidates } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import { ForbiddenError, type Role, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// AIV-P1-016 acceptance scenarios against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005).
// Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const LINA = '0190d4a2-0000-7000-8000-0000000011aa';
const HUDA = '0190d4a2-0000-7000-8000-0000000011bb';
const NOW = new Date('2026-11-18T09:00:00.000Z');
const SARA_EMAIL = 'sara.alqahtani@example.com';
const SARA_PHONE = '+971500000001';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let candidates: CandidatesContract;
let w1: string;
let w2: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const sara = (identifiers: Identifier[] = [{ type: 'email', value: SARA_EMAIL }]): FindOrCreatePersonInput => ({
  displayName: 'Sara Al Qahtani',
  identifiers,
  location: 'Dubai',
  synthetic: true,
});

/** True once some transaction waits on a row lock (the second create, blocked on the first one's identifier). */
const blockedOnLock = async () =>
  Number(
    (
      await admin.execute<{ n: string }>(sql`select count(*) as n from pg_stat_activity where wait_event_type = 'Lock'`)
    )[0]?.n,
  ) > 0;

const newWorkspace = async (name: string) =>
  (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX }))
    .id;

const addMember = (workspaceId: string, userId: string, role: Role) =>
  withWorkspace(app, workspaceId, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${workspaceId}, ${userId}, ${role}, 'active')`,
    ),
  );

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 2 }); // two connections, for the concurrent-create case
  workspaces = createWorkspaces(app, createAudit(app));
  candidates = createCandidates(workspaces, () => NOW);
  w1 = await newWorkspace('Demo Hiring Co');
  w2 = await newWorkspace('Gulf Talent Partners');
  await addMember(w1, LINA, 'interviewer');
  await addMember(w1, HUDA, 'hiring_owner');
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Migrations', () => {
  it('candidates tables are owned by aivera_migrator with row-level security enabled and forced', async () => {
    const tables = await admin.execute<{ name: string; owner: string; rls: boolean; forced: boolean }>(sql`
      select t.tablename as name, t.tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
      where t.schemaname = 'candidates' order by name`);
    expect([...tables]).toEqual([
      { name: 'outbox', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'person', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'person_identifier', owner: 'aivera_migrator', rls: true, forced: true },
    ]);
  });
});

describe('Scenario: The same email finds the same person', () => {
  it("an application for Staff Backend Engineer with Sara's email returns her existing person id", async () => {
    const first = await as(ALEX, w1, (ctx) => candidates.findOrCreatePerson(ctx, sara()));
    expect(first.created).toBe(true);
    const again = await as(ALEX, w1, (ctx) =>
      candidates.findOrCreatePerson(ctx, sara([{ type: 'email', value: 'Sara.AlQahtani@Example.com' }])),
    );
    expect(again).toEqual({ personId: first.personId, created: false });
    expect(await as(ALEX, w1, (ctx) => candidates.getPerson(ctx, first.personId))).toMatchObject({
      displayName: 'Sara Al Qahtani',
      emails: [SARA_EMAIL],
      synthetic: true,
      createdAt: NOW,
    });
  });

  // SAFETY: mutation check: removed the person_identifier_pkey catch in insertPerson -> this test failed (unique violation)
  it('two applications arriving at once create one person', async () => {
    const gate = Promise.withResolvers<void>();
    const firstInserted = Promise.withResolvers<void>();
    const input = sara([{ type: 'email', value: 'tarek.mansour@example.com' }]);
    const first = as(ALEX, w1, async (ctx) => {
      const result = await candidates.findOrCreatePerson(ctx, { ...input, displayName: 'Tarek Mansour' });
      firstInserted.resolve();
      await gate.promise; // holds the transaction open, so the second insert waits on its identifier
      return result;
    });
    await firstInserted.promise;
    const second = as(ALEX, w1, (ctx) =>
      candidates.findOrCreatePerson(ctx, { ...input, displayName: 'Tarek Mansour' }),
    );
    // Wait until the second transaction is blocked on the first one's identifier, so the race path really runs.
    while (!(await blockedOnLock())) await sleep(20);
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a.created).toBe(true);
    expect(b).toEqual({ personId: a.personId, created: false });
    const rows = await withWorkspace(app, w1, (tx) =>
      tx.execute(sql`select 1 from candidates.person where display_name = 'Tarek Mansour'`),
    );
    expect(rows).toHaveLength(1);
  });
});

describe('A known person who arrives with a new identifier', () => {
  // SAFETY: mutation check: removed attachIdentifiers from findOrCreatePerson -> this test failed (phone not stored)
  it('keeps the new phone on the existing person', async () => {
    const email = { type: 'email' as const, value: 'arjun.menon@example.com' };
    const { personId } = await as(ALEX, w1, (ctx) =>
      candidates.findOrCreatePerson(ctx, { ...sara([email]), displayName: 'Arjun Menon' }),
    );
    const again = await as(ALEX, w1, (ctx) =>
      candidates.findOrCreatePerson(ctx, {
        ...sara([email, { type: 'phone', value: '+971 50 000 0003' }]),
        displayName: 'Arjun Menon',
      }),
    );
    expect(again).toEqual({ personId, created: false });
    expect(await as(ALEX, w1, (ctx) => candidates.getPerson(ctx, personId))).toMatchObject({
      emails: ['arjun.menon@example.com'],
      phones: ['+971500000003'],
    });
  });
});

describe('Scenario: Identifiers are normalised', () => {
  it('"Sara.AlQahtani@Example.com" and "+971 50 000 0001" are stored normalised', async () => {
    const { personId } = await as(ALEX, w2, (ctx) =>
      candidates.findOrCreatePerson(
        ctx,
        sara([
          { type: 'email', value: 'Sara.AlQahtani@Example.com' },
          { type: 'phone', value: '+971 50 000 0001' },
        ]),
      ),
    );
    const stored = await withWorkspace(app, w2, (tx) =>
      tx.execute<{ type: string; value: string }>(
        sql`select type, value from candidates.person_identifier where person_id = ${personId} order by type`,
      ),
    );
    expect([...stored]).toEqual([
      { type: 'email', value: SARA_EMAIL },
      { type: 'phone', value: SARA_PHONE },
    ]);
  });
});

describe('Scenario: People are isolated by workspace', () => {
  // SAFETY: mutation check: ALTER POLICY person_tenant_isolation and person_identifier_tenant_isolation USING (true) WITH CHECK (true) -> this test and the two below failed (saw both workspaces' rows, the write was allowed)
  it("W1 sees only its own Sara, even with no WHERE clause; W2's is invisible", async () => {
    const w1Sara = await as(ALEX, w1, (ctx) => candidates.findOrCreatePerson(ctx, sara()));
    const w2Sara = await as(ALEX, w2, (ctx) => candidates.findOrCreatePerson(ctx, sara()));
    expect(w1Sara.personId).not.toBe(w2Sara.personId);

    const people = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ workspace_id: string }>(sql`select workspace_id from candidates.person`),
    );
    const identifiers = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ workspace_id: string }>(sql`select workspace_id from candidates.person_identifier`),
    );
    expect(people.length).toBeGreaterThan(0);
    expect(new Set([...people, ...identifiers].map((r) => r.workspace_id))).toEqual(new Set([w1]));
    expect(await as(ALEX, w1, (ctx) => candidates.getPerson(ctx, w2Sara.personId))).toBeNull();
  });

  it('with no app.workspace_id set nothing is visible', async () => {
    expect([...(await app.execute(sql`select * from candidates.person`))]).toEqual([]);
  });

  it('an identifier is unique per workspace, enforced by the database', async () => {
    const { personId } = await as(ALEX, w1, (ctx) => candidates.findOrCreatePerson(ctx, sara()));
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`insert into candidates.person_identifier (workspace_id, type, value, person_id)
          values (${w1}, 'email', ${SARA_EMAIL}, ${personId})`),
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'person_identifier_pkey' });
  });

  // SAFETY: mutation check: made the foreign key person_id -> person(id) only -> this test failed (the insert succeeded)
  it("an identifier cannot point at another workspace's person", async () => {
    const w2Person = await as(ALEX, w2, (ctx) => candidates.findOrCreatePerson(ctx, sara()));
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`insert into candidates.person_identifier (workspace_id, type, value, person_id)
          values (${w1}, 'github_login', 'stray', ${w2Person.personId})`),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it("a write into another workspace is refused by the policy's WITH CHECK", async () => {
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`insert into candidates.person (id, workspace_id, display_name, emails, phones, synthetic, created_at)
          values (${crypto.randomUUID()}, ${w2}, 'Arjun Menon', '{}', '{}', true, now())`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('Scenario: Synthetic people are marked', () => {
  it('the demo cast is created with synthetic = true on every person', async () => {
    const cast = await newWorkspace('Demo cast');
    for (const name of ['Arjun Menon', 'Layla Haddad', 'Daniel Novak', 'Hessa Al Mazrouei'])
      await as(ALEX, cast, (ctx) =>
        candidates.findOrCreatePerson(ctx, {
          displayName: name,
          identifiers: [{ type: 'email', value: `${name.toLowerCase().replaceAll(' ', '.')}@example.com` }],
          synthetic: true,
        }),
      );
    const people = await as(ALEX, cast, (ctx) => candidates.listPeople(ctx));
    expect(people.map((p) => [p.displayName, p.synthetic])).toEqual([
      ['Arjun Menon', true],
      ['Layla Haddad', true],
      ['Daniel Novak', true],
      ['Hessa Al Mazrouei', true],
    ]);
  });
});

describe('Scenario: Personal data stays out of logs', () => {
  it('findOrCreatePerson writes no email or phone to the console, stdout or stderr, on success or refusal', async () => {
    const written: string[] = [];
    const capture = (chunk: unknown) => (written.push(String(chunk)), true);
    const spies = [
      vi.spyOn(process.stdout, 'write').mockImplementation(capture),
      vi.spyOn(process.stderr, 'write').mockImplementation(capture),
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation((...args) => void written.push(args.map(String).join(' '))),
      ),
    ];
    let refusal: unknown;
    try {
      const identifiers = [
        { type: 'email' as const, value: 'Omar.AlSuwaidi@Example.com' },
        { type: 'phone' as const, value: '+971 50 000 0002' },
      ];
      await as(ALEX, w1, (ctx) => candidates.findOrCreatePerson(ctx, sara(identifiers)));
      await as(ALEX, w1, (ctx) => candidates.findOrCreatePerson(ctx, sara(identifiers)));
      refusal = await as(ALEX, w1, (ctx) =>
        candidates.findOrCreatePerson(ctx, sara([{ type: 'phone', value: '050 000 0002' }])),
      ).catch((error: unknown) => error);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    const out = written.join('\n') + String(refusal);
    for (const value of ['omar.alsuwaidi', 'Omar.AlSuwaidi', '+971500000002', '000 0002'])
      expect(out).not.toContain(value);
  });
});

describe('Authorisation (ADR-005 point 6)', () => {
  // SAFETY: mutation check: removed authorize(ctx, 'candidate.view') from listPeople -> this test failed (no ForbiddenError)
  it('hiring owners and interviewers are refused: no job is named', async () => {
    await expect(as(LINA, w1, (ctx) => candidates.listPeople(ctx))).rejects.toThrow(ForbiddenError);
    await expect(as(HUDA, w1, (ctx) => candidates.findOrCreatePerson(ctx, sara()))).rejects.toThrow(ForbiddenError);
  });
});
