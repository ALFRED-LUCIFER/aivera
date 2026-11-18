import type { AuditContract } from '@aivera/audit';
import { DbQueryError, type Tx } from '@aivera/db/client';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import type { ActiveWorkspaces } from '../application/context.ts';
import type { WorkspaceStore } from '../application/workspaces.ts';
import { WorkspaceError } from '../domain/workspace.ts';
import { activeWorkspace, client, jobGrant, member, workspace } from './schema.ts';

const memberColumns = {
  userId: member.userId,
  workspaceId: member.workspaceId,
  role: member.role,
  status: member.status,
};

const inWorkspace = (workspaceId: string) => eq(member.workspaceId, workspaceId);

const clientColumns = { id: client.id, name: client.name, archivedAt: client.archivedAt };
const grantColumns = {
  id: jobGrant.id,
  userId: jobGrant.userId,
  jobId: jobGrant.jobId,
  clientId: jobGrant.clientId,
  grantedBy: jobGrant.grantedBy,
  grantedAt: jobGrant.grantedAt,
};

/** The unique name index refuses a duplicate in any case; anything else is rethrown. */
const nameTaken = (error: unknown): never => {
  if (error instanceof DbQueryError && error.constraint === 'client_workspace_name_idx')
    throw new WorkspaceError('client_exists');
  throw error;
};

/** A PostgreSQL array literal of uuids read back from the database, for `current_setting(...)::uuid[]`. */
const uuidArray = (ids: (string | null)[]) => `{${ids.filter((id) => id !== null).join(',')}}`;

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
    async lockWorkspace(workspaceId) {
      const [row] = await tx.select().from(workspace).where(eq(workspace.id, workspaceId)).for('update');
      return row ?? null;
    },
    async updateType(workspaceId, type) {
      await tx.update(workspace).set({ type }).where(eq(workspace.id, workspaceId));
    },
    async countClients(workspaceId) {
      const [row] = await tx
        .select({ n: count() })
        .from(client)
        .where(and(eq(client.workspaceId, workspaceId), isNull(client.archivedAt)));
      return row?.n ?? 0;
    },
    listClients: (workspaceId) =>
      tx.select(clientColumns).from(client).where(eq(client.workspaceId, workspaceId)).orderBy(asc(client.name)),
    async findClient(workspaceId, clientId) {
      const [row] = await tx
        .select(clientColumns)
        .from(client)
        .where(and(eq(client.workspaceId, workspaceId), eq(client.id, clientId)));
      return row ?? null;
    },
    async insertClient(workspaceId, values) {
      const [row] = await tx
        .insert(client)
        .values({ ...values, workspaceId })
        .returning(clientColumns)
        .catch(nameTaken);
      if (!row) throw new Error('insert into workspaces.client returned no row');
      return row;
    },
    async renameClient(workspaceId, clientId, name) {
      const rows = await tx
        .update(client)
        .set({ name })
        .where(and(eq(client.workspaceId, workspaceId), eq(client.id, clientId)))
        .returning({ id: client.id })
        .catch(nameTaken);
      return rows.length > 0;
    },
    async archiveClient(workspaceId, clientId) {
      const rows = await tx
        .update(client)
        .set({ archivedAt: sql`coalesce(${client.archivedAt}, now())` })
        .where(and(eq(client.workspaceId, workspaceId), eq(client.id, clientId)))
        .returning({ id: client.id });
      return rows.length > 0;
    },
    listGrants: (workspaceId, userId) =>
      tx
        .select(grantColumns)
        .from(jobGrant)
        .where(and(eq(jobGrant.workspaceId, workspaceId), userId ? eq(jobGrant.userId, userId) : undefined))
        .orderBy(asc(jobGrant.grantedAt)),
    async insertGrant(workspaceId, values) {
      const [row] = await tx
        .insert(jobGrant)
        .values({ ...values, workspaceId })
        .onConflictDoNothing()
        .returning(grantColumns);
      return row ?? null;
    },
    async deleteGrant(workspaceId, grantId) {
      const [row] = await tx
        .delete(jobGrant)
        .where(and(eq(jobGrant.workspaceId, workspaceId), eq(jobGrant.id, grantId)))
        .returning(grantColumns);
      return row ?? null;
    },
    async deleteGrantsOf(workspaceId, userId) {
      await tx.delete(jobGrant).where(and(eq(jobGrant.workspaceId, workspaceId), eq(jobGrant.userId, userId)));
    },
    async setJobScope(scope, grants) {
      await tx.execute(sql`select set_config('app.job_scope', ${scope}, true),
        set_config('app.job_ids', ${uuidArray(grants.map((g) => g.jobId))}, true),
        set_config('app.client_ids', ${uuidArray(grants.map((g) => g.clientId))}, true)`);
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
