// Builds the evidence module for an app (ADR-002: only apps import this).
import { createHash } from 'node:crypto';
import type { AuditContract } from '@credalent/audit';
import { enqueue } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import { log } from '@credalent/observability';
import type { WorkspacesContract } from '@credalent/workspaces';
import { evidenceUseCases } from './application/evidence.ts';
import { EvidenceRecordedV1, type EvidenceContract } from './contracts/index.ts';
import { evidenceStore } from './infrastructure/repository.ts';
import { outbox } from './infrastructure/schema.ts';

/**
 * Every call runs in the request's `withWorkspace` transaction (`ctx.tx`), so no pool is needed here.
 * `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one.
 */
export function createEvidence(
  workspaces: Pick<WorkspacesContract, 'authorize' | 'getWorkspace'>,
  audit: Pick<AuditContract, 'record'>,
  now: () => Date = () => new Date(),
): EvidenceContract {
  return evidenceUseCases({
    storeFor: evidenceStore,
    publishRecorded: (tx, source, itemIds) =>
      enqueue(tx, outbox, EvidenceRecordedV1, {
        workspaceId: source.workspaceId,
        payload: { candidateId: source.candidateId, sourceId: source.id, itemIds },
        dedupeKey: `source:${source.id}`,
        occurredAt: source.createdAt,
      }),
    authorize: (ctx, action) => workspaces.authorize(ctx, action),
    isSyntheticWorkspace: async (ctx) => (await workspaces.getWorkspace(ctx))?.synthetic === true,
    audit: (ctx, entry) =>
      audit.record({ tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: ctx.userId } }, entry),
    logFlagged: ({ similarity, ...ids }) =>
      log.info({ ...ids, 'credalent.evidence.similarity': similarity }, 'evidence near-duplicate flagged'),
    sha1: (input) => createHash('sha1').update(input).digest(),
    newId: () => uuidv7(),
    now,
  });
}
