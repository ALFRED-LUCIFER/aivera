// Builds the evidence module for an app (ADR-002: only apps import this).
import { createHash } from 'node:crypto';
import type { AuditContract } from '@credalent/audit';
import type { Handler, Scheduler } from '@credalent/db/consumer';
import { enqueue, newEnvelope } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import { log } from '@credalent/observability';
import type { WorkspacesContract } from '@credalent/workspaces';
import { evidenceUseCases, type Ports } from './application/evidence.ts';
import { GitHubRateLimited, readRepository, repositoryReadUseCases } from './application/repositoryRead.ts';
import { EvidenceRecordedV1, RepositoryReadRequestedV1, type EvidenceContract } from './contracts/index.ts';
import { createGitHub, type GitHubConfig } from './infrastructure/github.ts';
import { evidenceStore } from './infrastructure/repository.ts';
import { repositoryReadStore } from './infrastructure/repositoryReadStore.ts';
import { inbox, outbox } from './infrastructure/schema.ts';

export type { GitHubConfig } from './infrastructure/github.ts';

/** The queue RepositoryReadRequested.v1 goes to (infra/modules/messaging.bicep). */
export const EVIDENCE_QUEUE = 'evidence';

const publishRecorded: Ports['publishRecorded'] = (tx, source, itemIds) =>
  enqueue(tx, outbox, EvidenceRecordedV1, {
    workspaceId: source.workspaceId,
    payload: { candidateId: source.candidateId, sourceId: source.id, itemIds },
    dedupeKey: `source:${source.id}`,
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
    authorize: (ctx, action) => workspaces.authorize(ctx, action),
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
      publishReadRequested: (tx, source) =>
        enqueue(tx, outbox, RepositoryReadRequestedV1, {
          workspaceId: source.workspaceId,
          payload: { candidateId: source.candidateId, sourceId: source.id },
          dedupeKey: `repository-read:${source.id}`,
          occurredAt: source.createdAt,
        }),
    }),
  };
}

/**
 * The worker job `evidence.repository.read` on the evidence queue. When GitHub's rate limit is spent, the same request
 * is scheduled on Service Bus for just after `x-ratelimit-reset` and this delivery completes, so the source simply
 * stays pending (no error reaches the recruiter).
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
      try {
        await readRepository(
          { readStoreFor: repositoryReadStore, publishRecorded, newId: uuidv7, now, github },
          tx,
          envelope.workspaceId,
          payload.sourceId,
        );
      } catch (error) {
        if (!(error instanceof GitHubRateLimited)) throw error;
        const next = newEnvelope(RepositoryReadRequestedV1, {
          workspaceId: envelope.workspaceId,
          payload,
          occurredAt: now(),
        });
        await config.scheduler.schedule(EVIDENCE_QUEUE, next, new Date(error.resetAt.getTime() + 1000));
        log.info({ 'outbox.event_id': envelope.id }, 'github read rescheduled after its rate limit');
      }
    },
  };
}
