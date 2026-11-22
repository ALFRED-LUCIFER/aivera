import type { Tx } from '@credalent/db/client';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { CvParseStore } from '../application/cvParse.ts';
import { cvParse, item, source, sourceNote } from './schema.ts';

/** CV parses over a workspace-scoped transaction: the workspace filter here, row-level security below it. */
export function cvParseStore(tx: Tx): CvParseStore {
  return {
    async insertOrGet(src) {
      const fileId = src.blobFileId;
      // A null file id never conflicts (nulls are distinct), so it would bypass the one-source-per-file guard.
      if (!fileId) throw new Error('a cv source needs its file id');
      // ON CONFLICT waits for a concurrent insert of the same candidate and file, so two deliveries at once keep one.
      const [inserted] = await tx
        .insert(source)
        .values(src)
        .onConflictDoNothing({
          target: [source.workspaceId, source.candidateId, source.blobFileId],
          where: sql`${source.kind} = 'cv'`,
        })
        .returning({ id: source.id });
      if (inserted) {
        const { workspaceId, id: sourceId, candidateId } = src;
        await tx.insert(cvParse).values({ workspaceId, sourceId, candidateId, status: 'pending' });
        return null;
      }
      const [existing] = await tx
        .select({ id: source.id })
        .from(source)
        .where(
          and(
            eq(source.workspaceId, src.workspaceId),
            eq(source.candidateId, src.candidateId),
            eq(source.kind, 'cv'),
            eq(source.blobFileId, fileId),
          ),
        );
      if (!existing) throw new Error('cv source conflict but no cv source for this candidate and file');
      return existing.id;
    },
    async find(workspaceId, sourceId) {
      const [row] = await tx
        .select({ parse: cvParse, source })
        .from(cvParse)
        .innerJoin(source, and(eq(source.workspaceId, cvParse.workspaceId), eq(source.id, cvParse.sourceId)))
        .where(and(eq(cvParse.workspaceId, workspaceId), eq(cvParse.sourceId, sourceId)));
      return row ?? null;
    },
    async pendingForFile(workspaceId, fileId) {
      const rows = await tx
        .select({ sourceId: cvParse.sourceId })
        .from(cvParse)
        .innerJoin(source, and(eq(source.workspaceId, cvParse.workspaceId), eq(source.id, cvParse.sourceId)))
        .where(
          and(
            eq(cvParse.workspaceId, workspaceId),
            eq(source.blobFileId, fileId),
            inArray(cvParse.status, ['pending', 'failed']),
          ),
        );
      return rows.map((r) => r.sourceId);
    },
    async finish(workspaceId, sourceId, status) {
      const updated = await tx
        .update(cvParse)
        .set({ status })
        .where(
          and(
            eq(cvParse.workspaceId, workspaceId),
            eq(cvParse.sourceId, sourceId),
            inArray(cvParse.status, ['pending', 'waiting', 'failed']),
          ),
        )
        .returning({ sourceId: cvParse.sourceId });
      return updated.length > 0;
    },
    async insertItems(items, notes) {
      if (items.length) await tx.insert(item).values(items);
      if (notes.length) await tx.insert(sourceNote).values(notes);
    },
    // Ids are UUIDv7, made in CV order in one parse, so they order the notes.
    notes: (workspaceId, sourceId) =>
      tx
        .select()
        .from(sourceNote)
        .where(and(eq(sourceNote.workspaceId, workspaceId), eq(sourceNote.sourceId, sourceId)))
        .orderBy(asc(sourceNote.id)),
  };
}
