import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AiUnavailable, BudgetExceeded, createAiClient, fakeProvider, type AiProvider } from '@aivera/ai';
import { createAudit } from '@aivera/audit/composition';
import { createDb, migrateModules, MODULES, withWorkspace, type Db } from '@aivera/db';
import { createAiTokenBudget, createWorkspaces } from '@aivera/workspaces/composition';
import { MockLanguageModelV4 } from 'ai/test';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P0-033: one persisted daily AI token budget per workspace, against real PostgreSQL as the non-owner aivera_app
// role. Each "process" is its own connection pool and AI client. Synthetic data only.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');
const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const NINE_AM = Date.parse('2026-11-18T09:00:00Z');
const BUDGET = 2_000_000;

let container: StartedPostgreSqlContainer;
let admin: Db;
let reader: Db; // test setup and assertions
const pools: Db[] = [];
let DEMO: string;
let GULF: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

/** A new connection pool: one per simulated process (web, worker, a restarted web). */
const pool = (max = 5) => {
  const db = createDb(urlFor('aivera_app'), { max });
  pools.push(db);
  return db;
};

/** A provider that reports exactly these tokens per call and counts the model requests sent. */
function exact(inputTokens: number, outputTokens: number) {
  const sent = { requests: 0 };
  const provider: AiProvider = {
    ...fakeProvider(),
    languageModel: (deployment) =>
      new MockLanguageModelV4({
        provider: 'fake',
        modelId: deployment,
        doGenerate: async () => {
          sent.requests++;
          return {
            content: [{ type: 'text', text: 'ok' }],
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: inputTokens, noCache: undefined, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
            },
            warnings: [],
          };
        },
      }),
  };
  return { provider, sent };
}

/** One process: its own pool, the PostgreSQL budget store and a client on a fake clock. */
function processWith(provider: AiProvider, clock = { now: NINE_AM }, db = pool()) {
  return createAiClient({ provider, budget: createAiTokenBudget(db), now: () => clock.now, sleep: async () => {} });
}

const draft = (workspaceId: string) =>
  ({ task: 'jobs.draftCompetencies', workspaceId, prompt: 'Draft competencies for a data engineer.' }) as const;

/** The usage rows of a workspace, read inside its own scoped transaction. */
const usage = (workspaceId: string) =>
  withWorkspace(reader, workspaceId, (tx) =>
    tx.execute<{ day: string; tokens: string }>(
      sql`select usage_day::text as day, tokens::text from workspaces.ai_token_usage where workspace_id = ${workspaceId} order by usage_day`,
    ),
  ).then((rows) => rows.map((r) => ({ day: r.day, tokens: Number(r.tokens) })));

const spend = (workspaceId: string, day: string, tokens: number) =>
  createAiTokenBudget(reader).add(workspaceId, day, tokens);

const clear = () => admin.execute(sql`truncate workspaces.ai_token_usage`);

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  await migrateModules(urlFor('aivera_migrator'), MODULES);
  const app = (reader = pool(1));
  const workspaces = createWorkspaces(app, createAudit(app));
  const create = (name: string) =>
    workspaces.createWorkspace({ name, company: name, hiringFocus: 'Data', synthetic: true, creatorUserId: ALEX });
  DEMO = (await create('Demo Hiring Co')).id;
  GULF = (await create('Gulf Talent Partners')).id;
});

afterAll(async () => {
  await Promise.all(pools.map((db) => db.$client.end()));
  await admin?.$client.end();
  await container?.stop();
});

describe('Scenario: A successful call adds its input and output tokens', () => {
  it('1,200 input and 300 output tokens make a 1,500-token row for 2026-11-18', async () => {
    await clear();
    await processWith(exact(1_200, 300).provider).generate(draft(DEMO));
    expect(await usage(DEMO)).toEqual([{ day: '2026-11-18', tokens: 1_500 }]);
  });
});

describe('Scenario: Two processes share one budget', () => {
  // SAFETY: mutation check: skipped the pre-call budget.spentToday check in client.ts -> this test failed (the worker sent a request)
  it("the worker refuses once the web client's calls used 2,000,000 tokens, and sends no model request", async () => {
    await clear();
    const web = exact(BUDGET, 0);
    const worker = exact(1, 1);
    await processWith(web.provider).generate(draft(DEMO));

    await expect(processWith(worker.provider).generate(draft(DEMO))).rejects.toBeInstanceOf(BudgetExceeded);
    expect(worker.sent.requests).toBe(0);
  });
});

describe('Scenario: A restart keeps the count', () => {
  it('a client created again on a new pool still refuses', async () => {
    await clear();
    await spend(DEMO, '2026-11-18', BUDGET);
    const restarted = exact(1, 1);
    await expect(processWith(restarted.provider).generate(draft(DEMO))).rejects.toBeInstanceOf(BudgetExceeded);
    expect(restarted.sent.requests).toBe(0);
  });
});

describe('Scenario: The next UTC day starts a fresh budget', () => {
  it('at 2026-11-19T00:00:00Z the request is sent and the 2026-11-18 row keeps 2,000,000', async () => {
    await clear();
    await spend(DEMO, '2026-11-18', BUDGET);
    const model = exact(10, 5);
    const clock = { now: Date.parse('2026-11-18T23:59:59.999Z') };
    const ai = processWith(model.provider, clock);
    await expect(ai.generate(draft(DEMO))).rejects.toBeInstanceOf(BudgetExceeded);

    clock.now = Date.parse('2026-11-19T00:00:00Z');
    await expect(ai.generate(draft(DEMO))).resolves.toEqual({ text: 'ok' });
    expect(model.sent.requests).toBe(1);
    expect(await usage(DEMO)).toEqual([
      { day: '2026-11-18', tokens: BUDGET },
      { day: '2026-11-19', tokens: 15 },
    ]);
  });
});

describe('Scenario: Concurrent calls do not lose increments', () => {
  // SAFETY: mutation check: replaced the upsert in aiTokenUsageStore.add with a select then an update/insert -> this test failed (lost increments, then a primary key violation)
  it('20 calls of 100 tokens at once across two clients total exactly 2,000', async () => {
    await clear();
    const { provider } = exact(60, 40);
    const [web, worker] = [processWith(provider, undefined, pool(10)), processWith(provider, undefined, pool(10))];
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? web : worker).generate(draft(DEMO))));
    expect(await usage(DEMO)).toEqual([{ day: '2026-11-18', tokens: 2_000 }]);
  });
});

describe('Scenario: A failed call spends nothing', () => {
  it('a call that fails with AiUnavailable after its retries leaves the row at 500', async () => {
    await clear();
    await spend(DEMO, '2026-11-18', 500);
    const ai = processWith(fakeProvider({ failures: [503, 503, 503] }));
    await expect(ai.generate(draft(DEMO))).rejects.toBeInstanceOf(AiUnavailable);
    expect(await usage(DEMO)).toEqual([{ day: '2026-11-18', tokens: 500 }]);
  });
});

describe('Scenario: The store is unavailable', () => {
  // SAFETY: mutation check: made the client fall through to the model call when budget.spentToday threw -> this test failed (a request was sent)
  it('with the usage table unreadable the call throws AiUnavailable, sends nothing and does not quote the prompt', async () => {
    const model = exact(1, 1);
    const prompt = 'Draft competencies for Daniel Novak, daniel.novak@example.com';
    await admin.execute(sql`revoke select on workspaces.ai_token_usage from aivera_app`);
    try {
      const error = await processWith(model.provider)
        .generate({ ...draft(DEMO), prompt })
        .catch((e: unknown) => e);
      expect(error).toEqual(new AiUnavailable('jobs.draftCompetencies', 'budget store'));
      expect(model.sent.requests).toBe(0);
      const text = JSON.stringify({ message: (error as Error).message, stack: (error as Error).stack });
      expect(text).not.toContain('Daniel');
      expect(text).not.toContain('example.com');
    } finally {
      await admin.execute(sql`grant select on workspaces.ai_token_usage to aivera_app`);
    }
  });
});

describe('Scenario: Row-level security isolates usage between workspaces', () => {
  // SAFETY: mutation check: NO FORCE + DISABLE ROW LEVEL SECURITY on workspaces.ai_token_usage -> this test failed (saw the Demo row)
  // SAFETY: mutation check: ALTER POLICY ai_token_usage_tenant_isolation ... USING (true) WITH CHECK (true) -> this test failed (saw the row, insert succeeded)
  it('inside Gulf Talent Partners, an unfiltered read sees no Demo Hiring Co row and an insert for it is refused', async () => {
    await clear();
    await spend(DEMO, '2026-11-18', 1_500);
    const db = pool(1);

    const rows = await withWorkspace(db, GULF, (tx) =>
      tx.execute<{ workspace_id: string }>(sql`select workspace_id from workspaces.ai_token_usage`),
    );
    expect([...rows]).toEqual([]);
    await expect(
      withWorkspace(db, GULF, (tx) =>
        tx.execute(
          sql`insert into workspaces.ai_token_usage (workspace_id, usage_day, tokens) values (${DEMO}, '2026-11-19', 1)`,
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await usage(DEMO)).toEqual([{ day: '2026-11-18', tokens: 1_500 }]);
  });

  // Ownership, ENABLE and FORCE ROW LEVEL SECURITY: tests/integration/src/workspaces.test.ts (every workspaces table).
  it('a negative total is refused by the check constraint', async () => {
    await expect(spend(GULF, '2026-11-18', -1)).rejects.toMatchObject({ constraint: 'ai_token_usage_tokens_check' });
  });
});
