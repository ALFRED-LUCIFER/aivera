import type { Tx } from '@credalent/db/client';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { FileRecord, FileStore } from '../application/files.ts';
import type { Owner } from '../domain/files.ts';
import { file } from './schema.ts';

const ownedBy = (owner: Owner) =>
  'workspaceId' in owner
    ? eq(file.workspaceId, owner.workspaceId)
    : eq(file.candidateAccountId, owner.candidateAccountId);

/** The file store over an owner-scoped transaction: the owner filter here, row-level security underneath (ADR-005). */
export function fileStore(tx: Tx): FileStore {
  return {
    insert: async (record) => void (await tx.insert(file).values(record)),
    async names(owner, ids) {
      if (!ids.length) return new Map();
      const rows = await tx
        .select({ id: file.id, fileName: file.fileName })
        .from(file)
        .where(and(ownedBy(owner), inArray(file.id, ids), isNotNull(file.fileName)));
      return new Map(rows.flatMap((r) => (r.fileName ? [[r.id, r.fileName] as const] : [])));
    },
    async find(owner, id, forUpdate = false) {
      const query = tx
        .select()
        .from(file)
        .where(and(ownedBy(owner), eq(file.id, id)));
      const [found] = await (forUpdate ? query.for('update') : query);
      return (found as FileRecord | undefined) ?? null;
    },
    settle: async (owner, id, change) =>
      void (await tx
        .update(file)
        .set(change)
        .where(and(ownedBy(owner), eq(file.id, id)))),
  };
}
