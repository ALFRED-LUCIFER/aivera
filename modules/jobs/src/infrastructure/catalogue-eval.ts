import type { AuditContract } from '@credalent/audit';
import type { Tx } from '@credalent/db/client';
import { enqueue } from '@credalent/db/outbox';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { EvalStore, RunStore } from '../application/catalogue-eval.ts';
import { CatalogueEvalRequestedV1 } from '../contracts/index.ts';
import { evalResultSchema, type EvalRun } from '../domain/catalogue-eval.ts';
import { draftStore } from './catalogue-draft.ts';
import { catalogueEvalRun, outbox } from './schema.ts';

/**
 * The workspace id a catalogue eval's outbox and inbox rows carry: a fixed synthetic id no real workspace has (the same
 * as packages/ai evals' `evalWorkspaceId`). The eval is platform work, but the outbox's tenant policy needs a workspace,
 * so its transactions run in this scope; the catalogue tables have no tenant policy.
 */
export const CATALOGUE_EVAL_SCOPE = '0190d4a2-0000-7000-8000-0000000e7a1e';

const run = {
  id: catalogueEvalRun.id,
  version: catalogueEvalRun.version,
  contentHash: catalogueEvalRun.contentHash,
  status: catalogueEvalRun.status,
  requestedAt: catalogueEvalRun.requestedAt,
  finishedAt: catalogueEvalRun.finishedAt,
  tokens: catalogueEvalRun.tokens,
  result: catalogueEvalRun.result,
};
// The stored result is parsed on every read: a row that is not the schema fails loudly, never counts as passed.
const toRun = ({ result, ...row }: { result: unknown } & Omit<EvalRun, 'result'>): EvalRun => ({
  ...row,
  result: result === null ? null : evalResultSchema.parse(result),
});

/** The eval request's store over one transaction in the eval scope: the draft store's reads, the runs and the outbox. */
export function evalStore(tx: Tx, audit: Pick<AuditContract, 'recordPlatform'>): EvalStore {
  const { lockDraft, read, recordPlatform } = draftStore(tx, audit);
  return {
    lockDraft,
    read,
    recordPlatform,

    async latestRun(version) {
      const [row] = await tx
        .select(run)
        .from(catalogueEvalRun)
        .where(eq(catalogueEvalRun.version, version))
        .orderBy(desc(catalogueEvalRun.requestedAt), desc(catalogueEvalRun.id))
        .limit(1);
      return row ? toRun(row) : null;
    },

    async startRun({ keys, ...values }) {
      await tx.insert(catalogueEvalRun).values({ ...values, keys, status: 'running' });
    },

    async abandonRun(id, at) {
      await tx
        .update(catalogueEvalRun)
        .set({ status: 'error', finishedAt: at })
        .where(and(eq(catalogueEvalRun.id, id), eq(catalogueEvalRun.status, 'running')));
    },

    enqueueRun: (runId, at) =>
      enqueue(tx, outbox, CatalogueEvalRequestedV1, {
        workspaceId: CATALOGUE_EVAL_SCOPE,
        payload: { runId },
        dedupeKey: `catalogue-eval:${runId}`,
        occurredAt: at,
      }),
  };
}

/** The worker job's store over its consumer transaction. */
export function runStore(tx: Tx): RunStore {
  return {
    async lockRun(id) {
      const [row] = await tx
        .select({ ...run, keys: catalogueEvalRun.keys })
        .from(catalogueEvalRun)
        .where(eq(catalogueEvalRun.id, id))
        .for('update');
      return row ? { ...toRun(row), keys: row.keys } : null;
    },

    async tokensOn(day) {
      const start = new Date(`${day}T00:00:00.000Z`);
      const [row] = await tx
        .select({ tokens: sql<number>`coalesce(sum(${catalogueEvalRun.tokens}), 0)::int` })
        .from(catalogueEvalRun)
        .where(
          and(
            gte(catalogueEvalRun.finishedAt, start),
            lt(catalogueEvalRun.finishedAt, new Date(start.getTime() + 86_400_000)),
          ),
        );
      return row?.tokens ?? 0;
    },

    async finishRun(id, end) {
      // Only a run still running: one abandoned meanwhile (timed out, a newer run started) keeps its end.
      await tx
        .update(catalogueEvalRun)
        .set(end)
        .where(and(eq(catalogueEvalRun.id, id), eq(catalogueEvalRun.status, 'running')));
    },
  };
}
