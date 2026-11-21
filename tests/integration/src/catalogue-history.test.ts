import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import { createDb, type Db } from '@credalent/db';
import type { CatalogueEditor } from '@credalent/jobs';
import { createCatalogueEditor } from '@credalent/jobs/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

// AIV-P2-050: the catalogue version history (ADR-013 point 13) through the jobs contract as server/operator.ts calls
// it, on real PostgreSQL: list order and pagination, and counts that match the diff. Synthetic operators only.

const repo = join(import.meta.dirname, '..', '..', '..');
const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(repo, 'packages', 'db', 'src', 'cli.ts');

const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const NOW = new Date('2026-11-21T09:00:00.000Z');
const REASON = 'Add insurance pack for the pilot client';
const SEED_REASON = 'Catalogue version 1 from code (AIV-P1-004, AIV-P1-061)';
const LEDGER = 'Ledger and double-entry accounting';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let editor: CatalogueEditor;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
const at = async () => {
  const draft = (await editor.getEditor()).draft;
  if (!draft) throw new Error('no draft');
  return { version: draft.version, revision: draft.revision };
};

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 4 });
  editor = createCatalogueEditor(
    app,
    createAudit(app, () => NOW),
    () => NOW,
  );

  // Version 2 as Pia publishes it: one pack added, one edited, one competency retired, after a passed eval.
  await editor.openDraft(PIA);
  await editor.saveDraftPack(PIA, { ...(await at()), previousKey: null, key: 'insurance', label: 'Insurance' });
  await editor.saveDraftPack(PIA, { ...(await at()), previousKey: 'telecom', key: 'telecom', label: 'Telecom and 5G' });
  const ledger = (await editor.getEditor()).draft?.packs
    .find((p) => p.key === 'payments_fintech')
    ?.competencies.find((c) => c.name === LEDGER);
  await editor.retireDraftEntry(PIA, {
    ...(await at()),
    entry: 'competency',
    packKey: 'payments_fintech',
    position: ledger?.position ?? -1,
  });
  await editor.requestEval(PIA, await at());
  await admin.execute(sql`update jobs.catalogue_eval_run set status = 'passed', finished_at = ${NOW.toISOString()},
    tokens = 100, result = '{"uncovered":[],"tasks":[]}'::jsonb where status = 'running'`);
  await editor.publishDraft(PIA, { ...(await at()), reason: REASON });
});

afterAll(async () => {
  await Promise.all([app?.$client.end(), admin?.$client.end()]);
  await container?.stop();
});

describe('Feature: Catalogue version history', () => {
  it('Scenario: The list shows each version with its reason', async () => {
    const { total, rows } = await editor.listVersions(1);
    expect(total).toBe(2);
    expect(rows).toEqual([
      {
        version: 2,
        publishedAt: NOW,
        publishedBy: PIA,
        reason: REASON,
        counts: { added: 1, edited: 1, retired: 1 },
        evalStatus: 'passed',
      },
      {
        version: 1,
        publishedAt: expect.any(Date),
        publishedBy: 'system:seed',
        reason: SEED_REASON,
        counts: null,
        evalStatus: null,
      },
    ]);
  });

  it("Scenario: A version's detail shows its diff against the version before; the first has none", async () => {
    const detail = await editor.getVersion(2);
    expect(detail?.version.packs.map((p) => p.key)).toContain('insurance');
    expect(detail?.changes?.map(({ group, kind, name }) => ({ group, kind, name }))).toEqual([
      { group: 'packs', kind: 'edited', name: 'Telecom' },
      { group: 'packs', kind: 'added', name: 'Insurance' },
      { group: 'competencies', kind: 'retired', name: LEDGER },
    ]);
    // The list's counts are this diff's.
    expect(detail?.summary).toEqual((await editor.listVersions(1)).rows[0]);
    const first = await editor.getVersion(1);
    expect(first?.changes).toBeNull();
    expect(first?.summary.counts).toBeNull();
  });

  it('a missing version or the open draft is null, and a version that is not a positive integer is refused', async () => {
    expect(await editor.getVersion(99)).toBeNull();
    await editor.openDraft(PIA);
    expect(await editor.getVersion(3)).toBeNull();
    await editor.discardDraft(PIA, await at());
    await expect(editor.getVersion(0)).rejects.toThrow(ZodError);
    await expect(editor.listVersions(1.5)).rejects.toThrow(ZodError);
  });

  it('pages by 20, newest first, and counts each version against the one before across a page break', async () => {
    // Versions 3 to 22, headers only (the publish flow is tested above and in catalogue-publish.test.ts).
    for (let v = 3; v <= 22; v++)
      await admin.execute(sql`insert into jobs.catalogue_version (version, status, created_by, created_at, published_by,
        published_at, reason) values (${v}, 'published', ${PIA}, now(), ${PIA}, now(), ${`Synthetic version ${v}`})`);
    const first = await editor.listVersions(1);
    expect(first.total).toBe(22);
    expect(first.rows.map((r) => r.version)).toEqual(Array.from({ length: 20 }, (_, i) => 22 - i));
    const second = await editor.listVersions(2);
    expect(second.rows.map((r) => r.version)).toEqual([2, 1]);
    expect(second.rows[0]?.counts).toEqual({ added: 1, edited: 1, retired: 1 });
    // The last row of page 1 is counted against version 2 on the next page (it holds no entries, so it changes nothing).
    expect(first.rows.at(-1)).toMatchObject({ version: 3, counts: { added: 0, edited: 0, retired: 0 } });
    expect((await editor.listVersions(3)).rows).toEqual([]);
  });
});
