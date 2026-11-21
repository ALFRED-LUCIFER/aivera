import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, type Db } from '@credalent/db';
import { CatalogueError, type CatalogueEditor, type DraftHintInput } from '@credalent/jobs';
import { createCatalogueEditor, createCatalogueReads } from '@credalent/jobs/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P2-046: editing a pack's regional hints in a catalogue draft (ADR-013 points 6, 11, 16), through the jobs
// contract as server/operator.ts calls it, on real PostgreSQL. Synthetic operators and catalogue text only.

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

const fasah: DraftHintInput = {
  version: 2,
  revision: 0,
  packKey: 'logistics_mobility',
  region: 'ksa',
  position: null,
  name: 'FASAH customs integration',
  meaning: 'Integrates customs clearance with the FASAH platform, from declaration to release.',
  evidence: 'Integration code and tests against FASAH documents',
  levels: { 1: 'Has read a FASAH message', 3: 'Owns a FASAH integration', 5: 'Designs customs platforms' },
  appliesTo: ['software_engineering'],
  levelNeeded: 2,
};

const revision = async () => (await editor.getEditor()).draft?.revision ?? -1;
const hints = async (packKey: string, region: string) =>
  (await editor.getEditor()).draft?.packs.find((p) => p.key === packKey)?.hints.filter((h) => h.region === region) ??
  [];
const entries = async () => (await audit.listPlatformEntries({})).entries;
/** The CatalogueError code a call was refused with, or "saved". */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'saved',
    (error: unknown) => (error instanceof CatalogueError ? error.code : Promise.reject(error)),
  );
/** Every hint row of version 1, so a test can prove the published version did not change. */
const versionOneHints = () =>
  admin.execute(sql`select json_agg(h order by pack_key, region, position)::text as hints
    from jobs.catalogue_regional_hint h where version = 1`);

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

describe('Feature: Edit regional hints in a catalogue draft', () => {
  let published: Awaited<ReturnType<typeof versionOneHints>>;

  it('Scenario: Adding a hint', async () => {
    published = await versionOneHints();
    const before = await hints('logistics_mobility', 'ksa');
    await editor.saveDraftHint(THEO, fasah);
    const after = await hints('logistics_mobility', 'ksa');
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toMatchObject({
      name: 'FASAH customs integration',
      type: 'desirable',
      levelNeeded: 2,
      appliesTo: ['software_engineering'],
      retired: false,
      position: before.length,
    });
    expect((await entries())[0]).toMatchObject({
      action: 'catalogue.entry_added',
      actorId: THEO,
      after: {
        catalogueVersion: 2,
        revision: 1,
        entry: 'regionalHint',
        packKey: 'logistics_mobility',
        region: 'ksa',
        position: before.length,
      },
    });
    // Recruiters still read version 1.
    const recruiters = await createCatalogueReads(app).getPublishedCatalogue();
    expect(recruiters.packs.flatMap((p) => p.hints).map((h) => h.name)).not.toContain('FASAH customs integration');
    expect(await versionOneHints()).toEqual(published);
  });

  it('editing a hint keeps its position and is audited as an edit', async () => {
    const [, added] = await hints('logistics_mobility', 'ksa');
    await editor.saveDraftHint(THEO, {
      ...fasah,
      revision: await revision(),
      position: added?.position ?? -1,
      levelNeeded: 3,
    });
    expect((await hints('logistics_mobility', 'ksa'))[1]).toMatchObject({ levelNeeded: 3, position: 1 });
    expect((await entries())[0]).toMatchObject({ action: 'catalogue.entry_edited', actorId: THEO });
  });

  it('Scenario Outline: A hint is a skill, never a residency rule; a refused save changes nothing', async () => {
    const before = await revision();
    // SAFETY: mutation check: removed assertFairHint from saveDraftHint -> this test failed (saved)
    const save = (name: string) => outcome(editor.saveDraftHint(PIA, { ...fasah, revision: before, name }));
    expect(await save('Must hold a UAE residence visa')).toBe('fairness_residency');
    expect(await save('Saudi national')).toBe('fairness_origin');
    expect(await outcome(editor.saveDraftHint(PIA, { ...fasah, revision: before, evidence: '' }))).toBe(
      'evidence_required',
    );
    expect(await outcome(editor.saveDraftHint(PIA, { ...fasah, revision: before, region: 'qatar' }))).toBe('not_found');
    expect(await revision()).toBe(before);
    expect(await save('ZATCA e-invoicing integration')).toBe('saved');
  });

  it('Scenario: A hint cannot be made mandatory: by the server, and by the database', async () => {
    const before = await revision();
    await expect(
      editor.saveDraftHint(PIA, { ...fasah, revision: before, type: 'mandatory' } as DraftHintInput),
    ).rejects.toThrow();
    expect(await revision()).toBe(before);
    // SAFETY: mutation check: dropped catalogue_regional_hint_type_check -> this test failed (insert succeeded)
    await expect(
      admin.execute(sql`insert into jobs.catalogue_regional_hint (version, pack_key, region, position, name, meaning,
        evidence, level_1, level_3, level_5, applies_to, level_needed, type)
        values (2, 'telecom', 'india', 99, 'Number portability', 'Ports numbers.', 'Porting code', 'a', 'b', 'c',
        array['software_engineering'], 2, 'mandatory')`),
    ).rejects.toMatchObject({ constraint: 'catalogue_regional_hint_type_check' });
  });

  it('Scenario: A published hint is retired, not deleted; recruiters still see it until publish', async () => {
    const [freeZone] = await hints('logistics_mobility', 'uae');
    expect(freeZone?.name).toBe('UAE customs and free-zone procedures');
    const target = {
      version: 2,
      revision: await revision(),
      entry: 'regionalHint',
      packKey: 'logistics_mobility',
      region: 'uae',
      position: freeZone?.position ?? -1,
    } as const;
    expect(await editor.retireDraftEntry(PIA, target)).toBe('retired');
    expect((await hints('logistics_mobility', 'uae'))[0]).toMatchObject({
      name: 'UAE customs and free-zone procedures',
      retired: true,
    });
    expect((await entries())[0]).toMatchObject({
      action: 'catalogue.entry_retired',
      actorId: PIA,
      after: { entry: 'regionalHint', region: 'uae', position: 0 },
    });
    const recruiters = await createCatalogueReads(app).getPublishedCatalogue();
    expect(
      recruiters.packs.find((p) => p.key === 'logistics_mobility')?.hints.find((h) => h.region === 'uae'),
    ).toMatchObject({ name: 'UAE customs and free-zone procedures', retired: false });
    expect(await versionOneHints()).toEqual(published);
    // A retired hint is neither edited nor retired again.
    const at = await revision();
    expect(await outcome(editor.retireDraftEntry(PIA, { ...target, revision: at }))).toBe('entry_retired');
    expect(
      await outcome(editor.saveDraftHint(PIA, { ...fasah, revision: at, region: 'uae', position: target.position })),
    ).toBe('entry_retired');
  });

  it('a hint new in the draft is removed, not retired', async () => {
    const added = (await hints('logistics_mobility', 'ksa')).at(-1);
    expect(
      await editor.retireDraftEntry(PIA, {
        version: 2,
        revision: await revision(),
        entry: 'regionalHint',
        packKey: 'logistics_mobility',
        region: 'ksa',
        position: added?.position ?? -1,
      }),
    ).toBe('removed');
    expect((await hints('logistics_mobility', 'ksa')).map((h) => h.name)).not.toContain(added?.name);
    expect((await entries())[0]).toMatchObject({ action: 'catalogue.entry_removed', actorId: PIA });
  });

  it('a stale hint save is refused, naming who saved last', async () => {
    const opened = await revision();
    await editor.saveDraftHint(THEO, { ...fasah, revision: opened, region: 'india', packKey: 'telecom' });
    await expect(
      editor.saveDraftHint(PIA, { ...fasah, revision: opened, region: 'india', packKey: 'telecom' }),
    ).rejects.toMatchObject({ code: 'stale', by: THEO });
  });
});
