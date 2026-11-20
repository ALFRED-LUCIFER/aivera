import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract, NewPlatformEntry, PlatformEntry } from '@aivera/audit';
import { createAudit } from '@aivera/audit/composition';
import { createDb, migrateModules, MODULES, type Db } from '@aivera/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

// AIV-P2-053 (ADR-012 point 8): the console's named read path into the platform audit log, on real PostgreSQL as the
// non-owner aivera_app. Pia Platform and Theo Platform are synthetic operators and Gulf Talent Partners a synthetic
// workspace (personas.md); only their opaque ids are stored.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');

const id = (n: number) => `0190d4a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PIA = id(601);
const THEO = id(602);
const GULF = id(701);
const OTHER = id(702);
const FN = 'audit.list_platform_entries(text, uuid, uuid, timestamptz, timestamptz, uuid, int)';
const DAY = 86_400_000;
const START = Date.parse('2026-10-15T09:00:00Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let audit: AuditContract;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

// 60 entries over 30 days, two per clock reading, so a page boundary splits a tie (keyset on time, then id).
const SEEDED: (NewPlatformEntry & { at: Date })[] = Array.from({ length: 60 }, (_, i) => {
  const actorId = i % 2 ? THEO : PIA;
  const subject = { type: 'workspace', id: i % 3 ? GULF : OTHER };
  const at = new Date(START + Math.floor((i + 1) / 2) * DAY);
  switch (i % 4) {
    case 0:
      return { at, actorId, action: 'ops.console_opened' };
    case 1:
      return { at, actorId, action: 'ops.workspace_viewed', subject };
    case 2:
      return {
        at,
        actorId,
        action: 'workspace.suspended',
        subject,
        note: 'Billing dispute',
        before: { status: 'active' },
        after: { status: 'suspended' },
      };
    default:
      return {
        at,
        actorId,
        action: 'ai_budget.changed',
        subject,
        note: 'Pilot cap',
        before: { dailyTokenBudget: 2_000_000 },
        after: { dailyTokenBudget: 3_000_000 },
      };
  }
});

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  await migrateModules(urlFor('aivera_migrator'), MODULES);
  app = createDb(urlFor('aivera_app'), { max: 1 });
  let now = new Date(0);
  audit = createAudit(app, () => now);
  for (const { at, ...entry } of SEEDED) {
    now = at;
    await audit.recordPlatform(entry);
  }
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

const newestFirst = (entries: PlatformEntry[]) =>
  entries.every(
    (e, i) =>
      i === 0 ||
      (entries[i - 1] as PlatformEntry).occurredAt > e.occurredAt ||
      ((entries[i - 1] as PlatformEntry).occurredAt.getTime() === e.occurredAt.getTime() &&
        (entries[i - 1] as PlatformEntry).id > e.id),
  );

describe('Scenario: The function returns entries newest first, paginated', () => {
  it('60 entries: the newest 50 and a cursor, then the remaining 10 and no cursor', async () => {
    const first = await audit.listPlatformEntries();
    expect(first.entries).toHaveLength(50);
    expect(first.nextCursor).toBe(first.entries.at(-1)?.id);
    expect(first.entries[0]?.occurredAt).toEqual(SEEDED.at(-1)?.at);

    const second = await audit.listPlatformEntries({ cursor: first.nextCursor ?? undefined });
    expect(second.entries).toHaveLength(10);
    expect(second.nextCursor).toBeNull();

    const all = [...first.entries, ...second.entries];
    expect(newestFirst(all)).toBe(true);
    expect(new Set(all.map((e) => e.id)).size).toBe(60);
    expect(all.at(-1)?.occurredAt).toEqual(new Date(START));
  });

  it('returns the platform columns only, with the values as written', async () => {
    const { entries } = await audit.listPlatformEntries({ action: 'workspace.suspended', pageSize: 1 });
    expect(entries).toEqual([
      {
        id: expect.any(String),
        occurredAt: expect.any(Date),
        actorId: expect.any(String),
        action: 'workspace.suspended',
        subject: { type: 'workspace', id: expect.any(String) },
        note: 'Billing dispute',
        before: { status: 'active' },
        after: { status: 'suspended' },
      },
    ]);
  });

  // SAFETY: mutation check: changed LIMIT least(p_page_size, 50) to LIMIT p_page_size in 0018 -> this test failed (60 rows)
  it('the database caps a page at 50 even when the app role asks for more', async () => {
    const rows = await app.execute(
      sql`select id from audit.list_platform_entries(null, null, null, null, null, null, 500)`,
    );
    expect(rows).toHaveLength(50);
  });
});

describe('Scenario Outline: Filters', () => {
  const FROM = new Date('2026-11-01T00:00:00Z');
  const TO = new Date('2026-11-20T00:00:00Z');
  it.each([
    [
      'action = workspace.suspended',
      { action: 'workspace.suspended' },
      (e: NewPlatformEntry) => e.action === 'workspace.suspended',
    ],
    ["actor = Pia Platform's user id", { actorId: PIA }, (e: NewPlatformEntry) => e.actorId === PIA],
    ['target = Gulf Talent Partners', { targetId: GULF }, (e: NewPlatformEntry) => e.subject?.id === GULF],
    [
      'from 2026-11-01 to 2026-11-20',
      { from: FROM, to: TO },
      (e: NewPlatformEntry & { at?: Date }) => (e.at as Date) >= FROM && (e.at as Date) < TO,
    ],
  ] as const)('%s: every returned entry matches, and none is missing', async (_name, filter, matches) => {
    const { entries } = await audit.listPlatformEntries(filter);
    const expected = SEEDED.filter(matches);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(50);
    expect(entries).toHaveLength(expected.length);
    for (const e of entries)
      expect(
        matches({ ...e, subject: e.subject ?? undefined, at: e.occurredAt } as NewPlatformEntry & { at: Date }),
      ).toBe(true);
  });
});

describe('Scenario: The app role still cannot read the table', () => {
  // SAFETY: mutation check: added GRANT SELECT ON audit.platform_entry TO aivera_app to 0018 -> this test failed (select returned rows)
  it.each([
    ['SELECT', sql`select * from audit.platform_entry`],
    ['UPDATE', sql`update audit.platform_entry set note = 'rewritten'`],
    ['DELETE', sql`delete from audit.platform_entry`],
    ['TRUNCATE', sql`truncate audit.platform_entry`],
  ])('aivera_app running %s on audit.platform_entry is refused with permission denied', async (_s, statement) => {
    await expect(app.execute(statement)).rejects.toThrow(
      expect.objectContaining({ code: '42501', routine: 'aclcheck_error' }),
    );
  });

  // SAFETY: mutation check: removed the REVOKE ALL ... FROM PUBLIC in 0018 -> this test failed (aivera_public could execute)
  it('only aivera_app may execute the function; it runs as its owner with a pinned search_path', async () => {
    const [row] = await admin.execute(sql`
      select has_function_privilege('aivera_app', ${FN}, 'EXECUTE') as app,
        has_function_privilege('aivera_public', ${FN}, 'EXECUTE') as public_role,
        has_table_privilege('aivera_app', 'audit.platform_entry', 'SELECT') as app_select,
        p.prosecdef as definer, p.proconfig as config, pg_get_userbyid(p.proowner) as owner
      from pg_proc p where p.oid = ${FN}::regprocedure`);
    expect(row).toEqual({
      app: true,
      public_role: false,
      app_select: false,
      definer: true,
      config: ['search_path=pg_catalog, pg_temp'],
      owner: 'aivera_migrator',
    });
  });
});

describe('Scenario: Invalid input is rejected', () => {
  it.each([
    ['page size 500', { pageSize: 500 }],
    ['a malformed cursor', { cursor: "x' or 1=1 --" }],
  ])('%s is rejected by the zod schema', async (_name, query) => {
    await expect(audit.listPlatformEntries(query)).rejects.toThrow(ZodError);
  });
});
