// Builds the jobs module for an app (ADR-002: only apps import this).
import type { AiClient } from '@credalent/ai';
import type { AuditContract } from '@credalent/audit';
import type { Db, Tx } from '@credalent/db/client';
import { enqueue } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import { withWorkspace } from '@credalent/db/with-workspace';
import type { WorkspacesContract } from '@credalent/workspaces';
import { sql } from 'drizzle-orm';
import type { Handler } from '@credalent/db/consumer';
import { log } from '@credalent/observability';
import { catalogueEditor } from './application/catalogue-editor.ts';
import { cataloguePublish } from './application/catalogue-publish.ts';
import { catalogueEval, runDraftEval, type EvalKeys, type EvalOutcome } from './application/catalogue-eval.ts';
import { domainDetection } from './application/detect-domain.ts';
import { competencyDrafting } from './application/draft-competencies.ts';
import { jobsUseCases } from './application/jobs.ts';
import {
  CatalogueEvalRequestedV1,
  JobPublishedV1,
  JobUnpublishedV1,
  RubricApprovedV1,
  type ApprovedRubricReads,
  type CatalogueEditor,
  type CatalogueReads,
  type CompetencyDrafting,
  type DomainDetecting,
  type JobCounts,
  type JobsContract,
  type PublicJobsContract,
} from './contracts/index.ts';
import { readPublishedCatalogue } from './infrastructure/catalogue.ts';
import { draftStore } from './infrastructure/catalogue-draft.ts';
import { CATALOGUE_EVAL_SCOPE, evalStore, runStore } from './infrastructure/catalogue-eval.ts';
import { publishStore } from './infrastructure/catalogue-publish.ts';
import { findBySlug, listOpen } from './infrastructure/public-reads.ts';
import { approvedRubric, countJobs, jobStore } from './infrastructure/repository.ts';
import { inbox, outbox } from './infrastructure/schema.ts';

/**
 * Every call runs in the request's `withWorkspace` transaction (`ctx.tx`), so no pool is needed here.
 * `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one.
 */
export function createJobs(
  workspaces: Pick<WorkspacesContract, 'authorize' | 'listClients' | 'getWorkspace' | 'setJobOwner'>,
  audit: Pick<AuditContract, 'record'>,
  now: () => Date = () => new Date(),
): JobsContract {
  return jobsUseCases({
    storeFor: jobStore,
    authorize: (ctx, action, resource) => workspaces.authorize(ctx, action, resource),
    listClients: (ctx) => workspaces.listClients(ctx),
    setJobOwner: (ctx, input) => workspaces.setJobOwner(ctx, input),
    publishedCatalogue: (ctx) => readPublishedCatalogue(ctx.tx),
    isSyntheticWorkspace: async (ctx) => (await workspaces.getWorkspace(ctx))?.synthetic === true,
    publishRubricApproved: (ctx, { occurredAt, ...payload }) =>
      enqueue(ctx.tx, outbox, RubricApprovedV1, {
        workspaceId: ctx.workspaceId,
        payload,
        dedupeKey: `rubric-approved:${payload.rubricVersionId}`,
        occurredAt,
      }),
    // A job may be published and unpublished many times: each change is its own event.
    publishListingChange: (ctx, { listed, jobId, occurredAt }) =>
      enqueue(ctx.tx, outbox, listed ? JobPublishedV1 : JobUnpublishedV1, {
        workspaceId: ctx.workspaceId,
        payload: { jobId },
        dedupeKey: `${listed ? 'job-published' : 'job-unpublished'}:${jobId}:${occurredAt.toISOString()}`,
        occurredAt,
      }),
    audit: (ctx, entry) =>
      audit.record({ tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: ctx.userId } }, entry),
    newId: () => uuidv7(),
    now,
  });
}

/**
 * The candidate site's reads on the app's pool, with no workspace. Each call is its own transaction switched to
 * aivera_public (SET LOCAL ROLE, undone at commit or rollback), which can read the public columns of jobs.public_job
 * and nothing else, so a wrong query in a public read is refused. It does not stop injected SQL (RESET ROLE); all SQL
 * here is parameterised (AGENTS.md 3.10).
 */
export function createPublicJobs(db: Db): PublicJobsContract {
  const asPublic = <T>(read: (tx: Tx) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local role aivera_public`);
      return read(tx);
    });
  return { listPublicJobs: () => asPublic(listOpen), findPublicJob: (slug) => asPublic((tx) => findBySlug(tx, slug)) };
}

/** The operator console's job count (ADR-012 point 6), each call in the workspace's own scoped transaction. */
export function createJobCounts(db: Db): JobCounts {
  return { countJobs: (workspaceId) => withWorkspace(db, workspaceId, (tx) => countJobs(tx, workspaceId)) };
}

/**
 * The catalogue in the database (ADR-013 point 15) on the app's pool, with no workspace: the tables are platform tables.
 * Each read is one read-only snapshot.
 * shortcut: every read queries the database; cache a published version by its number (it never changes) if the reads
 * show in request latency.
 */
export function createCatalogueReads(db: Db): CatalogueReads {
  return {
    getPublishedCatalogue: () =>
      db.transaction(readPublishedCatalogue, { isolationLevel: 'repeatable read', accessMode: 'read only' }),
  };
}

/**
 * The catalogue editor (ADR-013 points 3 to 6, 15) on the app's pool, with no workspace: platform tables. Each call is
 * one transaction, its platform audit entry last. For /ops only, behind platformOperator() (architecture rule
 * `operator-only-writes`).
 */
export function createCatalogueEditor(
  db: Db,
  audit: Pick<AuditContract, 'recordPlatform'>,
  now: () => Date = () => new Date(),
): CatalogueEditor {
  const snapshot = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;
  return {
    ...catalogueEditor({
      inTransaction: (work) => db.transaction((tx) => work(draftStore(tx, audit))),
      inSnapshot: (work) => db.transaction((tx) => work(draftStore(tx, audit)), snapshot),
      now,
    }),
    // The request writes the outbox, whose tenant policy needs a workspace: the eval's fixed scope (AIV-P2-048).
    ...catalogueEval({
      inTransaction: (work) => withWorkspace(db, CATALOGUE_EVAL_SCOPE, (tx) => work(evalStore(tx, audit))),
      inSnapshot: (work) => db.transaction((tx) => work(evalStore(tx, audit)), snapshot),
      newId: uuidv7,
      now,
    }),
    ...cataloguePublish({ inTransaction: (work) => db.transaction((tx) => work(publishStore(tx, audit))), now }),
  };
}

/** The worker queue the catalogue eval job is consumed from (infra/modules/messaging.bicep). */
export const CATALOGUE_EVAL_QUEUE = 'jobs';

/**
 * The catalogue eval worker job (AIV-P2-048) for `CATALOGUE_EVAL_QUEUE`. `evaluate` runs the golden sets with the run's
 * keys within the tokens left today; the worker binds it to `@credalent/ai/evals` and the environment's AI deployment.
 * Logs carry the run id, version and counts, never a golden case's text.
 */
export function createCatalogueEvalHandler(config: {
  evaluate: (keys: EvalKeys, tokensLeftToday: number) => Promise<EvalOutcome>;
  now: () => Date;
}): Handler<{ runId: string }> {
  return {
    event: CatalogueEvalRequestedV1,
    inbox,
    consumer: 'jobs.catalogue.eval',
    async handle(tx, { runId }) {
      const end = await runDraftEval(runStore(tx), runId, config);
      if (end)
        log.info(
          {
            area: 'jobs',
            'catalogue.run.id': runId,
            code: end.status,
            'credalent.catalogue.version': end.version,
            'credalent.catalogue.eval_tokens': end.tokens,
            'credalent.catalogue.eval_failed_cases': end.failed,
          },
          'catalogue eval finished',
        );
    },
  };
}

/** "Draft competencies" on the app's AI client (`createAiClient` with the workspaces budget store). */
export const createCompetencyDrafting = (ai: Pick<AiClient, 'generateStructured'>): CompetencyDrafting =>
  competencyDrafting(ai);

/** "Detect the job's industry" on the app's AI client, as `createCompetencyDrafting`. */
export const createDomainDetection = (ai: Pick<AiClient, 'generateStructured'>): DomainDetecting => domainDetection(ai);

/**
 * A job's approved rubric version for worker jobs (AIV-P1-072: grading repository skill signals), in the consumer's
 * workspace-scoped transaction. No session: the worker acts for the workspace whose message it handles.
 */
export const createApprovedRubricReads = (): ApprovedRubricReads => ({ approvedRubric });
