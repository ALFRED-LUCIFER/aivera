import type { Tx } from '@credalent/db/client';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { RequestStore } from '../application/requests.ts';
import { portalToken, request, requestItem } from './schema.ts';

/**
 * The evidence request store over a workspace-scoped transaction. The `workspace_id` filter here is the first layer;
 * row-level security on the transaction's `app.workspace_id` is the second (ADR-005).
 */
export function requestStore(tx: Tx): RequestStore {
  return {
    async insert(row, items) {
      await tx.insert(request).values(row);
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
    async hasOpen(workspaceId, candidateId, jobId) {
      const [row] = await tx
        .select({ id: request.id })
        .from(request)
        .where(
          and(
            eq(request.workspaceId, workspaceId),
            eq(request.candidateId, candidateId),
            eq(request.jobId, jobId),
            ne(request.status, 'closed'),
          ),
        )
        .limit(1);
      return row !== undefined;
    },
    async setStatus(workspaceId, requestId, status, sentAt) {
      await tx
        .update(request)
        .set(sentAt ? { status, sentAt } : { status })
        .where(and(eq(request.workspaceId, workspaceId), eq(request.id, requestId)));
    },
    async insertToken(workspaceId, requestId, tokenHash, expiresAt, createdAt) {
      await tx.insert(portalToken).values({ workspaceId, requestId, tokenHash, expiresAt, createdAt });
    },
  };
}
