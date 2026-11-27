// Builds the decisions module for an app (ADR-002: only apps and test suites import this).
import {
  AiUnavailable,
  BudgetExceeded,
  InvalidCitation,
  MissingIdentifiers,
  SchemaMismatch,
  SourceTooLong,
  summariseMemberRequest,
  UncitedOutput,
  type AiClient,
} from '@credalent/ai';
import type { AssessmentContract } from '@credalent/assessment';
import type { AuditContract } from '@credalent/audit';
import type { Tx } from '@credalent/db';
import type { Handler, Scheduler } from '@credalent/db/consumer';
import { enqueue, newEnvelope } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import type { JobsContract } from '@credalent/jobs';
import { log } from '@credalent/observability';
import type { WorkspacesContract } from '@credalent/workspaces';
import { packUseCases } from './application/packs.ts';
import { summarisePack, type SummaryPorts } from './application/summaries.ts';
import { DecisionsRecordedV1, PackMembersAddedV1, PackReadyV1, type DecisionsContract } from './contracts/index.ts';
import { packStore } from './infrastructure/repository.ts';
import { inbox, outbox } from './infrastructure/schema.ts';

// shortcut: the pack summaries share the `assessment` queue, which every environment already has and consumes, so the
// pilot needs no infrastructure change (as the meeting-summary analysis does); give decisions its own queue
// (infra/modules/messaging.bicep) with the first consumer of DecisionsRecorded.v1.
export const PACK_SUMMARY_QUEUE = 'assessment';

/** `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one. */
export function createDecisions(
  workspaces: Pick<WorkspacesContract, 'authorize'>,
  jobs: Pick<JobsContract, 'getJob'>,
  assessment: Pick<AssessmentContract, 'listRanking' | 'getLatestAssessment'>,
  audit: Pick<AuditContract, 'record'>,
  now: () => Date = () => new Date(),
): DecisionsContract {
  return packUseCases({
    storeFor: packStore,
    publishPackReady: (tx, pack) =>
      enqueue(tx, outbox, PackReadyV1, {
        workspaceId: pack.workspaceId,
        payload: { packId: pack.id, jobId: pack.jobId },
        dedupeKey: `pack-ready:${pack.id}`,
        occurredAt: pack.preparedAt,
      }),
    publishMembersAdded: (tx, pack, position, at) =>
      enqueue(tx, outbox, PackMembersAddedV1, {
        workspaceId: pack.workspaceId,
        payload: { packId: pack.id, jobId: pack.jobId },
        // A pack's positions only grow, so each add has its own first position.
        dedupeKey: `pack-members-added:${pack.id}:${position}`,
        occurredAt: at,
      }),
    publishDecisionsRecorded: (tx, pack, at) =>
      enqueue(tx, outbox, DecisionsRecordedV1, {
        workspaceId: pack.workspaceId,
        payload: { packId: pack.id, jobId: pack.jobId },
        dedupeKey: `decisions-recorded:${pack.id}`,
        occurredAt: at,
      }),
    authorize: (ctx, action, resource) => workspaces.authorize(ctx, action, resource),
    job: async (ctx, jobId) => {
      const job = await jobs.getJob(ctx, jobId);
      return job && { jobId: job.id, clientId: job.clientId, hiringOwnerUserId: job.hiringOwnerUserId };
    },
    ranking: async (ctx, jobId) => {
      const ranking = await assessment.listRanking(ctx, jobId);
      return ranking.status === 'ranked'
        ? { rubricVersionId: ranking.rubricVersionId, candidateIds: ranking.rows.map((r) => r.candidateId) }
        : null;
    },
    latestAssessment: (ctx, candidateId, jobId) => assessment.getLatestAssessment(ctx, candidateId, jobId),
    auditDecision: (ctx, jobId, d) =>
      audit.record(
        { tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: d.decidedBy } },
        {
          action: 'decision.recorded',
          subject: { type: 'candidate', id: d.candidateId },
          note: d.note,
          after: { packId: d.packId, jobId, decision: d.decision },
        },
      ),
    auditPackCreated: (ctx, pack) =>
      audit.record(
        { tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: ctx.userId } },
        {
          action: 'pack.created',
          subject: { type: 'pack', id: pack.id },
          after: { jobId: pack.jobId, rubricVersionId: pack.rubricVersionId },
        },
      ),
    auditMemberAdded: (ctx, jobId, m) =>
      audit.record(
        { tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: ctx.userId } },
        {
          action: 'pack.member_added',
          subject: { type: 'candidate', id: m.candidateId },
          after: { packId: m.packId, jobId, assessmentId: m.assessmentId, position: m.position },
        },
      ),
    newId: () => uuidv7(),
    now,
  });
}

/**
 * A pack's recorded decisions as the system reads them, in a worker job's workspace-scoped transaction with no member:
 * intake's `DecisionsRecorded.v1` handler (AIV-P2-012), wired by the worker. Not authorised itself.
 */
export const readDecisionsAsSystem = (tx: Tx, workspaceId: string, packId: string) =>
  packStore(tx).listDecisions(workspaceId, packId);

// The answers a redelivery cannot change: the member is stored `unavailable` and the card shows the snapshot's own
// strengths. That includes a non-transient AiUnavailable (a 4xx such as Azure's content filter, an answer over the
// service's token cap, no AI service); a transient one (a timeout, an open circuit) is asked again.
const REJECTED = [SchemaMismatch, InvalidCitation, UncitedOutput, MissingIdentifiers, SourceTooLong, AiUnavailable];

type SummaryConfig = {
  ai: Pick<AiClient, 'generateStructured'> | undefined;
  approvedRubric: SummaryPorts['approvedRubric'];
  snapshot: SummaryPorts['snapshot'];
  evidence: SummaryPorts['evidence'];
  identifiersOf: SummaryPorts['identifiersOf'];
  scheduler: Scheduler;
  now?: () => Date;
};

/** The summary job's ports: how each model outcome is classed and how the pack is asked again (for its test). */
export function packSummaryPorts(config: SummaryConfig): SummaryPorts {
  const now = config.now ?? (() => new Date());
  return {
    storeFor: packStore,
    snapshot: config.snapshot,
    approvedRubric: config.approvedRubric,
    evidence: config.evidence,
    identifiersOf: config.identifiersOf,
    now,
    // shortcut: the model is called inside the consumer's transaction, member by member, as the meeting-summary job
    // does: a member's worst case is 2 schema x 3 transient attempts x 45 s plus backoff (about 4.5 min), held under
    // the message lock (1 min, renewed for about 5 min), so a large pack on a slow model can lose its lock and be
    // redelivered (each member is still written once). Store each member in its own transaction, or call the model
    // outside it, if pilot packs show redeliveries.
    async summarise({ workspaceId, sources, identifiers }) {
      if (!config.ai) return 'failed';
      const request = summariseMemberRequest(sources);
      try {
        const answer = await config.ai.generateStructured({ ...request, workspaceId, identifiers });
        return { promptVersion: request.promptVersion, answer };
      } catch (error) {
        if (error instanceof BudgetExceeded) return 'budget_exceeded';
        // The error's name only: never a source, the prompt or the answer (AGENTS.md 1.2).
        const logged = { 'workspace.id': workspaceId, 'error.type': (error as Error).name };
        if (error instanceof AiUnavailable && error.transient) {
          log.warn(logged, 'pack member not summarised: model unavailable, asked again later');
          return 'model_unavailable';
        }
        if (!REJECTED.some((kind) => error instanceof kind)) throw error;
        log.warn(logged, 'pack member not summarised');
        return 'failed';
      }
    },
    retryAt: async (workspaceId, payload, at) => {
      await config.scheduler.schedule(
        PACK_SUMMARY_QUEUE,
        newEnvelope(PackReadyV1, { workspaceId, payload, occurredAt: now() }),
        at,
      );
      log.info({ 'workspace.id': workspaceId }, 'pack summaries rescheduled');
    },
  };
}

/**
 * The worker's job `decisions.pack.summarise` (AIV-P2-011), on `PACK_SUMMARY_QUEUE`: after `PackReady.v1` or
 * `PackMembersAdded.v1` it writes each new member's cited strengths, risks, Round 1 finding and recommendation through
 * `decisions.summariseMember`, in the envelope's workspace transaction, once per message id (`decisions.inbox`) and
 * once per member. `ai` undefined (no model configured) stores every member `unavailable`. A spent daily AI budget
 * schedules `PackReady.v1` again for 00:05 UTC the next day, and a transient outage 15 minutes later, for up to 6 hours
 * after the member joined. The reads come from the worker's composition root.
 */
export function createPackSummaryHandlers(config: SummaryConfig): Handler<unknown>[] {
  const ports = packSummaryPorts(config);
  const handler = (event: typeof PackReadyV1 | typeof PackMembersAddedV1, consumer: string) =>
    ({
      event,
      inbox,
      consumer,
      handle: (tx, { packId }, envelope) => summarisePack(ports, tx, envelope.workspaceId, packId),
    }) satisfies Handler<{ packId: string; jobId: string }>;
  return [
    handler(PackReadyV1, 'decisions.pack.summarise'),
    handler(PackMembersAddedV1, 'decisions.pack.summarise-added'),
  ];
}
