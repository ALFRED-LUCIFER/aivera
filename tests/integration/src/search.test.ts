import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AiUnavailable, createAiClient, fakeProvider, type AiProvider } from '@credalent/ai';
import { createSearchIndex } from '@credalent/ai/search';
import { createAudit } from '@credalent/audit/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import { createAiTokenBudget, createWorkspaces } from '@credalent/workspaces/composition';
import { MockEmbeddingModelV4 } from 'ai/test';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P0-030 acceptance scenarios on PostgreSQL with pgvector, as the non-owner aivera_app role. Synthetic data only.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');
const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const OMAR = '0190d4a2-0000-7000-8000-00000000a1e2';
const NOW = new Date('2026-11-20T09:00:00Z');

// Opaque evidence item ids (owned by the evidence module) and their synthetic write-ups (personas.md).
const LAYLA_OCR = '0190d4a2-0000-7000-8000-0000000e0001';
const SARA_HARNESS = '0190d4a2-0000-7000-8000-0000000e0002';
const ARJUN_K8S = '0190d4a2-0000-7000-8000-0000000e0003';
const MAYA_LEDGER = '0190d4a2-0000-7000-8000-0000000e0004';
const LAYLA_TEXT = 'Arabic OCR pipeline, public and documented';
const W2_ONLY = '0190d4a2-0000-7000-8000-0000000e00f2'; // the same write-up, indexed in W2 only

/**
 * A stand-in for meaning: one dimension per concept, so "Arabic evaluation work" lands near the Arabic OCR write-up
 * without sharing its words. The real model's quality is the live smoke test's (packages/ai/src/live.test.ts); this
 * proves storage, ordering, offsets and isolation. Counts the texts it embeds.
 */
const CONCEPTS = [/arabic/i, /evaluat|ocr|pipeline|eval|harness/i, /kubernetes|cluster/i, /payment|ledger/i];
function conceptProvider(failing = false) {
  const embedded: string[] = [];
  const provider: AiProvider = {
    ...fakeProvider(),
    embeddingModel: (deployment) =>
      new MockEmbeddingModelV4({
        provider: 'fake',
        modelId: deployment,
        doEmbed: async ({ values }) => {
          if (failing) throw new Error('model unavailable');
          embedded.push(...values);
          return {
            embeddings: values.map((value) =>
              Array.from({ length: 3072 }, (_, i) => (CONCEPTS[i]?.test(value) ? 1 : i === 3071 ? 0.05 : 0)),
            ),
            usage: { tokens: values.join(' ').length },
            warnings: [],
          };
        },
      }),
  };
  return { provider, embedded };
}

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let w1: string;
let w2: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
const indexWith = (provider: AiProvider) =>
  createSearchIndex({
    db: app,
    ai: createAiClient({ provider, budget: createAiTokenBudget(app), sleep: async () => {} }),
    now: () => NOW,
  });
const ownersOf = (hits: { ownerId: string }[]) => hits.map((h) => h.ownerId);

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 2 });
  const workspaces = createWorkspaces(app, createAudit(app));
  const create = (name: string, creatorUserId: string) =>
    workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId });
  w1 = (await create('Demo hiring team', ALEX)).id;
  w2 = (await create('Gulf Talent Partners', OMAR)).id;
  // The evidence every scenario starts from: W1's, and Layla's write-up again in W2 only.
  const search = indexWith(conceptProvider().provider);
  await search.indexDocument(w1, 'evidence', LAYLA_OCR, LAYLA_TEXT);
  await search.indexDocument(w1, 'evidence', SARA_HARNESS, 'Eval harness, 412 of 460 commits');
  await search.indexDocument(w1, 'evidence', ARJUN_K8S, 'Kubernetes cluster upgrades');
  await search.indexDocument(w1, 'evidence', MAYA_LEDGER, 'Payments ledger reconciliation');
  await search.indexDocument(w2, 'evidence', W2_ONLY, LAYLA_TEXT);
}, 120_000);

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Scenario: Indexed evidence can be found by meaning', () => {
  it('finds Layla Haddad\'s Arabic OCR write-up in the top 3 for "Arabic evaluation work", with its offsets', async () => {
    const search = indexWith(conceptProvider().provider);
    const hits = await search.searchSimilar(w1, 'Arabic evaluation work', { limit: 3 });
    expect(hits).toHaveLength(3);
    expect(hits).toContainEqual({
      ownerModule: 'evidence',
      ownerId: LAYLA_OCR,
      chunkIndex: 0,
      start: 0,
      end: LAYLA_TEXT.length,
    });
    expect(hits[0]?.ownerId).toBe(LAYLA_OCR);
    expect(await search.searchSimilar(w1, 'Arabic evaluation work', { ownerModule: 'documents' })).toEqual([]);
  });
});

describe("Scenario: Another workspace's evidence is never returned", () => {
  it('a search in W1 returns no W2 chunk, though W2 holds the nearest one', async () => {
    const search = indexWith(conceptProvider().provider);
    const hits = await search.searchSimilar(w1, 'Arabic OCR pipeline', { limit: 50 });
    expect(hits.length).toBeGreaterThan(0);
    expect(ownersOf(hits)).not.toContain(W2_ONLY);
    expect(ownersOf(await search.searchSimilar(w2, 'Arabic OCR pipeline'))).toEqual([W2_ONLY]);
  });

  // The repository's workspace filter removed: row-level security alone keeps W2's rows out.
  // SAFETY: mutation check: ALTER TABLE search.chunk DISABLE ROW LEVEL SECURITY -> this test failed (saw W2 rows)
  it('with no workspace filter, W1 sees only W1 rows, and a query with no workspace set sees none', async () => {
    const workspacesSeen = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ w: string }>(sql`select distinct workspace_id::text as w from search.chunk`),
    );
    expect([...workspacesSeen].map((r) => r.w)).toEqual([w1]);
    const [unscoped] = await app.execute<{ n: number }>(sql`select count(*)::int as n from search.chunk`);
    expect(unscoped?.n).toBe(0);
    const [all] = await admin.execute<{ n: number }>(
      sql`select count(*)::int as n from search.chunk where workspace_id = ${w2}`,
    );
    expect(all?.n).toBeGreaterThan(0); // W2 rows exist, so the zeros above are row-level security
  });
});

describe('Scenario: Unchanged text is not re-embedded', () => {
  it('indexing the same text again makes no embed call; a changed chunk is embedded alone', async () => {
    const owner = '0190d4a2-0000-7000-8000-0000000e00a1';
    const text = `${'Arabic evaluation set, '.repeat(100)}${'documented pipeline. '.repeat(100)}`;
    const { provider, embedded } = conceptProvider();
    const search = indexWith(provider);
    await search.indexDocument(w1, 'evidence', owner, text);
    expect(embedded).toHaveLength(3); // 4,400 characters: three overlapping chunks
    embedded.length = 0;
    await search.indexDocument(w1, 'evidence', owner, text);
    expect(embedded).toEqual([]);
    await search.indexDocument(w1, 'evidence', owner, `${text.slice(0, 4000)}Ledger.`);
    expect(embedded).toHaveLength(1);
  });
});

describe('Scenario: Deleting an owner removes its vectors', () => {
  it("removeOwner leaves no chunk for Sara Al Qahtani's evidence item and keeps the others", async () => {
    const owners = async () =>
      (
        await withWorkspace(app, w1, (tx) =>
          tx.execute<{ owner: string }>(sql`select distinct owner_id::text as owner from search.chunk`),
        )
      ).map((r) => r.owner);
    expect(await owners()).toContain(SARA_HARNESS);
    await indexWith(conceptProvider().provider).removeOwner(w1, 'evidence', SARA_HARNESS);
    expect(await owners()).not.toContain(SARA_HARNESS);
    expect(await owners()).toContain(LAYLA_OCR);
  });
});

describe('Scenario: The model is unavailable', () => {
  it('indexing throws AiUnavailable and changes nothing, so search still serves the existing vectors', async () => {
    await expect(
      indexWith(conceptProvider(true).provider).indexDocument(w1, 'evidence', LAYLA_OCR, 'Rewritten: payments'),
    ).rejects.toBeInstanceOf(AiUnavailable);
    const hits = await indexWith(conceptProvider().provider).searchSimilar(w1, 'Arabic evaluation work', { limit: 3 });
    expect(hits[0]).toMatchObject({ ownerId: LAYLA_OCR, end: LAYLA_TEXT.length });
  });
});
