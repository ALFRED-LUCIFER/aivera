import type { Tx } from '@credalent/db/client';
import { and, eq, inArray } from 'drizzle-orm';
import type { LinkReadStore } from '../application/linkRead.ts';
import { linkRead, source } from './schema.ts';

/** Link reads over a workspace-scoped transaction: the workspace filter here, row-level security below it. */
export function linkReadStore(tx: Tx): LinkReadStore {
  return {
    async insertOrGet(src, read) {
      await tx.insert(source).values(src);
      // ON CONFLICT waits for a concurrent insert of the same candidate and URL, so two requests at once keep one read.
      const [inserted] = await tx
        .insert(linkRead)
        .values(read)
        .onConflictDoNothing({ target: [linkRead.workspaceId, linkRead.candidateId, linkRead.url] })
        .returning({ sourceId: linkRead.sourceId });
      if (inserted) return null;
      await tx.delete(source).where(and(eq(source.workspaceId, src.workspaceId), eq(source.id, src.id)));
      const [existing] = await tx
        .select({ sourceId: linkRead.sourceId })
        .from(linkRead)
        .where(
          and(
            eq(linkRead.workspaceId, read.workspaceId),
            eq(linkRead.candidateId, read.candidateId),
            eq(linkRead.url, read.url),
          ),
        );
      if (!existing) throw new Error('link read conflict but no read for this candidate and URL');
      return existing.sourceId;
    },
    async find(workspaceId, sourceId) {
      const [row] = await tx
        .select({ read: linkRead, source })
        .from(linkRead)
        .innerJoin(source, and(eq(source.workspaceId, linkRead.workspaceId), eq(source.id, linkRead.sourceId)))
        .where(and(eq(linkRead.workspaceId, workspaceId), eq(linkRead.sourceId, sourceId)));
      return row ?? null;
    },
    async finish(workspaceId, sourceId, status, title = null) {
      const updated = await tx
        .update(linkRead)
        .set({ status, title })
        .where(
          and(
            eq(linkRead.workspaceId, workspaceId),
            eq(linkRead.sourceId, sourceId),
            inArray(linkRead.status, ['pending', 'failed']),
          ),
        )
        .returning({ sourceId: linkRead.sourceId });
      return updated.length > 0;
    },
    async setFingerprint(workspaceId, sourceId, textFingerprint) {
      await tx
        .update(source)
        .set({ textFingerprint })
        .where(and(eq(source.workspaceId, workspaceId), eq(source.id, sourceId)));
    },
  };
}
