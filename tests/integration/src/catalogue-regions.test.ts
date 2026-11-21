import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, type Db } from '@credalent/db';
import { CatalogueError, type CatalogueEditor, type DraftHintInput, type DraftRegionInput } from '@credalent/jobs';
import { createCatalogueEditor, createCatalogueReads } from '@credalent/jobs/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

// AIV-P2-059: adding, editing, retiring and removing regions in a catalogue draft (ADR-013 points 6, 11, 16), through
// the jobs contract as server/operator.ts calls it, on real PostgreSQL. Synthetic operators and catalogue text only.

const repo = join(import.meta.dirname, '..', '..', '..');
const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(repo, 'packages', 'db', 'src', 'cli.ts');

const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const THEO = '0190d4a2-0000-7000-8000-00000000a002';
const NOW = new Date('2026-11-21T09:00:00.000Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let audit: AuditContract;
let editor: CatalogueEditor;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const revision = async () => (await editor.getEditor()).draft?.revision ?? -1;
const regions = async () => (await editor.getEditor()).draft?.regions ?? [];
const region = async (key: string) => (await regions()).find((r) => r.key === key);
const hints = async (packKey: string, key: string) =>
  (await editor.getEditor()).draft?.packs.find((p) => p.key === packKey)?.hints.filter((h) => h.region === key) ?? [];
const entries = async () => (await audit.listPlatformEntries({})).entries;
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'saved',
    (error: unknown) =>
      error instanceof CatalogueError ? error.code : error instanceof ZodError ? 'invalid' : Promise.reject(error),
  );
const save = async (operator: string, input: Omit<DraftRegionInput, 'version' | 'revision'>) =>
  editor.saveDraftRegion(operator, { version: 2, revision: await revision(), ...input });
const retire = async (regionKey: string) =>
  editor.retireDraftEntry(THEO, { version: 2, revision: await revision(), entry: 'region', region: regionKey });
const hint = (regionKey: string): DraftHintInput => ({
  version: 2,
  revision: 0,
  packKey: 'payments_fintech',
  region: regionKey,
  position: null,
  name: 'SEPA instant credit transfers',
  meaning: 'Builds payment flows on the SEPA instant credit transfer scheme.',
  evidence: 'Integration code and tests against the scheme rulebook',
  levels: { 1: 'Has read the rulebook', 3: 'Owns a SEPA integration', 5: 'Designs scheme connectivity' },
  appliesTo: ['software_engineering'],
  levelNeeded: 2,
});

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
  await editor.openDraft(PIA);
});

afterAll(async () => {
  await Promise.all([app?.$client.end(), admin?.$client.end()]);
  await container?.stop();
});

describe('Feature: Add and retire regions in a catalogue draft', () => {
  it('Scenario: Adding a region (a two-letter key is allowed by the database)', async () => {
    expect((await regions()).map((r) => r.label.en)).toEqual(['UAE', 'KSA', 'India']);
    await save(PIA, { previousKey: null, key: 'eu', label: 'EU' });
    expect((await regions()).at(-1)).toEqual({ key: 'eu', label: { en: 'EU' }, retired: false });
    expect((await entries())[0]).toMatchObject({
      action: 'catalogue.entry_added',
      actorId: PIA,
      after: { catalogueVersion: 2, revision: 1, entry: 'region', region: 'eu' },
    });
    // The hint form works for it unchanged.
    await editor.saveDraftHint(PIA, { ...hint('eu'), revision: await revision() });
    expect((await hints('payments_fintech', 'eu')).map((h) => h.name)).toEqual(['SEPA instant credit transfers']);
  });

  it('Scenario Outline: The region key and label are validated; a refused save changes nothing', async () => {
    const before = await revision();
    const attempt = (key: string, label: string) =>
      outcome(editor.saveDraftRegion(PIA, { version: 2, revision: before, previousKey: null, key, label }));
    expect(await attempt('EU', 'EU')).toBe('invalid');
    expect(await attempt('ksa', 'Saudi Arabia')).toBe('key_taken');
    expect(await attempt('eu', '')).toBe('invalid');
    expect(await attempt('uae_r', 'UAE residents')).toBe('fairness_region');
    expect(await revision()).toBe(before);
    expect(await attempt('gcc', 'GCC')).toBe('saved');
  });

  it("Scenario: Editing a region's label keeps its key; the change is audited as an edit", async () => {
    await save(THEO, { previousKey: 'ksa', key: 'ksa', label: 'Saudi Arabia' });
    expect(await region('ksa')).toEqual({ key: 'ksa', label: { en: 'Saudi Arabia' }, retired: false });
    expect((await entries())[0]).toMatchObject({
      action: 'catalogue.entry_edited',
      actorId: THEO,
      after: { entry: 'region', region: 'ksa' },
    });
    // Recruiters still read version 1's label.
    const published = await createCatalogueReads(app).getPublishedCatalogue();
    expect(published.regions.find((r) => r.key === 'ksa')?.label.en).toBe('KSA');
  });

  // SAFETY: mutation check: dropped the key_fixed check in saveDraftRegion -> this test failed (saved)
  it('Scenario: A published region key cannot be renamed; a new one can, its hints moving with it', async () => {
    expect(await outcome(save(THEO, { previousKey: 'ksa', key: 'saudi', label: 'KSA' }))).toBe('key_fixed');
    expect(await region('ksa')).toBeDefined();
    await save(THEO, { previousKey: 'eu', key: 'europe_eu', label: 'EU' });
    expect(await region('eu')).toBeUndefined();
    expect((await hints('payments_fintech', 'europe_eu')).map((h) => h.name)).toEqual([
      'SEPA instant credit transfers',
    ]);
    await save(THEO, { previousKey: 'europe_eu', key: 'eu', label: 'EU' });
  });

  it('Scenario: A region new in the draft is removed with its hints, writing catalogue.entry_removed', async () => {
    expect(await retire('gcc')).toBe('removed');
    expect(await region('gcc')).toBeUndefined();
    expect((await entries())[0]).toMatchObject({
      action: 'catalogue.entry_removed',
      actorId: THEO,
      after: { entry: 'region', region: 'gcc' },
    });
    // eu has a hint: removed with it.
    expect(await retire('eu')).toBe('removed');
    expect(await hints('payments_fintech', 'eu')).toEqual([]);
  });

  // SAFETY: mutation check: retire deleted the region and its hints (store.remove) -> this test failed
  it('Scenario: Retiring a region keeps it and its hints, which refuse edits; recruiters keep it until publish', async () => {
    const upi = (await hints('payments_fintech', 'india'))[0];
    expect(upi?.name).toBe('UPI and NPCI rules');
    expect(await retire('india')).toBe('retired');
    expect(await region('india')).toMatchObject({ retired: true });
    expect((await hints('payments_fintech', 'india'))[0]).toMatchObject({ name: 'UPI and NPCI rules' });
    expect((await entries())[0]).toMatchObject({
      action: 'catalogue.entry_retired',
      actorId: THEO,
      after: { entry: 'region', region: 'india' },
    });
    const at = await revision();
    const position = upi?.position ?? -1;
    expect(
      await outcome(editor.saveDraftHint(PIA, { ...hint('india'), revision: at, name: 'UPI AutoPay', position })),
    ).toBe('not_found');
    expect(await outcome(editor.saveDraftHint(PIA, { ...hint('india'), revision: at }))).toBe('not_found');
    expect(
      await outcome(
        editor.retireDraftEntry(PIA, {
          version: 2,
          revision: at,
          entry: 'regionalHint',
          packKey: 'payments_fintech',
          region: 'india',
          position,
        }),
      ),
    ).toBe('entry_retired');
    expect(await outcome(retire('india'))).toBe('entry_retired');
    expect(await outcome(save(PIA, { previousKey: 'india', key: 'india', label: 'Bharat' }))).toBe('entry_retired');
    expect(await revision()).toBe(at);
    // Recruiters read version 1: India and its hints are still offered.
    const published = await createCatalogueReads(app).getPublishedCatalogue();
    expect(published.regions.find((r) => r.key === 'india')?.retired).toBe(false);
  });

  it('Scenario: Errors leave the draft unchanged: a stale revision is refused and writes no audit entry', async () => {
    const stale = (await revision()) - 1;
    const count = (await entries()).length;
    await expect(
      editor.saveDraftRegion(PIA, { version: 2, revision: stale, previousKey: 'uae', key: 'uae', label: 'Emirates' }),
    ).rejects.toMatchObject({ code: 'stale', by: THEO });
    expect((await region('uae'))?.label.en).toBe('UAE');
    expect((await entries()).length).toBe(count);
  });

  it('the audit write is last in its transaction: when it fails, the region is rolled back too', async () => {
    const failing = createCatalogueEditor(app, { recordPlatform: async () => Promise.reject(new Error('audit down')) });
    const before = await revision();
    await expect(
      failing.saveDraftRegion(PIA, { version: 2, revision: before, previousKey: null, key: 'gcc', label: 'GCC' }),
    ).rejects.toThrow('audit down');
    expect(await region('gcc')).toBeUndefined();
    expect(await revision()).toBe(before);
  });

  it('the database refuses a malformed or reserved region key', async () => {
    for (const key of ['e', 'EU', 'none'])
      await expect(
        admin.execute(sql`insert into jobs.catalogue_region (version, key, position, label)
          values (2, ${key}, 99, '{"en":"X"}'::jsonb)`),
      ).rejects.toMatchObject({ constraint: 'catalogue_region_key_check' });
  });
});
