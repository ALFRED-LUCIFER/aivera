import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, type Db } from '@credalent/db';
import { CatalogueError, type CatalogueEditor } from '@credalent/jobs';
import { createCatalogueEditor, createCatalogueReads, createJobs } from '@credalent/jobs/composition';
import type { WorkspaceContext } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

// AIV-P2-049: publishing a catalogue draft after a passed eval and a reason, or discarding it (ADR-013 points 4, 13 and
// 14), through the jobs contract as server/operator.ts calls it, on real PostgreSQL. Eval runs are finished here as the
// worker would (the worker itself is catalogue-eval.test.ts). Synthetic operators and catalogue text only.

const repo = join(import.meta.dirname, '..', '..', '..');
const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(repo, 'packages', 'db', 'src', 'cli.ts');

const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const THEO = '0190d4a2-0000-7000-8000-00000000a002';
const RIYA = '0190d4a2-0000-7000-8000-00000000a1e2';
const NOW = new Date('2026-11-21T09:00:00.000Z');
const REASON = 'Add insurance pack for the pilot client';
const LEDGER = 'Ledger and double-entry accounting';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let audit: AuditContract;
let editor: CatalogueEditor;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const draft = async () => {
  const view = (await editor.getEditor()).draft;
  if (!view) throw new Error('no draft');
  return view;
};
const at = async () => {
  const { version, revision } = await draft();
  return { version, revision };
};
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof CatalogueError ? error.code : Promise.reject(error)),
  );
const entries = async () => (await audit.listPlatformEntries({})).entries;
const recruiters = () => createCatalogueReads(app).getPublishedCatalogue();
/** Asks for a run on the draft as it is, then ends it as the worker would. */
async function evalRun(status: 'passed' | 'failed') {
  await editor.requestEval(PIA, await at());
  await admin.execute(sql`update jobs.catalogue_eval_run set status = ${status}, finished_at = ${NOW.toISOString()},
    tokens = 100, result = '{"uncovered":[],"tasks":[]}'::jsonb where status = 'running'`);
}
const versions = () =>
  admin.execute<{ version: number; status: string; published_by: string | null; reason: string | null }>(
    sql`select version, status, published_by, reason from jobs.catalogue_version order by version`,
  );

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 4 });
  audit = createAudit(app, () => NOW);
  editor = createCatalogueEditor(app, audit, () => NOW);
});

afterAll(async () => {
  await Promise.all([app?.$client.end(), admin?.$client.end()]);
  await container?.stop();
});

describe('Feature: Publish or discard a catalogue draft', () => {
  // SAFETY: mutation check: discard deleted the draft's eval runs (catalogueEvalRun in DRAFT_ROWS) -> this test failed
  it('Scenario: Discarding a draft', async () => {
    await editor.openDraft(THEO);
    await editor.saveDraftPack(THEO, { ...(await at()), previousKey: null, key: 'insurance', label: 'Insurance' });
    await evalRun('failed');
    // A discard made on an older copy of the draft deletes nothing.
    expect(await outcome(editor.discardDraft(THEO, { version: 2, revision: 0 }))).toBe('stale');
    await editor.discardDraft(THEO, await at());

    expect((await editor.getEditor()).draft).toBeNull();
    expect(await versions()).toEqual([expect.objectContaining({ version: 1, status: 'published' })]);
    const [left] = await admin.execute<{ n: number }>(sql`select
      (select count(*) from jobs.catalogue_pack where version = 2)
      + (select count(*) from jobs.catalogue_job_type where version = 2)
      + (select count(*) from jobs.catalogue_pack_competency where version = 2)
      + (select count(*) from jobs.catalogue_regional_hint where version = 2)
      + (select count(*) from jobs.catalogue_region where version = 2) as n`);
    expect(Number(left?.n)).toBe(0);
    // The run stays without its draft, so a discard never lowers the day's eval token spend.
    expect(await admin.execute(sql`select version, status, tokens from jobs.catalogue_eval_run`)).toEqual([
      { version: null, status: 'failed', tokens: 100 },
    ]);
    expect((await recruiters()).version).toBe(1);
    expect((await entries())[0]).toMatchObject({
      action: 'catalogue.draft_discarded',
      actorId: THEO,
      after: { catalogueVersion: 2, publishedVersion: 1, revision: 1 },
    });
    expect(await outcome(editor.discardDraft(THEO, { version: 2, revision: 1 }))).toBe('no_draft');
  });

  it('a discard is refused while an eval run on the draft is running', async () => {
    await editor.openDraft(PIA);
    // The new draft reuses number 2 but not the discarded draft's run.
    expect(await editor.getDraftEval()).toEqual({ status: 'not_run' });
    await editor.requestEval(PIA, await at());
    expect(await outcome(editor.discardDraft(PIA, await at()))).toBe('eval_running');
    await admin.execute(sql`update jobs.catalogue_eval_run set status = 'error', finished_at = now()
      where status = 'running'`);
  });

  // SAFETY: mutation check: removed the eval_required throw from publishDraft -> this test failed (published)
  it('Scenario Outline: Publish is refused without a passed eval on the current content', async () => {
    await editor.saveDraftPack(PIA, {
      ...(await at()),
      previousKey: null,
      key: 'insurance',
      label: 'Insurance and insurtech',
    });
    const refused = async () => outcome(editor.publishDraft(PIA, { ...(await at()), reason: REASON }));
    // The latest run could not run (the one above): not passed.
    expect(await refused()).toBe('eval_required');
    await evalRun('failed');
    expect(await refused()).toBe('eval_required');
    await evalRun('passed');
    await editor.saveDraftPack(PIA, {
      ...(await at()),
      previousKey: 'telecom',
      key: 'telecom',
      label: 'Telecom and 5G',
    });
    // The draft changed after the eval passed.
    expect(await refused()).toBe('eval_required');
    expect(await versions()).toHaveLength(2);
    expect((await versions())[1]?.status).toBe('draft');
  });

  // SAFETY: mutation check: dropped `.min(10)` from publishDraftSchema's reason -> this test failed (no ZodError)
  it('the reason needs at least 10 characters, checked before anything is read', async () => {
    await evalRun('passed');
    await expect(editor.publishDraft(PIA, { ...(await at()), reason: '  Add it   ' })).rejects.toThrow(ZodError);
  });

  // SAFETY: mutation check: readCatalogueVersion took the oldest published version, not the newest -> this test failed (1)
  it('Scenario: Publishing needs a passed eval and a reason; recruiters read version 2 next request', async () => {
    const workspaces = createWorkspaces(app, audit);
    const jobs = createJobs(workspaces, audit, () => NOW);
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
            name: LEDGER,
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
    const [open] = (await as((ctx) => jobs.listRubricVersions(ctx, job.id))) ?? [];
    await as((ctx) => jobs.approveRubric(ctx, open?.id ?? ''));
    const rubricBefore = await as((ctx) => jobs.listRubricVersions(ctx, job.id));

    // Version 2 also retires the competency the approved rubric kept.
    const ledger = (await draft()).packs
      .find((p) => p.key === 'payments_fintech')
      ?.competencies.find((c) => c.name === LEDGER);
    await editor.retireDraftEntry(PIA, {
      ...(await at()),
      entry: 'competency',
      packKey: 'payments_fintech',
      position: ledger?.position ?? -1,
    });
    await evalRun('passed');
    const before = (await entries()).length;
    await editor.publishDraft(PIA, { ...(await at()), reason: REASON });

    expect((await versions())[1]).toEqual({ version: 2, status: 'published', published_by: PIA, reason: REASON });
    expect((await editor.getEditor()).draft).toBeNull();
    const latest = await recruiters();
    expect(latest.version).toBe(2);
    expect(latest.packs.map((p) => p.label.en)).toContain('Insurance and insurtech');
    const [entry, ...rest] = await entries();
    expect(rest).toHaveLength(before);
    expect(entry).toMatchObject({
      action: 'catalogue.published',
      actorId: PIA,
      note: REASON,
      after: { catalogueVersion: 2, publishedVersion: 1, added: 1, edited: 1, retired: 1 },
    });

    // Scenario: Existing rubrics are not touched.
    expect(await as((ctx) => jobs.listRubricVersions(ctx, job.id))).toEqual(rubricBefore);
    expect(rubricBefore?.[0]?.competencies).toEqual([
      expect.objectContaining({ name: LEDGER, packKey: 'payments_fintech', packVersion: 1 }),
    ]);

    // The published version is frozen; the next draft is version 3, copied from it.
    await expect(
      admin.execute(sql`update jobs.catalogue_pack set label = '{"en":"x"}' where version = 2 and key = 'insurance'`),
    ).rejects.toThrow();
    await expect(admin.execute(sql`delete from jobs.catalogue_version where version = 2`)).rejects.toThrow();
    await editor.openDraft(THEO);
    expect((await draft()).version).toBe(3);
  });

  it('a draft that changes nothing is not published', async () => {
    await evalRun('passed');
    expect(await outcome(editor.publishDraft(THEO, { ...(await at()), reason: REASON }))).toBe('no_changes');
  });

  it('an audit write that fails rolls the publish back: neither lands', async () => {
    await editor.saveDraftPack(THEO, { ...(await at()), previousKey: 'telecom', key: 'telecom', label: 'Telecoms' });
    await evalRun('passed');
    const failing = createCatalogueEditor(
      app,
      {
        recordPlatform: async () => {
          throw new Error('audit down');
        },
      },
      () => NOW,
    );
    await expect(failing.publishDraft(THEO, { ...(await at()), reason: REASON })).rejects.toThrow('audit down');
    expect((await versions()).at(-1)).toMatchObject({ version: 3, status: 'draft' });
    expect((await recruiters()).version).toBe(2);
  });

  it('Scenario: A racing change is refused, not merged', async () => {
    // Draft 3 changes the Telecom label and its eval passed (the scenario above).
    const seen = await at();
    const [publish, edit] = await Promise.all([
      outcome(editor.publishDraft(PIA, { ...seen, reason: REASON })),
      outcome(editor.saveDraftPack(THEO, { ...seen, previousKey: 'telecom', key: 'telecom', label: 'Telecom and 5G' })),
    ]);
    // Both lock the draft row: whichever runs second finds it moved on and changes nothing.
    expect([publish, edit].filter((o) => o === 'ok')).toHaveLength(1);
    if (publish === 'ok') expect(edit).toBe('no_draft');
    else {
      expect(publish).toBe('stale');
      expect((await versions()).at(-1)).toMatchObject({ version: 3, status: 'draft' });
    }
  });
});
