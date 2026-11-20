import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AuditError, type AuditContext, type AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, migrateModules, MODULES, withWorkspace, type Db } from '@credalent/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P0-013 acceptance scenarios against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');

// Synthetic opaque ids. Daniel Novak is a persona from docs/00-product/personas.md; only his id is stored.
const id = (n: number) => `0190d4a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const W1 = id(1);
const W2 = id(2);
const INTERVIEWER = id(101);
const DANIEL = { type: 'candidate', id: id(201) };
const NOW = new Date('2026-11-12T09:30:00.000Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let migrator: Db;
let app: Db;
let audit: AuditContract;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  await migrateModules(urlFor('aivera_migrator'), MODULES);
  migrator = createDb(urlFor('aivera_migrator'), { max: 1 });
  app = createDb(urlFor('aivera_app'), { max: 1 });
  audit = createAudit(app, () => NOW);
});

afterAll(async () => {
  await app?.$client.end();
  await migrator?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});
const notes = async () =>
  withWorkspace(app, W1, (tx) => tx.execute<{ note: string }>(sql`select note from audit.entry order by id`));

const as = (tx: AuditContext['tx'], workspaceId: string): AuditContext => ({
  tx,
  workspaceId,
  actor: { type: 'user', id: INTERVIEWER },
});

// Query errors drop the server's message (AIV-P0-902); PostgreSQL's routine tells a privilege refusal from the
// refuse_change trigger's RAISE, the only RAISE on audit.entry.
const PERMISSION_DENIED = expect.objectContaining({ code: '42501', routine: 'aclcheck_error' });
const APPEND_ONLY = expect.objectContaining({ code: '42501', routine: 'exec_stmt_raise' });

describe('the audit schema', () => {
  // audit.platform_entry belongs to no workspace (ADR-012): no tenant policy; aivera_app may only insert into it.
  it('audit.entry has row-level security enabled and forced; both tables are owned by aivera_migrator', async () => {
    const rows = await admin.execute(sql`
      select t.tablename as name, tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
      where t.schemaname = 'audit' order by t.tablename`);
    expect([...rows]).toEqual([
      { name: 'entry', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'platform_entry', owner: 'aivera_migrator', rls: false, forced: false },
    ]);
  });

  // Holds for audit tables added later: each needs the REVOKE and both triggers, or this test fails.
  // SAFETY: mutation check: dropped trigger entry_no_truncate -> this test failed (events 24, not 56)
  // SAFETY: mutation check: GRANT UPDATE ON audit.entry TO aivera_app -> this test failed (update true)
  // SAFETY: mutation check: DISABLE TRIGGER entry_append_only -> this test failed (events 32, not 56)
  it('every table in "audit" refuses UPDATE, DELETE and TRUNCATE to aivera_app and runs refuse_change on all three', async () => {
    const rows = await admin.execute<{
      name: string;
      events: number;
      update: boolean;
      del: boolean;
      trunc: boolean;
    }>(sql`
      select c.relname as name,
        coalesce(bit_or(t.tgtype::int) & (8 | 16 | 32), 0) as events, -- TRIGGER_TYPE_DELETE | UPDATE | TRUNCATE
        has_table_privilege('aivera_app', c.oid, 'UPDATE') as update,
        has_table_privilege('aivera_app', c.oid, 'DELETE') as del,
        has_table_privilege('aivera_app', c.oid, 'TRUNCATE') as trunc
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_trigger t
        on t.tgrelid = c.oid and t.tgfoid = 'audit.refuse_change'::regproc and t.tgenabled = 'A' -- ENABLE ALWAYS
      where n.nspname = 'audit' and c.relkind in ('r', 'p')
      group by c.oid, c.relname`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows)
      expect(row).toEqual({ name: row.name, events: 56, update: false, del: false, trunc: false });
  });
});

describe('Scenario: A score change is recorded with the change', () => {
  it('"score.changed" exists with the interviewer, the time, the note, before 55 and after 61', async () => {
    await withWorkspace(app, W1, (tx) =>
      // The scorecard write would come first in this transaction; the audit write is the last statement.
      audit.record(as(tx, W1), {
        action: 'score.changed',
        subject: DANIEL,
        note: 'Round 1 scorecard: system design backed by the review',
        before: { backedScore: 55 },
        after: { backedScore: 61 },
      }),
    );
    expect(await audit.listFor(W1, DANIEL)).toEqual([
      expect.objectContaining({
        workspaceId: W1,
        action: 'score.changed',
        actor: { type: 'user', id: INTERVIEWER },
        occurredAt: NOW,
        note: 'Round 1 scorecard: system design backed by the review',
        before: { backedScore: 55 },
        after: { backedScore: 61 },
      }),
    ]);
  });
});

// AIV-P0-925: synthetic opaque ids for the actor and the member.
describe('Scenario: Entries written at the same instant come back in insertion order', () => {
  const ALEX = id(102);

  // SAFETY: mutation check: ordered listFor by occurred_at, id -> this test failed (role_changed, revoked, granted)
  it('three entries from one clock reading list as granted, revoked, role_changed', async () => {
    const huda = { type: 'member', id: id(401) };
    const actions = ['job_access.granted', 'job_access.revoked', 'member.role_changed'];
    // Raw inserts with descending ids, so ordering by id instead of insertion order reverses them deterministically.
    await withWorkspace(app, W1, async (tx) => {
      for (const [i, action] of actions.entries())
        await tx.execute(sql`insert into audit.entry (id, workspace_id, occurred_at, actor_type, actor_id, action, subject_type, subject_id)
          values (${id(509 - i)}, ${W1}, '2026-11-18T09:00:00Z', 'user', ${ALEX}, ${action}, ${huda.type}, ${huda.id})`);
    });
    const entries = await audit.listFor(W1, huda);
    expect(entries.map((e) => e.action)).toEqual(actions);
    expect(new Set(entries.map((e) => e.occurredAt.toISOString()))).toEqual(new Set(['2026-11-18T09:00:00.000Z']));
  });

  it('an entry at 09:00:00Z inserted after one at 09:00:05Z still comes first', async () => {
    const huda = { type: 'member', id: id(402) };
    for (const iso of ['2026-11-18T09:00:05Z', '2026-11-18T09:00:00Z'])
      await withWorkspace(app, W1, (tx) =>
        createAudit(app, () => new Date(iso)).record(
          { tx, workspaceId: W1, actor: { type: 'user', id: ALEX } },
          { action: 'job_access.granted', subject: huda },
        ),
      );
    expect((await audit.listFor(W1, huda)).map((e) => e.occurredAt.toISOString())).toEqual([
      '2026-11-18T09:00:00.000Z',
      '2026-11-18T09:00:05.000Z',
    ]);
  });
});

describe('Scenario: The audit entry rolls back with a failed change', () => {
  // SAFETY: mutation check: record() wrote through its own withWorkspace transaction (on a second pooled connection) instead of ctx.tx -> this test failed (the entry survived)
  it('a decision write that fails after the audit insert leaves no entry for that decision', async () => {
    const decision = { type: 'decision', id: id(301) };
    await expect(
      withWorkspace(app, W1, async (tx) => {
        await audit.record(as(tx, W1), { action: 'decision.recorded', subject: decision, note: 'Advance to Round 2' });
        throw new Error('decision write failed');
      }),
    ).rejects.toThrow('decision write failed');
    expect(await audit.listFor(W1, decision)).toEqual([]);
  });
});

describe('Scenario Outline: Entries cannot be changed', () => {
  const statements = {
    UPDATE: sql`update audit.entry set note = 'rewritten'`,
    DELETE: sql`delete from audit.entry`,
    TRUNCATE: sql`truncate audit.entry`,
  };
  // First layer: aivera_app has INSERT and SELECT only.
  // SAFETY: mutation check: GRANT UPDATE, DELETE, TRUNCATE ON audit.entry TO aivera_app -> these failed (the trigger's RAISE, not permission denied)
  it.each(Object.keys(statements) as (keyof typeof statements)[])(
    'the application role running %s on audit.entry is refused (42501) and nothing changes',
    async (statement) => {
      const before = await notes();
      expect(before.length).toBeGreaterThan(0);
      await expect(withWorkspace(app, W1, (tx) => tx.execute(statements[statement]))).rejects.toThrow(
        PERMISSION_DENIED,
      );
      expect(await notes()).toEqual(before);
    },
  );

  // Second layer, which holds even for the table owner: the append-only trigger.
  // SAFETY: mutation check: dropped triggers entry_append_only and entry_no_truncate -> these failed (the owner's statements succeeded)
  it.each(Object.keys(statements) as (keyof typeof statements)[])(
    "even the owner running %s on audit.entry is refused by the append-only trigger's RAISE (42501, exec_stmt_raise)",
    async (statement) => {
      const before = await notes();
      await expect(withWorkspace(migrator, W1, (tx) => tx.execute(statements[statement]))).rejects.toThrow(APPEND_ONLY);
      expect(await notes()).toEqual(before);
    },
  );

  // The triggers are ENABLE ALWAYS, so replica mode (which skips ordinary triggers) does not get round them.
  // SAFETY: mutation check: ALTER TABLE audit.entry ENABLE TRIGGER (not ALWAYS) on both triggers -> these failed (the superuser's statements succeeded)
  it.each(Object.keys(statements) as (keyof typeof statements)[])(
    'a superuser in session_replication_role = replica running %s is still refused',
    async (statement) => {
      const before = await notes();
      await expect(
        admin.transaction(async (tx) => {
          await tx.execute(sql`set local session_replication_role = replica`);
          await tx.execute(statements[statement]);
        }),
      ).rejects.toThrow(APPEND_ONLY);
      expect(await notes()).toEqual(before);
    },
  );
});

describe('Scenario: A note is required where a person changes an outcome', () => {
  it('"decision.recorded" without a note is refused by record() and by the database', async () => {
    const decision = { type: 'decision', id: id(302) };
    await expect(
      withWorkspace(app, W1, (tx) => audit.record(as(tx, W1), { action: 'decision.recorded', subject: decision })),
    ).rejects.toThrow('A note is required for this action');
    // SAFETY: mutation check: dropped constraint entry_note_check -> this assertion failed (the insert succeeded)
    await expect(
      withWorkspace(app, W1, (tx) =>
        tx.execute(sql`insert into audit.entry (id, workspace_id, occurred_at, actor_type, action, subject_type, subject_id)
          values (${id(901)}, ${W1}, now(), 'system', 'decision.recorded', 'decision', ${decision.id})`),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: '23514' }));
    expect(await audit.listFor(W1, decision)).toEqual([]);
  });
});

describe('Scenario: Audit entries are workspace-isolated', () => {
  beforeAll(async () => {
    await withWorkspace(app, W2, async (tx) => {
      for (let i = 0; i < 10; i++)
        await audit.record(as(tx, W2), { action: 'rubric.approved', subject: DANIEL, after: { version: i } });
    });
  });

  it("W1 listing its entries for a subject gets none of W2's", async () => {
    const entries = await audit.listFor(W1, DANIEL);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.workspaceId === W1)).toBe(true);
    expect(await audit.listFor(W2, DANIEL)).toHaveLength(10);
  });

  // SAFETY: mutation check: replaced policy entry_tenant_isolation with USING (true) -> this test failed (saw W2's 10 entries)
  // SAFETY: mutation check: NO FORCE + DISABLE ROW LEVEL SECURITY on audit.entry -> this test failed (saw W2's 10 entries)
  it('with no repository filter, a W1 transaction sees no W2 entry, and none with no workspace set', async () => {
    const rows = await withWorkspace(app, W1, (tx) =>
      tx.execute<{ workspace_id: string }>(sql`select workspace_id from audit.entry`),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.workspace_id))).toEqual(new Set([W1]));
    expect([...(await app.execute(sql`select * from audit.entry`))]).toEqual([]);
  });

  it("a W1 transaction cannot write an entry into W2 (the policy's WITH CHECK)", async () => {
    await expect(
      withWorkspace(app, W1, (tx) => audit.record(as(tx, W2), { action: 'rubric.approved', subject: DANIEL })),
    ).rejects.toThrow(expect.objectContaining({ code: '42501' }));
  });
});

describe('Scenario: No raw personal data in before and after', () => {
  const merged = { type: 'candidate', id: id(202) };

  it('"candidate.merged" holds ids and field names', async () => {
    await withWorkspace(app, W1, (tx) =>
      audit.record(as(tx, W1), {
        action: 'candidate.merged',
        subject: merged,
        before: { candidateId: DANIEL.id, duplicateId: merged.id },
        after: { candidateId: DANIEL.id, mergedFields: 'email,phone' },
      }),
    );
    expect(await audit.listFor(W1, merged)).toEqual([
      expect.objectContaining({ after: { candidateId: DANIEL.id, mergedFields: 'email,phone' } }),
    ]);
  });

  it('an email address or phone number in after is refused and nothing is written', async () => {
    const other = { type: 'candidate', id: id(203) };
    for (const after of [{ email: 'daniel.novak@example.com' }, { phone: '+971 50 000 0000' }])
      await expect(
        withWorkspace(app, W1, (tx) => audit.record(as(tx, W1), { action: 'candidate.merged', subject: other, after })),
      ).rejects.toThrow(new AuditError('personal_data'));
    expect(await audit.listFor(W1, other)).toEqual([]);
  });
});

// AIV-P2-035 (ADR-012): the platform audit log of operator actions. Pia Platform is a synthetic operator; only her
// opaque id is stored.
describe('Scenario: An operator opens the console (the platform audit log)', () => {
  const PIA = id(601);
  const platformRows = () =>
    admin.execute<{ actor_id: string; action: string; occurred_at: string; subject_id: string | null }>(
      sql`select actor_id, action, to_json(occurred_at) #>> '{}' as occurred_at, subject_id
        from audit.platform_entry where actor_id = ${PIA}`,
    );
  // One entry for every case below, so none depends on another's order.
  beforeAll(() => audit.recordPlatform({ actorId: PIA, action: 'ops.console_opened' }));

  it('recordPlatform writes one "ops.console_opened" entry with her user id and the time, and no workspace', async () => {
    expect([...(await platformRows())]).toEqual([
      { actor_id: PIA, action: 'ops.console_opened', occurred_at: '2026-11-12T09:30:00+00:00', subject_id: null },
    ]);
  });

  it('an action that is not on the list is refused by recordPlatform and by the database', async () => {
    await expect(
      audit.recordPlatform({ actorId: PIA, action: 'workspace.created' as 'ops.console_opened' }),
    ).rejects.toThrow(new AuditError('unknown_action'));
    await expect(
      app.execute(sql`insert into audit.platform_entry (id, occurred_at, actor_id, action)
        values (${id(602)}, now(), ${PIA}, 'workspace.created')`),
    ).rejects.toThrow(expect.objectContaining({ code: '23514' }));
  });

  // SAFETY: mutation check: removed the REVOKE in 0010_platform_entry_append_only -> the SELECT, UPDATE and DELETE cases
  // failed (select returned rows; update and delete hit the trigger, not permission denied)
  it.each([
    ['SELECT', sql`select * from audit.platform_entry`],
    ['UPDATE', sql`update audit.platform_entry set note = 'rewritten'`],
    ['DELETE', sql`delete from audit.platform_entry`],
    ['TRUNCATE', sql`truncate audit.platform_entry`],
  ])(
    'the application role running %s on audit.platform_entry is refused (42501): insert-only',
    async (_s, statement) => {
      await expect(app.execute(statement)).rejects.toThrow(PERMISSION_DENIED);
      expect(await platformRows()).toHaveLength(1);
    },
  );

  it('even the owner cannot change an entry: the append-only trigger raises', async () => {
    await expect(migrator.execute(sql`delete from audit.platform_entry`)).rejects.toThrow(APPEND_ONLY);
    expect(await platformRows()).toHaveLength(1);
  });
});
