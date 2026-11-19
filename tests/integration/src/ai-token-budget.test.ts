import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AiUnavailable, BudgetExceeded, createAiClient, fakeProvider, type AiProvider } from '@aivera/ai';
import { createAudit } from '@aivera/audit/composition';
import { createDb, migrateModules, MODULES, withWorkspace, type Db } from '@aivera/db';
import { WorkspaceError } from '@aivera/workspaces';
import { createAiBudgetConsole, createAiTokenBudget, createWorkspaces } from '@aivera/workspaces/composition';
import { MockLanguageModelV4 } from 'ai/test';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P0-033: one persisted daily AI token budget per workspace, against real PostgreSQL as the non-owner aivera_app
// role. Each "process" is its own connection pool and AI client. Synthetic data only.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');
const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const PIA = '0190d4a2-0000-7000-8000-00000000a001'; // Pia Platform, an operator (personas.md)
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

// AIV-P2-038: the operator's per-workspace daily budget, set through the console's contract on one pool and read by the
// AI client's check on another, as the app role.
const reason = 'Pilot cap agreed with the team';
const override = async (workspaceId: string) =>
  (
    await admin.execute<{ budget: number | null }>(
      sql`select ai_daily_token_budget as budget from workspaces.workspace where id = ${workspaceId}`,
    )
  )[0]?.budget;
// The platform log is insert-only for aivera_app, so it is read as the superuser.
const platformEntries = async () => [
  ...(await admin.execute(
    sql`select actor_id, action, subject_type, subject_id, note, before, after from audit.platform_entry
      where action = 'ai_budget.changed' order by occurred_at, id`,
  )),
];
const budgetChanges = async (workspaceId: string) =>
  (await createAudit(reader).listFor(workspaceId, { type: 'workspace', id: workspaceId })).filter(
    (e) => e.action === 'ai_budget.changed',
  );
const resetAll = async () => {
  await clear();
  await admin.execute(sql`update workspaces.workspace set ai_daily_token_budget = null`);
};

describe('AIV-P2-038: a per-workspace daily budget', () => {
  // Its own pool of 4, so two operators' changes really run at once.
  let budgets: ReturnType<typeof createAiBudgetConsole> | undefined;
  const ops = () => (budgets ??= createAiBudgetConsole(pool(4), createAudit(reader)));
  const setBudget = (workspaceId: string, dailyBudget: number | null) =>
    ops().setDailyBudget({ operatorId: PIA, workspaceId, dailyBudget, reason });

  describe('Scenario: A lower budget stops further calls', () => {
    // SAFETY: mutation check: made aiTokenUsageStore.spent return AI_DAILY_TOKEN_BUDGET.default as the limit (override ignored) -> this test failed (the request was sent)
    it('with the budget set to 100,000 and 120,000 used today, a call from another process throws and sends nothing', async () => {
      await resetAll();
      await setBudget(DEMO, 100_000);
      await spend(DEMO, '2026-11-18', 120_000);
      const model = exact(1, 1);
      await expect(processWith(model.provider).generate(draft(DEMO))).rejects.toBeInstanceOf(BudgetExceeded);
      expect(model.sent.requests).toBe(0);
      // Another workspace keeps the platform default.
      await spend(GULF, '2026-11-18', 120_000);
      await expect(processWith(model.provider).generate(draft(GULF))).resolves.toEqual({ text: 'ok' });
    });

    it('raising it again lets the next call through', async () => {
      await resetAll();
      await setBudget(DEMO, 100_000);
      await spend(DEMO, '2026-11-18', 120_000);
      await setBudget(DEMO, 200_000);
      await expect(processWith(exact(1, 1).provider).generate(draft(DEMO))).resolves.toEqual({ text: 'ok' });
    });
  });

  describe('Scenario: Setting an override', () => {
    // SAFETY: mutation check: removed the audit.recordPlatform call from setDailyBudget -> this test failed (no platform entry)
    it('records "ai_budget.changed" from 2,000,000 to 500,000 with her user id and the reason in both audit logs', async () => {
      await resetAll();
      const before = (await platformEntries()).length;
      await setBudget(GULF, 500_000);
      expect(await override(GULF)).toBe(500_000);
      expect((await platformEntries()).slice(before)).toEqual([
        {
          actor_id: PIA,
          action: 'ai_budget.changed',
          subject_type: 'workspace',
          subject_id: GULF,
          note: reason,
          before: { dailyTokenBudget: 2_000_000 },
          after: { dailyTokenBudget: 500_000 },
        },
      ]);
      expect((await budgetChanges(GULF)).at(-1)).toMatchObject({
        actor: { type: 'operator', id: PIA },
        note: reason,
        before: { dailyTokenBudget: 2_000_000 },
        after: { dailyTokenBudget: 500_000 },
      });
      expect(await ops().usage(GULF, '2026-11-18', 7)).toMatchObject({ dailyBudget: 500_000, overridden: true });
    });

    it('a reset goes back to the default and is audited from 500,000 to 2,000,000', async () => {
      await resetAll();
      await setBudget(GULF, 500_000);
      await setBudget(GULF, null);
      expect(await override(GULF)).toBeNull();
      expect((await budgetChanges(GULF)).at(-1)).toMatchObject({
        before: { dailyTokenBudget: 500_000 },
        after: { dailyTokenBudget: 2_000_000 },
      });
      expect(await ops().usage(GULF, '2026-11-18', 7)).toMatchObject({ dailyBudget: 2_000_000, overridden: false });
    });

    // SAFETY: mutation check: removed .for('update') from aiTokenUsageStore.setDailyBudget -> this test failed (both entries recorded 2,000,000 as before)
    it('two operators changing it at once: the second records the budget the first left as "before"', async () => {
      await resetAll();
      await Promise.all([setBudget(DEMO, 300_000), setBudget(DEMO, 400_000)]);
      const [first, second] = (await budgetChanges(DEMO)).slice(-2);
      expect(first?.before).toEqual({ dailyTokenBudget: 2_000_000 });
      expect(second?.before).toEqual(first?.after);
      expect(await override(DEMO)).toBe(second?.after?.['dailyTokenBudget']);
    });
  });

  describe('Scenario Outline: Bounds (the database is the last layer)', () => {
    it.each([99_999, 10_000_001])(
      '%d is refused by the check constraint; nothing changes or is audited',
      async (value) => {
        await resetAll();
        const [platform, workspace] = [(await platformEntries()).length, (await budgetChanges(DEMO)).length];
        await expect(setBudget(DEMO, value)).rejects.toMatchObject({
          constraint: 'workspace_ai_daily_token_budget_check',
        });
        expect(await override(DEMO)).toBeNull();
        expect((await platformEntries()).length).toBe(platform);
        expect((await budgetChanges(DEMO)).length).toBe(workspace);
      },
    );
  });

  // SAFETY: mutation check: dropped platform_entry_note_check -> this test failed (the blank-note row was inserted)
  it('the database refuses a platform "ai_budget.changed" entry without a reason', async () => {
    await expect(
      reader.execute(sql`insert into audit.platform_entry (id, occurred_at, actor_id, action, note)
        values (gen_random_uuid(), now(), ${PIA}, 'ai_budget.changed', '  ')`),
    ).rejects.toMatchObject({ constraint: 'platform_entry_note_check' });
  });

  it("the client's check fails closed for a workspace its scope cannot see: AiUnavailable, no request", async () => {
    const model = exact(1, 1);
    await expect(processWith(model.provider).generate(draft('0190d4a2-0000-7000-8000-0000000000ff'))).rejects.toEqual(
      new AiUnavailable('jobs.draftCompetencies', 'budget store'),
    );
    expect(model.sent.requests).toBe(0);
  });

  it('a workspace that does not exist is refused with no_workspace and nothing is audited', async () => {
    const platform = (await platformEntries()).length;
    await expect(setBudget('0190d4a2-0000-7000-8000-0000000000ff', 500_000)).rejects.toEqual(
      new WorkspaceError('no_workspace'),
    );
    expect((await platformEntries()).length).toBe(platform);
  });

  describe('Scenario: Use is shown as observed', () => {
    it('lists today and the 6 UTC days before it, newest first, from the workspace scope only', async () => {
      await resetAll();
      await spend(DEMO, '2026-11-18', 1_500);
      await spend(DEMO, '2026-11-15', 40);
      await spend(DEMO, '2026-11-11', 9); // 7 days back: outside the window
      await spend(GULF, '2026-11-18', 777);
      expect(await ops().usage(DEMO, '2026-11-18', 7)).toEqual({
        dailyBudget: 2_000_000,
        overridden: false,
        days: [
          { day: '2026-11-18', tokens: 1_500 },
          { day: '2026-11-17', tokens: 0 },
          { day: '2026-11-16', tokens: 0 },
          { day: '2026-11-15', tokens: 40 },
          { day: '2026-11-14', tokens: 0 },
          { day: '2026-11-13', tokens: 0 },
          { day: '2026-11-12', tokens: 0 },
        ],
      });
      expect(await ops().usage('0190d4a2-0000-7000-8000-0000000000ff', '2026-11-18', 1)).toBeNull();
    });
  });
});
