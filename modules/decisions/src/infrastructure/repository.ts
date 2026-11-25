import type { Tx } from '@credalent/db/client';
import { and, asc, eq } from 'drizzle-orm';
import type { PackStore } from '../application/packs.ts';
import { decision, pack, packMember } from './schema.ts';

/**
 * The decisions store over a workspace-scoped transaction. The `workspace_id` filter here is the first layer;
 * row-level security on the transaction's `app.workspace_id` is the second (ADR-005).
 * shortcut: nothing deletes here (the app role cannot delete a member or a decision), so a pack's rows, the scores and
 * the decision note among them, outlive a candidate's erasure; AIV-P3-014 (delete my data) adds the erasure path.
 */
export function packStore(tx: Tx): PackStore {
  return {
    async insertPack(values) {
      await tx.insert(pack).values(values);
    },
    async findPack(workspaceId, packId, lock = false) {
      const query = tx
        .select()
        .from(pack)
        .where(and(eq(pack.workspaceId, workspaceId), eq(pack.id, packId)));
      const [row] = await (lock ? query.for('update') : query);
      return row ?? null;
    },
    async setStatus(workspaceId, packId, status) {
      await tx
        .update(pack)
        .set({ status })
        .where(and(eq(pack.workspaceId, workspaceId), eq(pack.id, packId)));
    },
    async insertMembers(members) {
      await tx.insert(packMember).values(members);
    },
    listMembers(workspaceId, packId) {
      return tx
        .select()
        .from(packMember)
        .where(and(eq(packMember.workspaceId, workspaceId), eq(packMember.packId, packId)))
        .orderBy(asc(packMember.position));
    },
    async insertDecisions(decisions) {
      await tx.insert(decision).values(decisions);
    },
    listDecisions(workspaceId, packId) {
      return tx
        .select()
        .from(decision)
        .where(and(eq(decision.workspaceId, workspaceId), eq(decision.packId, packId)))
        .orderBy(asc(decision.candidateId));
    },
  };
}
