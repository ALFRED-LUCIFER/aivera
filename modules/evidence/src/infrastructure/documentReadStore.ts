import type { Tx } from '@credalent/db/client';
import { and, eq, inArray } from 'drizzle-orm';
import type { DocumentReadStore } from '../application/documentRead.ts';
import { documentRead, source } from './schema.ts';

/** Document reads over a workspace-scoped transaction: the workspace filter here, row-level security below it. */
export function documentReadStore(tx: Tx): DocumentReadStore {
  return {
    async insert(read) {
      await tx.insert(documentRead).values(read);
    },
    async find(workspaceId, sourceId) {
      const [row] = await tx
        .select({ read: documentRead, source })
        .from(documentRead)
        .innerJoin(source, and(eq(source.workspaceId, documentRead.workspaceId), eq(source.id, documentRead.sourceId)))
        .where(and(eq(documentRead.workspaceId, workspaceId), eq(documentRead.sourceId, sourceId)));
      return row ?? null;
    },
    async pendingForFile(workspaceId, fileId) {
      const rows = await tx
        .select({ sourceId: documentRead.sourceId })
        .from(documentRead)
        .innerJoin(source, and(eq(source.workspaceId, documentRead.workspaceId), eq(source.id, documentRead.sourceId)))
        .where(
          and(
            eq(documentRead.workspaceId, workspaceId),
            eq(source.blobFileId, fileId),
            inArray(documentRead.status, ['pending', 'failed']),
          ),
        );
      return rows.map((r) => r.sourceId);
    },
    async finish(workspaceId, sourceId, status) {
      const updated = await tx
        .update(documentRead)
        .set({ status })
        .where(
          and(
            eq(documentRead.workspaceId, workspaceId),
            eq(documentRead.sourceId, sourceId),
            inArray(documentRead.status, ['pending', 'failed']),
          ),
        )
        .returning({ sourceId: documentRead.sourceId });
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
