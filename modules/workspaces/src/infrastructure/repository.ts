import type { AuditContract } from '@aivera/audit';
import type { Tx } from '@aivera/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { ActiveWorkspaces } from '../application/context.ts';
import type { WorkspaceStore } from '../application/workspaces.ts';
import { activeWorkspace, member, workspace } from './schema.ts';

const memberColumns = {
  userId: member.userId,
  workspaceId: member.workspaceId,
  role: member.role,
  status: member.status,
};

const inWorkspace = (workspaceId: string) => eq(member.workspaceId, workspaceId);

/**
 * The workspaces store over a workspace-scoped transaction. The `workspace_id` filter here is the first layer;
 * row-level security on the transaction's `app.workspace_id` is the second (ADR-005).
 */
export function workspaceStore(tx: Tx, audit: AuditContract): WorkspaceStore {
  return {
    async insertWorkspace(values) {
      const [row] = await tx.insert(workspace).values(values).returning();
      if (!row) throw new Error('insert into workspaces.workspace returned no row');
      return row;
    },
    async findWorkspace(workspaceId) {
      const [row] = await tx.select().from(workspace).where(eq(workspace.id, workspaceId));
      return row ?? null;
    },
    setActiveWorkspace: (userId, workspaceId) => activeWorkspaceStore(tx).set(userId, workspaceId),
    async insertMember(values) {
      await tx.insert(member).values(values);
    },
    async findMember(workspaceId, userId) {
      const [row] = await tx
        .select(memberColumns)
        .from(member)
        .where(and(inWorkspace(workspaceId), eq(member.userId, userId)));
      return row ?? null;
    },
    listMembers: (workspaceId) =>
      tx.select(memberColumns).from(member).where(inWorkspace(workspaceId)).orderBy(asc(member.createdAt)),
    lockMembers: (workspaceId) =>
      tx
        .select(memberColumns)
        .from(member)
        .where(inWorkspace(workspaceId))
        .orderBy(asc(member.userId)) // a stable lock order, so concurrent changes cannot deadlock
        .for('update'),
    async updateRole(workspaceId, userId, role) {
      await tx
        .update(member)
        .set({ role })
        .where(and(inWorkspace(workspaceId), eq(member.userId, userId)));
    },
    async audit(workspaceId, actorUserId, values) {
      await audit.record({ tx, workspaceId, actor: { type: 'user', id: actorUserId } }, values);
    },
  };
}

/** The active-workspace pointer, by user id only (it is not workspace-owned; see the schema). */
export function activeWorkspaceStore(tx: Tx): ActiveWorkspaces {
  return {
    async get(userId) {
      const [row] = await tx
        .select({ workspaceId: activeWorkspace.workspaceId })
        .from(activeWorkspace)
        .where(eq(activeWorkspace.userId, userId));
      return row?.workspaceId ?? null;
    },
    async set(userId, workspaceId) {
      await tx
        .insert(activeWorkspace)
        .values({ userId, workspaceId })
        .onConflictDoUpdate({ target: activeWorkspace.userId, set: { workspaceId, updatedAt: sql`now()` } });
    },
  };
}
