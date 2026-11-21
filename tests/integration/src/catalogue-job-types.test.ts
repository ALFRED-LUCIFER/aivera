import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, type Db } from '@credalent/db';
import {
  CatalogueError,
  jobTypeLabel,
  offeredJobTypes,
  type CatalogueEditor,
  type DraftJobTypeInput,
} from '@credalent/jobs';
import { createCatalogueEditor, createCatalogueReads } from '@credalent/jobs/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

// AIV-P2-047: adding, editing and retiring job types in a catalogue draft (ADR-013 points 5, 6, 11), through the jobs
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

const revision = async () => (await editor.getEditor()).draft?.revision ?? -1;
const draftKeys = async () => (await editor.getEditor()).draft?.jobTypes.map((t) => t.key) ?? [];
const draftJobType = async (key: string) => (await editor.getEditor()).draft?.jobTypes.find((t) => t.key === key);
const lastEntry = async () => (await audit.listPlatformEntries({})).entries[0];
/** The CatalogueError code a call was refused with, "invalid" for a schema refusal, or "saved". */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'saved',
    (error: unknown) =>
      error instanceof CatalogueError ? error.code : error instanceof ZodError ? 'invalid' : Promise.reject(error),
  );
const security = async (patch: Partial<DraftJobTypeInput> = {}): Promise<DraftJobTypeInput> => ({
  version: 2,
  revision: await revision(),
  adding: true,
  key: 'security_engineering',
  label: 'Security engineering',
  evidence: 'Threat models, security reviews, fixed vulnerabilities',
  starters: ['Threat modelling', 'Secure code review', 'Incident response', 'Identity and access'],
  position: 2,
  ...patch,
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

describe('Feature: Edit job types in a catalogue draft', () => {
  it('Scenario: Adding a job type: new in the draft at the position chosen; recruiters still read ten', async () => {
    await editor.saveDraftJobType(PIA, await security());
    const keys = await draftKeys();
    expect(keys.slice(0, 4)).toEqual([
      'software_engineering',
      'qa_test_automation',
      'security_engineering',
      'ai_llm_engineering',
    ]);
    expect(await draftJobType('security_engineering')).toEqual({
      key: 'security_engineering',
      label: { en: 'Security engineering' },
      evidence: { en: 'Threat models, security reviews, fixed vulnerabilities' },
      starterCompetencies: ['Threat modelling', 'Secure code review', 'Incident response', 'Identity and access'],
      retired: false,
    });
    // Not in any pack until the competency form adds it (AIV-P2-045).
    const { draft } = await editor.getEditor();
    expect(draft?.packs.some((p) => p.competencies.some((c) => c.appliesTo.includes('security_engineering')))).toBe(
      false,
    );
    const published = await createCatalogueReads(app).getPublishedCatalogue();
    expect(offeredJobTypes(published)).toHaveLength(10);
    expect(await lastEntry()).toMatchObject({
      action: 'catalogue.entry_added',
      actorId: PIA,
      after: { catalogueVersion: 2, revision: 1, entry: 'jobType', jobTypeKey: 'security_engineering' },
    });
  });

  // SAFETY: mutation check: removed assertFairStarters from saveDraftJobType -> this test failed
  it('Scenario Outline: Keys are checked; exactly four starters; starters follow the fairness rule', async () => {
    const before = await revision();
    expect(await outcome(editor.saveDraftJobType(PIA, await security({ key: 'software_engineering' })))).toBe(
      'key_taken',
    );
    expect(await outcome(editor.saveDraftJobType(PIA, await security()))).toBe('key_taken');
    expect(await outcome(editor.saveDraftJobType(PIA, await security({ key: 'Security Engineering' })))).toBe(
      'invalid',
    );
    expect(
      await outcome(editor.saveDraftJobType(PIA, await security({ key: 'cloud_security', starters: ['a', 'b', 'c'] }))),
    ).toBe('invalid');
    const starters = ['Threat modelling', 'Secure code review', 'Incident response', 'Ex-Big Four experience'];
    expect(await outcome(editor.saveDraftJobType(PIA, await security({ key: 'cloud_security', starters })))).toBe(
      'fairness_employer',
    );
    expect(await revision()).toBe(before);
    expect(await draftJobType('cloud_security')).toBeUndefined();
  });

  // SAFETY: mutation check: made jobTypeKeyUsed return false (dropped the all-versions check) -> this test failed
  it('a key is never reused: every version counts, even one whose row the draft lost', async () => {
    // A draft row lost outside the editor: version 1 still holds the key, so adding it again is refused.
    await admin.execute(sql`delete from jobs.catalogue_job_type where version = 2 and key = 'sales'`);
    expect(
      await outcome(editor.saveDraftJobType(PIA, await security({ key: 'sales', label: 'Sales again', position: 0 }))),
    ).toBe('key_taken');
    expect(await draftJobType('sales')).toBeUndefined();
  });

  it('editing changes the label, evidence, starters and place, never the key', async () => {
    await editor.saveDraftJobType(
      THEO,
      await security({ adding: false, label: 'Security', starters: ['A', 'B', 'C', 'D'], position: 0 }),
    );
    expect((await draftKeys())[0]).toBe('security_engineering');
    expect(await draftJobType('security_engineering')).toMatchObject({
      label: { en: 'Security' },
      starterCompetencies: ['A', 'B', 'C', 'D'],
    });
    expect(await lastEntry()).toMatchObject({ action: 'catalogue.entry_edited', actorId: THEO });
    expect(await outcome(editor.saveDraftJobType(PIA, await security({ adding: false, key: 'no_such_type' })))).toBe(
      'not_found',
    );
  });

  it('Scenario: A published job type is retired, never deleted, and still shows its label after publish', async () => {
    expect(
      await editor.retireDraftEntry(PIA, {
        version: 2,
        revision: await revision(),
        entry: 'jobType',
        jobTypeKey: 'technical_writing_support',
      }),
    ).toBe('retired');
    expect(await draftJobType('technical_writing_support')).toMatchObject({ retired: true });
    expect(await lastEntry()).toMatchObject({
      action: 'catalogue.entry_retired',
      after: { entry: 'jobType', jobTypeKey: 'technical_writing_support' },
    });
    expect(
      await outcome(
        editor.saveDraftJobType(
          PIA,
          await security({ adding: false, key: 'technical_writing_support', label: 'Writing', position: 0 }),
        ),
      ),
    ).toBe('entry_retired');
    expect(
      await outcome(
        editor.retireDraftEntry(PIA, {
          version: 2,
          revision: await revision(),
          entry: 'jobType',
          jobTypeKey: 'technical_writing_support',
        }),
      ),
    ).toBe('entry_retired');
  });

  it('a new job type is removed; not while a pack competency applies to it', async () => {
    const opened = await revision();
    await editor.saveDraftCompetency(PIA, {
      version: 2,
      revision: opened,
      packKey: 'payments_fintech',
      position: null,
      name: 'Payment fraud detection',
      meaning: 'Finds and stops fraudulent payments.',
      evidence: 'Fraud rules with tests; incident reviews',
      levels: { 1: 'Has tuned a fraud rule', 3: 'Owns a fraud service', 5: 'Designs fraud platforms' },
      appliesTo: ['security_engineering'],
      core: [],
      levelNeeded: 3,
    });
    const retire = async () =>
      editor.retireDraftEntry(PIA, {
        version: 2,
        revision: await revision(),
        entry: 'jobType',
        jobTypeKey: 'security_engineering',
      });
    expect(await outcome(retire())).toBe('job_type_in_use');
    const payments = (await editor.getEditor()).draft?.packs.find((p) => p.key === 'payments_fintech');
    const fraud = payments?.competencies.find((c) => c.name === 'Payment fraud detection');
    await editor.retireDraftEntry(PIA, {
      version: 2,
      revision: await revision(),
      entry: 'competency',
      packKey: 'payments_fintech',
      position: fraud?.position ?? -1,
    });
    expect(await retire()).toBe('removed');
    expect(await draftJobType('security_engineering')).toBeUndefined();
    expect(await lastEntry()).toMatchObject({
      action: 'catalogue.entry_removed',
      after: { entry: 'jobType', jobTypeKey: 'security_engineering' },
    });
  });

  it('the audit write is last in its transaction: when it fails, the job type is not saved', async () => {
    const failing = createCatalogueEditor(app, { recordPlatform: async () => Promise.reject(new Error('audit down')) });
    const before = await revision();
    await expect(failing.saveDraftJobType(PIA, await security({ key: 'game_design' }))).rejects.toThrow('audit down');
    expect(await draftJobType('game_design')).toBeUndefined();
    expect(await revision()).toBe(before);
  });

  it('after publish, the retired key still resolves to its label and is no longer offered', async () => {
    // Publish is AIV-P2-049: stand in for it by marking the draft published.
    await admin.execute(sql`update jobs.catalogue_version set status = 'published', published_by = ${PIA},
      published_at = ${NOW.toISOString()}, reason = 'Retire technical writing for the test' where version = 2`);
    const published = await createCatalogueReads(app).getPublishedCatalogue();
    expect(published.version).toBe(2);
    expect(jobTypeLabel(published, 'technical_writing_support')).toBe('Technical writing and support');
    expect(offeredJobTypes(published).map((t) => t.key)).not.toContain('technical_writing_support');
  });
});
