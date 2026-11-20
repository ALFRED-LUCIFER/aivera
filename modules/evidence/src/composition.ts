// Builds the evidence module for an app (ADR-002: only apps import this).
import { createHash, randomBytes } from 'node:crypto';
import { MAP_TO_COMPETENCY_VERSION, mapToCompetencyRequest, modelOf, type AiClient } from '@credalent/ai';
import type { AuditContract } from '@credalent/audit';
import type { Handler, Scheduler } from '@credalent/db/consumer';
import type { Tx } from '@credalent/db';
import { enqueue, newEnvelope, type Envelope, type EventDefinition } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import { ApplicationReceivedV1 } from '@credalent/intake';
import { RubricApprovedV1 } from '@credalent/jobs';
import { log } from '@credalent/observability';
import type { WorkspacesContract } from '@credalent/workspaces';
import { evidenceUseCases, type Ports } from './application/evidence.ts';
import { mapEvidence, mappingUseCases, type MappingPorts } from './application/mapping.ts';
import {
  type ApprovedRubricPort,
  GitHubRateLimited,
  queueArrivalReads,
  readRepository,
  refreshStaleRepositorySources,
  repositoryReadUseCases,
  type ArrivalPorts,
  type RepositoryPorts,
} from './application/repositoryRead.ts';
import {
  recordRequestOutcome,
  requestUseCases,
  type OutcomePorts,
  type RequestOutcome,
} from './application/requests.ts';
import {
  EvidenceMappedV1,
  EvidenceMappingRequestedV1,
  EvidenceRecordedV1,
  EvidenceRequestAnsweredV1,
  EvidenceRequestOpenedV1,
  EvidenceRequestQuietV1,
  EvidenceRequestSentV1,
  RepositoryReadRequestedV1,
  RepositoryRefreshRequestedV1,
  type EvidenceContract,
} from './contracts/index.ts';
import { createGitHub, type GitHubConfig } from './infrastructure/github.ts';
import { mappingStore } from './infrastructure/mappingStore.ts';
import { evidenceStore } from './infrastructure/repository.ts';
import { repositoryReadStore } from './infrastructure/repositoryReadStore.ts';
import { requestStore } from './infrastructure/requestStore.ts';
import { inbox, outbox } from './infrastructure/schema.ts';

/** The queue RepositoryReadRequested.v1 and RepositoryRefreshRequested.v1 go to (infra/modules/messaging.bicep). */
export const EVIDENCE_QUEUE = 'evidence';

const publishReadRequested: RepositoryPorts['publishReadRequested'] = (tx, source) =>
  enqueue(tx, outbox, RepositoryReadRequestedV1, {
    workspaceId: source.workspaceId,
    payload: { candidateId: source.candidateId, sourceId: source.id },
    dedupeKey: `repository-read:${source.id}`,
    occurredAt: source.createdAt,
  });

const publishRecorded: Ports['publishRecorded'] = (tx, source, itemIds, dedupeKey = `source:${source.id}`) =>
  enqueue(tx, outbox, EvidenceRecordedV1, {
    workspaceId: source.workspaceId,
    payload: { candidateId: source.candidateId, sourceId: source.id, itemIds },
    dedupeKey,
    occurredAt: source.createdAt,
  });

/**
 * Every call runs in the request's `withWorkspace` transaction (`ctx.tx`), so no pool is needed here.
 * `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one.
 */
export function createEvidence(
  workspaces: Pick<WorkspacesContract, 'authorize' | 'getWorkspace'>,
  audit: Pick<AuditContract, 'record'>,
  now: () => Date = () => new Date(),
): EvidenceContract {
  const ports: Ports = {
    storeFor: evidenceStore,
    publishRecorded,
    authorize: (ctx, action, resource) => workspaces.authorize(ctx, action, resource),
    isSyntheticWorkspace: async (ctx) => (await workspaces.getWorkspace(ctx))?.synthetic === true,
    audit: (ctx, entry) =>
      audit.record({ tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: ctx.userId } }, entry),
    logFlagged: ({ similarity, ...ids }) =>
      log.info({ ...ids, 'credalent.evidence.similarity': similarity }, 'evidence near-duplicate flagged'),
    sha1: (input) => createHash('sha1').update(input).digest(),
    newId: () => uuidv7(),
    now,
  };
  return {
    ...evidenceUseCases(ports),
    ...repositoryReadUseCases({
      ...ports,
      readStoreFor: repositoryReadStore,
      publishReadRequested,
      publishRefreshRequested: (tx, { workspaceId, candidateId, jobId, at }) =>
        enqueue(tx, outbox, RepositoryRefreshRequestedV1, {
          workspaceId,
          payload: { candidateId, jobId },
          // Every request is its own: a refresh is idempotent, and a later one must not be dropped as a duplicate.
          dedupeKey: `repository-refresh:${uuidv7()}`,
          occurredAt: at,
        }),
    }),
    ...mappingUseCases({ ...ports, mappingStoreFor: mappingStore }),
    ...requestUseCases({
      ...ports,
      ...outcomePorts(now),
      newToken: () => {
        const token = randomBytes(32).toString('base64url');
        return { token, hash: createHash('sha256').update(token).digest('hex') };
      },
    }),
  };
}

const outcomePorts = (now: () => Date): OutcomePorts => ({
  requestStoreFor: requestStore,
  publishRequestEvent: (tx, request, status) =>
    enqueue(tx, outbox, REQUEST_EVENTS[status], {
      workspaceId: request.workspaceId,
      payload: { requestId: request.id, candidateId: request.candidateId, jobId: request.jobId },
      dedupeKey: `request:${request.id}:${status}`,
      occurredAt: now(),
    }),
});

/**
 * Records a request's outcome as the system, in a workspace-scoped transaction with no member: for the follow-up
 * worker (AIV-P1-040) and the portal (AIV-P1-041). It can never send.
 */
export function createRequestOutcomeRecorder(now: () => Date = () => new Date()) {
  const ports = outcomePorts(now);
  return (tx: Tx, workspaceId: string, requestId: string, outcome: RequestOutcome) =>
    recordRequestOutcome(ports, tx, workspaceId, requestId, outcome);
}

const REQUEST_EVENTS = {
  sent: EvidenceRequestSentV1,
  opened: EvidenceRequestOpenedV1,
  answered: EvidenceRequestAnsweredV1,
  quiet: EvidenceRequestQuietV1,
} as const;

/** The same request again on the evidence queue, for just after GitHub's rate limit resets. */
async function reschedule<P>(
  scheduler: Scheduler,
  event: EventDefinition<P>,
  envelope: Envelope,
  payload: P,
  resetAt: Date,
  now: () => Date,
) {
  const next = newEnvelope(event, { workspaceId: envelope.workspaceId, payload, occurredAt: now() });
  await scheduler.schedule(EVIDENCE_QUEUE, next, new Date(resetAt.getTime() + 1000));
  log.info({ 'outbox.event_id': envelope.id }, 'github read rescheduled after its rate limit');
}

/**
 * The worker job `evidence.repository.read` on the evidence queue. When GitHub's rate limit is spent, the same request
 * is scheduled on Service Bus for just after `x-ratelimit-reset` and this delivery completes: before anything is
 * written the source simply stays pending; when only the skill-signal file reads were cut short, the read is stored
 * with that coverage gap and the retry reads those files again. No error reaches the recruiter.
 */
export function createRepositoryReadHandler(config: {
  github: GitHubConfig;
  scheduler: Scheduler;
  now?: () => Date;
}): Handler<{ candidateId: string; sourceId: string }> {
  const now = config.now ?? (() => new Date());
  const github = createGitHub({ now, ...config.github });
  return {
    event: RepositoryReadRequestedV1,
    inbox,
    consumer: 'evidence.repository.read',
    async handle(tx, payload, envelope) {
      let retryAt: Date | null;
      try {
        ({ retryAt } = await readRepository(
          { readStoreFor: repositoryReadStore, publishRecorded, newId: uuidv7, now, github },
          tx,
          envelope.workspaceId,
          payload.sourceId,
        ));
      } catch (error) {
        if (!(error instanceof GitHubRateLimited)) throw error;
        retryAt = error.resetAt;
      }
      if (retryAt) await reschedule(config.scheduler, RepositoryReadRequestedV1, envelope, payload, retryAt, now);
    },
  };
}

/**
 * The worker job `evidence.repository.refresh-stale` on the evidence queue (AIV-P1-072): re-reads the candidate's stale
 * repository sources and grades them against the job's approved rubric version, which `approvedRubric` reads (the jobs
 * module's `createApprovedRubricReads`). A rate limit writes nothing and reschedules the request, as the read does.
 */
export function createRepositoryRefreshHandler(config: {
  github: GitHubConfig;
  scheduler: Scheduler;
  approvedRubric: ApprovedRubricPort;
  now?: () => Date;
}): Handler<{ candidateId: string; jobId: string }> {
  const now = config.now ?? (() => new Date());
  const github = createGitHub({ now, ...config.github });
  const ports = {
    readStoreFor: repositoryReadStore,
    publishRecorded,
    newId: uuidv7,
    now,
    github,
    approvedRubric: config.approvedRubric,
  };
  return {
    event: RepositoryRefreshRequestedV1,
    inbox,
    consumer: 'evidence.repository.refresh-stale',
    async handle(tx, payload, envelope) {
      try {
        // A savepoint, so a rate limit midway rolls back every re-read and grade before the request is rescheduled.
        await tx.transaction((sp) =>
          refreshStaleRepositorySources(ports, sp, envelope.workspaceId, payload.candidateId, payload.jobId),
        );
        log.info({ 'outbox.event_id': envelope.id }, 'repository sources refreshed');
      } catch (error) {
        if (!(error instanceof GitHubRateLimited)) throw error;
        await reschedule(config.scheduler, RepositoryRefreshRequestedV1, envelope, payload, error.resetAt, now);
      }
    },
  };
}

/**
 * The worker job `evidence.application.received` on the evidence queue (AIV-P1-076): queues one read per GitHub
 * repository link an arrival or a member's link brings, as the system in the envelope's workspace. The intake and
 * candidates reads come from the worker's composition root, so this module imports neither's internals.
 */
export function createApplicationReceivedHandler(
  config: Pick<ArrivalPorts, 'readArrival' | 'readPerson'> & { now?: () => Date },
): Handler<{ applicationId: string; sourceId: string }> {
  const ports: ArrivalPorts = {
    ...config,
    readStoreFor: repositoryReadStore,
    publishReadRequested,
    newId: uuidv7,
    now: config.now ?? (() => new Date()),
    logQueued: ({ queued, ...ids }) =>
      log.info(ids, queued ? 'repository read queued' : 'repository read already queued'),
  };
  return {
    event: ApplicationReceivedV1,
    inbox,
    consumer: 'evidence.application.received',
    handle: (tx, payload, envelope) => queueArrivalReads(ports, tx, envelope.workspaceId, payload.sourceId),
  };
}

/** Who applied to what, read in the worker's transaction (the intake module's `createApplicationReads`). */
export type ApplicationsPort = {
  jobsForCandidate(tx: Tx, workspaceId: string, candidateId: string): Promise<string[]>;
  candidatesForJob(tx: Tx, workspaceId: string, jobId: string): Promise<string[]>;
};

/**
 * The evidence mapping jobs on the evidence queue (AIV-P1-027): `EvidenceRecorded.v1` and `RubricApproved.v1` fan out
 * to one `EvidenceMappingRequested.v1` per candidate and job, and `evidence.mapping` maps each through `ai` against
 * the job's approved rubric version (`approvedRubric`, the jobs module's `createApprovedRubricReads`). A model failure
 * throws, so the consumer retries with back-off (AIV-P0-015) while the profile shows the assessment as in progress.
 */
export function createEvidenceMappingHandlers(config: {
  ai: AiClient;
  approvedRubric: MappingPorts['approvedRubric'];
  applications: ApplicationsPort;
  now?: () => Date;
}): Handler<unknown>[] {
  const now = config.now ?? (() => new Date());
  // shortcut: every EvidenceRecorded.v1 (a repository read emits one per source it records) maps each of the
  // candidate's jobs again, one model call each; coalesce per candidate and job if pilot token use or queue depth shows it.
  const requestMapping = (tx: Tx, envelope: Envelope, candidateId: string, jobId: string) =>
    enqueue(tx, outbox, EvidenceMappingRequestedV1, {
      workspaceId: envelope.workspaceId,
      payload: { candidateId, jobId },
      dedupeKey: `mapping:${envelope.id}:${candidateId}:${jobId}`,
      occurredAt: now(),
    });
  const ports: MappingPorts = {
    storeFor: evidenceStore,
    readStoreFor: repositoryReadStore,
    mappingStoreFor: mappingStore,
    approvedRubric: config.approvedRubric,
    mapToCompetencies: async (workspaceId, competencies, sources) => {
      const { links, changes } = await config.ai.generateStructured({
        ...mapToCompetencyRequest(competencies, sources),
        workspaceId,
      });
      return { links, changes };
    },
    promptVersion: MAP_TO_COMPETENCY_VERSION,
    model: modelOf('evidence.mapToCompetency'),
    publishMapped: (tx, run) =>
      enqueue(tx, outbox, EvidenceMappedV1, {
        workspaceId: run.workspaceId,
        payload: {
          candidateId: run.candidateId,
          jobId: run.jobId,
          rubricVersionId: run.rubricVersionId,
          mappingId: run.id,
        },
        dedupeKey: `mapped:${run.id}`,
        occurredAt: run.createdAt,
      }),
    logMapped: ({ discarded, ...counts }) =>
      log.info(
        {
          'credalent.evidence.mapping_id': counts.mappingId,
          'credalent.evidence.links': counts.links,
          'credalent.evidence.gaps': counts.gaps,
          'credalent.evidence.uncited_changes': counts.uncitedChanges,
          ...Object.fromEntries(Object.entries(discarded).map(([k, v]) => [`credalent.evidence.discarded.${k}`, v])),
        },
        'evidence mapped',
      ),
    newId: uuidv7,
    now,
  };
  return [
    {
      event: EvidenceRecordedV1,
      inbox,
      consumer: 'evidence.mapping.recorded',
      async handle(tx, { candidateId }, envelope) {
        for (const jobId of await config.applications.jobsForCandidate(tx, envelope.workspaceId, candidateId))
          await requestMapping(tx, envelope, candidateId, jobId);
      },
    } satisfies Handler<{ candidateId: string; sourceId: string; itemIds: string[] }>,
    {
      event: RubricApprovedV1,
      inbox,
      consumer: 'evidence.mapping.rubric-approved',
      async handle(tx, { jobId }, envelope) {
        for (const candidateId of await config.applications.candidatesForJob(tx, envelope.workspaceId, jobId))
          await requestMapping(tx, envelope, candidateId, jobId);
      },
    } satisfies Handler<{ jobId: string; rubricVersionId: string; supersededVersionId: string | null }>,
    {
      event: EvidenceMappingRequestedV1,
      inbox,
      consumer: 'evidence.mapping',
      async handle(tx, { candidateId, jobId }, envelope) {
        const run = await mapEvidence(ports, tx, envelope.workspaceId, candidateId, jobId);
        if (!run) log.info({ 'outbox.event_id': envelope.id }, 'evidence not mapped: the job has no approved rubric');
      },
    } satisfies Handler<{ candidateId: string; jobId: string }>,
  ];
}
