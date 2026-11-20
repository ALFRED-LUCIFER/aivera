// Builds the evidence module for an app (ADR-002: only apps import this).
import { enqueue } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
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
    newId: () => uuidv7(),
    now,
  });
}
