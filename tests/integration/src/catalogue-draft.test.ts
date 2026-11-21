import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, type Db } from '@credalent/db';
import { CatalogueError, type CatalogueEditor, type DraftCompetencyInput } from '@credalent/jobs';
import { createCatalogueEditor, createCatalogueReads, createJobs } from '@credalent/jobs/composition';
import type { WorkspaceContext } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P2-045: editing domain packs and their competencies in a catalogue draft (ADR-013 points 3 to 6, 11, 14), through
// the jobs contract as server/operator.ts calls it, on real PostgreSQL. Synthetic operators and catalogue text only.

const repo = join(import.meta.dirname, '..', '..', '..');
const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(repo, 'packages', 'db', 'src', 'cli.ts');

const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const THEO = '0190d4a2-0000-7000-8000-00000000a002';
const RIYA = '0190d4a2-0000-7000-8000-00000000a1e2';
const NOW = new Date('2026-11-21T09:00:00.000Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let audit: AuditContract;
let editor: CatalogueEditor;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const claims: DraftCompetencyInput = {
  version: 2,
  revision: 0,
  packKey: 'insurance',
  position: null,
  name: 'Claims processing systems',
  meaning: 'Builds and runs the systems that take a claim from notice to payment.',
  evidence: 'Claims workflow code and tests; incident reviews of claim errors',
  levels: { 1: 'Has fixed a claim bug', 3: 'Owns a claims service', 5: 'Designs claims platforms' },
  appliesTo: ['software_engineering'],
  core: ['software_engineering'],
  levelNeeded: 3,
};

const revision = async () => (await editor.getEditor()).draft?.revision ?? -1;
const draftPack = async (key: string) => (await editor.getEditor()).draft?.packs.find((p) => p.key === key);
const entries = async () => (await audit.listPlatformEntries({})).entries;
/** The CatalogueError code a call was refused with, or "saved". */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'saved',
    (error: unknown) => (error instanceof CatalogueError ? error.code : Promise.reject(error)),
  );
/** Every row of version 1, so a test can prove the published version did not change. */
const versionOne = () =>
  admin.execute(sql`select (select json_agg(c order by pack_key, position) from jobs.catalogue_pack_competency c
    where version = 1)::text as competencies, (select json_agg(p order by key) from jobs.catalogue_pack p
    where version = 1)::text as packs`);

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 2 });
  audit = createAudit(app, () => NOW);
  editor = createCatalogueEditor(app, audit, () => NOW);
});

afterAll(async () => {
  await Promise.all([app?.$client.end(), admin?.$client.end()]);
  await container?.stop();
});

describe('Feature: Edit domain packs and competencies in a catalogue draft', () => {
  let published: Awaited<ReturnType<typeof versionOne>>;

  it('Scenario: Starting a draft copies the published version', async () => {
    published = await versionOne();
    expect((await editor.getEditor()).draft).toBeNull();
    await editor.openDraft(PIA);
    const { draft, published: live } = await editor.getEditor();
    // Never saved: its last edit is its opening (AIV-P2-051, the console home's "last edited").
    expect(draft).toMatchObject({ version: 2, status: 'draft', revision: 0, revisedBy: null, revisedAt: NOW });
    expect(live.version).toBe(1);
    // Every entry is copied as it is, positions included, so each shows "Live".
    const entriesOf = (v: typeof live | null) => v && { jobTypes: v.jobTypes, regions: v.regions, packs: v.packs };
    expect(entriesOf(draft)).toEqual(entriesOf(live));
    expect(draft?.packs).toHaveLength(8);
    const [entry] = await entries();
    expect(entry).toMatchObject({
      action: 'catalogue.draft_opened',
      actorId: PIA,
      after: { catalogueVersion: 2, publishedVersion: 1 },
    });
    expect(await outcome(editor.openDraft(THEO))).toBe('draft_open');
  });

  it('Scenario: Adding a pack and a competency; recruiters still read version 1', async () => {
    await editor.saveDraftPack(PIA, {
      version: 2,
      revision: 0,
      previousKey: null,
      key: 'insurance',
      label: 'Insurance and insurtech',
    });
    // AIV-P2-051: each save stamps the draft with the clock's time.
    const later = new Date(NOW.getTime() + 2 * 3_600_000);
    await createCatalogueEditor(app, audit, () => later).saveDraftCompetency(PIA, { ...claims, revision: 1 });
    expect((await editor.getEditor()).draft?.revisedAt).toEqual(later);
    const pack = await draftPack('insurance');
    expect(pack).toMatchObject({ label: { en: 'Insurance and insurtech' }, retired: false });
    expect(pack?.competencies).toEqual([
      expect.objectContaining({ name: 'Claims processing systems', type: 'desirable', core: ['software_engineering'] }),
    ]);
    expect(await revision()).toBe(2);
    expect((await entries()).slice(0, 2).map((e) => [e.action, e.actorId, e.after])).toEqual([
      [
        'catalogue.entry_added',
        PIA,
        { catalogueVersion: 2, revision: 2, entry: 'competency', packKey: 'insurance', position: 0 },
      ],
      ['catalogue.entry_added', PIA, { catalogueVersion: 2, revision: 1, entry: 'pack', packKey: 'insurance' }],
    ]);
    // SAFETY: mutation check: readPublishedCatalogue read status 'draft' instead of 'published' -> this test failed (version 2)
    const recruiters = await createCatalogueReads(app).getPublishedCatalogue();
    expect(recruiters.version).toBe(1);
    expect(recruiters.packs.map((p) => p.key)).not.toContain('insurance');
    expect(await versionOne()).toEqual(published);
  });

  it('a new pack may change its key, its competencies moving with it; a published key is fixed and never reused', async () => {
    await editor.saveDraftPack(PIA, {
      version: 2,
      revision: 2,
      previousKey: 'insurance',
      key: 'insurtech',
      label: 'Insurtech',
    });
    expect((await draftPack('insurtech'))?.competencies.map((c) => c.name)).toEqual(['Claims processing systems']);
    expect(await draftPack('insurance')).toBeUndefined();
    await editor.saveDraftPack(PIA, {
      version: 2,
      revision: 3,
      previousKey: 'insurtech',
      key: 'insurance',
      label: 'Insurance and insurtech',
    });
    expect(
      await outcome(
        editor.saveDraftPack(PIA, { version: 2, revision: 4, previousKey: 'telecom', key: 'telco', label: 'Telecom' }),
      ),
    ).toBe('key_fixed');
    expect(
      await outcome(
        editor.saveDraftPack(PIA, { version: 2, revision: 4, previousKey: null, key: 'telecom', label: 'Telecom' }),
      ),
    ).toBe('key_taken');
    // A published pack's label may change; its Arabic label, when it has one, is kept.
    await editor.saveDraftPack(PIA, {
      version: 2,
      revision: 4,
      previousKey: 'telecom',
      key: 'telecom',
      label: 'Telecom and 5G',
    });
    expect((await draftPack('telecom'))?.label).toEqual({ en: 'Telecom and 5G' });
    expect(await versionOne()).toEqual(published);
  });

  it('Scenario Outline: Fairness is enforced on save, and a refused save changes nothing', async () => {
    const before = await revision();
    // SAFETY: mutation check: removed assertFairCompetency from saveDraftCompetency -> this test failed (saved)
    expect(
      await outcome(
        editor.saveDraftCompetency(PIA, {
          ...claims,
          revision: before,
          name: 'Worked at a top insurer',
          evidence: 'Employment history',
          core: [],
        }),
      ),
    ).toBe('fairness_employer');
    expect(
      await outcome(
        editor.saveDraftCompetency(PIA, {
          ...claims,
          revision: before,
          name: 'UAE nationals preferred',
          evidence: 'Passport',
          core: [],
        }),
      ),
    ).toBe('fairness_origin');
    expect(
      await outcome(editor.saveDraftCompetency(PIA, { ...claims, revision: before, evidence: '', core: [] })),
    ).toBe('evidence_required');
    expect(await revision()).toBe(before);
    expect((await draftPack('insurance'))?.competencies).toHaveLength(1);
  });

  it('Scenario: More than four core competencies per job type are refused', async () => {
    for (let i = 1; i < 4; i++)
      await editor.saveDraftCompetency(PIA, { ...claims, revision: await revision(), name: `Claims skill ${i}` });
    expect(
      await outcome(editor.saveDraftCompetency(PIA, { ...claims, revision: await revision(), name: 'Fifth' })),
    ).toBe('core_limit');
    expect((await draftPack('insurance'))?.competencies).toHaveLength(4);
  });

  it('Scenario: A published competency is retired, never deleted; one new in the draft is removed', async () => {
    const audit2 = createAudit(app, () => NOW);
    const workspaces = createWorkspaces(app, audit2);
    const jobs = createJobs(workspaces, audit2, () => NOW);
    const ws = (
      await workspaces.createWorkspace({
        name: 'Demo',
        company: 'Demo',
        hiringFocus: 'software_engineering',
        synthetic: true,
        creatorUserId: RIYA,
      })
    ).id;
    const as = <T>(fn: (ctx: WorkspaceContext) => Promise<T>) => workspaces.withWorkspace({ userId: RIYA }, ws, fn);
    const { job } = await as((ctx) =>
      jobs.createJobWithDraftRubric(ctx, {
        title: 'Backend Engineer, Payments',
        jobType: 'software_engineering',
        description: 'Synthetic.',
        synthetic: true,
        competencies: [
          {
            name: 'Ledger and double-entry accounting',
            evidenceExpected: 'Ledger code',
            weightPercent: 100,
            levelNeeded: 3,
            type: 'desirable',
            origin: 'domain_pack',
            packKey: 'payments_fintech',
            packVersion: 1,
          },
        ],
      }),
    );

    const payments = await draftPack('payments_fintech');
    const ledger = payments?.competencies.find((c) => c.name === 'Ledger and double-entry accounting');
    expect(
      await editor.retireDraftEntry(THEO, {
        version: 2,
        revision: await revision(),
        entry: 'competency',
        packKey: 'payments_fintech',
        position: ledger?.position ?? -1,
      }),
    ).toBe('retired');
    const retired = (await draftPack('payments_fintech'))?.competencies.find((c) => c.position === ledger?.position);
    expect(retired).toMatchObject({ name: 'Ledger and double-entry accounting', retired: true });
    expect((await entries())[0]).toMatchObject({ action: 'catalogue.entry_retired', actorId: THEO });
    // A retired entry is neither edited nor retired again (and writes no second audit entry).
    const at = await revision();
    const retiredLedger = {
      version: 2,
      revision: at,
      entry: 'competency',
      packKey: 'payments_fintech',
      position: ledger?.position ?? -1,
    } as const;
    expect(await outcome(editor.retireDraftEntry(THEO, retiredLedger))).toBe('entry_retired');
    expect(
      await outcome(
        editor.saveDraftCompetency(THEO, {
          ...claims,
          revision: at,
          packKey: 'payments_fintech',
          position: ledger?.position ?? -1,
          core: [],
        }),
      ),
    ).toBe('entry_retired');
    expect(await revision()).toBe(at);

    const [rubric] = (await as((ctx) => jobs.listRubricVersions(ctx, job.id))) ?? [];
    expect(rubric?.competencies).toEqual([expect.objectContaining({ packKey: 'payments_fintech', packVersion: 1 })]);
    expect(await versionOne()).toEqual(published);

    const newOne = (await draftPack('insurance'))?.competencies.at(-1);
    expect(
      await editor.retireDraftEntry(PIA, {
        version: 2,
        revision: await revision(),
        entry: 'competency',
        packKey: 'insurance',
        position: newOne?.position ?? -1,
      }),
    ).toBe('removed');
    expect((await draftPack('insurance'))?.competencies).toHaveLength(3);
    expect((await entries())[0]).toMatchObject({ action: 'catalogue.entry_removed', actorId: PIA });
  });

  // SAFETY: mutation check: removed the revision comparison in begin() -> this test failed (saved)
  it('Scenario: A stale save is refused, not overwritten', async () => {
    const opened = await revision();
    await editor.saveDraftPack(THEO, {
      version: 2,
      revision: opened,
      previousKey: 'insurance',
      key: 'insurance',
      label: 'Insurance',
    });
    const stale = editor.saveDraftPack(PIA, {
      version: 2,
      revision: opened,
      previousKey: 'insurance',
      key: 'insurance',
      label: 'Insurers',
    });
    await expect(stale).rejects.toMatchObject({ code: 'stale', by: THEO });
    // A form left open on another draft (say one discarded since) is stale too, even at the same revision number.
    // SAFETY: mutation check: removed the version comparison in begin() -> this test failed (saved)
    expect(
      await outcome(
        editor.saveDraftPack(PIA, {
          version: 3,
          revision: opened + 1,
          previousKey: 'insurance',
          key: 'insurance',
          label: 'Insurers',
        }),
      ),
    ).toBe('stale');
    expect((await draftPack('insurance'))?.label.en).toBe('Insurance');
    expect(await revision()).toBe(opened + 1);
  });

  it('the audit write is last in its transaction: when it fails, the change is rolled back too', async () => {
    const failing = createCatalogueEditor(app, { recordPlatform: async () => Promise.reject(new Error('audit down')) });
    const before = await revision();
    await expect(
      failing.saveDraftPack(PIA, { version: 2, revision: before, previousKey: null, key: 'gaming', label: 'Gaming' }),
    ).rejects.toThrow('audit down');
    expect(await draftPack('gaming')).toBeUndefined();
    expect(await revision()).toBe(before);
  });

  it('a new pack is removed with its competencies; a published pack is retired', async () => {
    expect(
      await editor.retireDraftEntry(PIA, {
        version: 2,
        revision: await revision(),
        entry: 'pack',
        packKey: 'insurance',
      }),
    ).toBe('removed');
    expect(await draftPack('insurance')).toBeUndefined();
    expect(
      await editor.retireDraftEntry(PIA, { version: 2, revision: await revision(), entry: 'pack', packKey: 'telecom' }),
    ).toBe('retired');
    expect((await draftPack('telecom'))?.retired).toBe(true);
    expect(
      await outcome(editor.saveDraftCompetency(PIA, { ...claims, revision: await revision(), packKey: 'telecom' })),
    ).toBe('pack_retired');
    expect(await versionOne()).toEqual(published);
  });
});
