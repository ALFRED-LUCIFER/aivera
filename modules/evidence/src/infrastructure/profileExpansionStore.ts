import type { Tx } from '@credalent/db/client';
import { and, count, eq } from 'drizzle-orm';
import type { ProfileExpansionStore } from '../application/profileExpansion.ts';
import { profileExpansion, repositoryRead } from './schema.ts';

/** Profile expansions over a workspace-scoped transaction: the workspace filter here, row-level security below it. */
export function profileExpansionStore(tx: Tx): ProfileExpansionStore {
  return {
    async insertIfNew(expansion) {
      const inserted = await tx
        .insert(profileExpansion)
        .values(expansion)
        .onConflictDoNothing({
          target: [profileExpansion.workspaceId, profileExpansion.candidateId, profileExpansion.login],
        })
        .returning({ id: profileExpansion.id });
      return inserted.length > 0;
    },
    async find(workspaceId, id) {
      const [row] = await tx
        .select()
        .from(profileExpansion)
        .where(and(eq(profileExpansion.workspaceId, workspaceId), eq(profileExpansion.id, id)));
      return row ?? null;
    },
    async settle(workspaceId, id, status, queued) {
      const settled = await tx
        .update(profileExpansion)
        .set({ status, queued })
        .where(
          and(
            eq(profileExpansion.workspaceId, workspaceId),
            eq(profileExpansion.id, id),
            eq(profileExpansion.status, 'pending'),
          ),
        )
        .returning({ id: profileExpansion.id });
      return settled.length > 0;
    },
    async profileReads(workspaceId, candidateId) {
      const [row] = await tx
        .select({ n: count() })
        .from(repositoryRead)
        .where(
          and(
            eq(repositoryRead.workspaceId, workspaceId),
            eq(repositoryRead.candidateId, candidateId),
            eq(repositoryRead.via, 'cv_profile'),
          ),
        );
      return row?.n ?? 0;
    },
  };
}
