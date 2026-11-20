import { DbQueryError, type Tx } from '@credalent/db/client';
import { and, asc, eq } from 'drizzle-orm';
import { EvidenceError } from '../domain/evidence.ts';
import type { RequestStore } from '../application/requests.ts';
import { portalToken, request, requestItem } from './schema.ts';

/**
 * The evidence request store over a workspace-scoped transaction. The `workspace_id` filter here is the first layer;
 * row-level security on the transaction's `app.workspace_id` is the second (ADR-005).
 */
export function requestStore(tx: Tx): RequestStore {
  return {
    async insert(row, items) {
      // The partial unique index keeps one open request per candidate and job, even when two drafts race.
      await tx
        .insert(request)
        .values(row)
        .catch((error: unknown) => {
          if (error instanceof DbQueryError && error.constraint === 'request_open_key')
            throw new EvidenceError('open_request');
          throw error;
        });
      await tx
        .insert(requestItem)
        .values(items.map((i) => ({ ...i, workspaceId: row.workspaceId, requestId: row.id })));
    },
    async get(workspaceId, requestId) {
      const [row] = await tx
        .select()
        .from(request)
        .where(and(eq(request.workspaceId, workspaceId), eq(request.id, requestId)));
      if (!row) return null;
      const items = await tx
        .select({ competencyId: requestItem.competencyId, itemId: requestItem.itemId, claim: requestItem.claim })
        .from(requestItem)
        .where(and(eq(requestItem.workspaceId, workspaceId), eq(requestItem.requestId, requestId)))
        .orderBy(asc(requestItem.competencyId));
      return { ...row, items };
    },
    async setStatus(workspaceId, requestId, from, to, sentAt) {
      // Compare-and-set: the move applies only if the status is still `from`, so racing moves cannot skip the table.
      const changed = await tx
        .update(request)
        .set(sentAt ? { status: to, sentAt } : { status: to })
        .where(and(eq(request.workspaceId, workspaceId), eq(request.id, requestId), eq(request.status, from)))
        .returning({ id: request.id });
      return changed.length === 1;
    },
    async insertToken(workspaceId, requestId, tokenHash, expiresAt, createdAt) {
      await tx.insert(portalToken).values({ workspaceId, requestId, tokenHash, expiresAt, createdAt });
    },
  };
}
