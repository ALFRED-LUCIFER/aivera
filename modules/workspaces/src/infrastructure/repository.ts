import type { AuditContract } from '@aivera/audit';
import { DbQueryError, type Tx } from '@aivera/db/client';
import { and, asc, count, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { ActiveWorkspaces } from '../application/context.ts';
import type { WorkspaceStore } from '../application/workspaces.ts';
import {
  AI_DAILY_TOKEN_BUDGET,
  usageWindow,
  WorkspaceError,
  type AiTokenUse,
  type WorkspaceSummary,
} from '../domain/workspace.ts';
import { activeWorkspace, aiTokenUsage, client, directory, jobGrant, member, workspace } from './schema.ts';

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
      await tx.insert(directory).values({ workspaceId: row.id, createdAt: row.createdAt });
      return row;
    },
    async findWorkspace(workspaceId) {
      const [row] = await tx.select().from(workspace).where(eq(workspace.id, workspaceId));
      return row ?? null;
    },
    setActiveWorkspace: (userId, workspaceId) => activeWorkspaceStore(tx).set(userId, workspaceId),
    async insertMember(values) {
      return (
        (
          await tx
            .insert(member)
            .values(values)
            .onConflictDoNothing({ target: [member.workspaceId, member.userId] })
            .returning({ userId: member.userId })
        ).length > 0
      );
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
    async shareWorkspace(workspaceId) {
      const [row] = await tx.select().from(workspace).where(eq(workspace.id, workspaceId)).for('key share');
      return row ?? null;
    },
    async lockWorkspace(workspaceId) {
      const [row] = await tx.select().from(workspace).where(eq(workspace.id, workspaceId)).for('no key update');
      return row ?? null;
    },
    async lockWorkspaceStatus(workspaceId) {
      const [row] = await tx.select().from(workspace).where(eq(workspace.id, workspaceId)).for('update');
      return row ?? null;
    },
    async updateType(workspaceId, type) {
      await tx.update(workspace).set({ type }).where(eq(workspace.id, workspaceId));
    },
    async updateStatus(workspaceId, status) {
      await tx.update(workspace).set({ status }).where(eq(workspace.id, workspaceId));
    },
    async deleteWorkspace(workspaceId) {
      // Children first: grants reference members and clients, and every table references the workspace.
      await tx.delete(aiTokenUsage).where(eq(aiTokenUsage.workspaceId, workspaceId));
      await tx.delete(jobGrant).where(eq(jobGrant.workspaceId, workspaceId));
      await tx.delete(client).where(eq(client.workspaceId, workspaceId));
      await tx.delete(member).where(inWorkspace(workspaceId));
      await tx.delete(activeWorkspace).where(eq(activeWorkspace.workspaceId, workspaceId));
      await tx.delete(directory).where(eq(directory.workspaceId, workspaceId));
      await tx.delete(workspace).where(eq(workspace.id, workspaceId));
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
        // shortcut: the database clock, like every created_at in this module; move to the Clock port when it has one.
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
    deleteGrantsOf: (workspaceId, userId) =>
      tx
        .delete(jobGrant)
        .where(and(eq(jobGrant.workspaceId, workspaceId), eq(jobGrant.userId, userId)))
        .returning(grantColumns),
    async setJobScope(scope, grants) {
      await tx.execute(sql`select set_config('app.job_scope', ${scope}, true),
        set_config('app.job_ids', ${uuidArray(grants.map((g) => g.jobId))}, true),
        set_config('app.client_ids', ${uuidArray(grants.map((g) => g.clientId))}, true)`);
    },
    async audit(workspaceId, actorUserId, values) {
      await audit.record({ tx, workspaceId, actor: { type: 'user', id: actorUserId } }, values);
    },
    async operatorAudit(workspaceId, operatorId, values) {
      await audit.record({ tx, workspaceId, actor: { type: 'operator', id: operatorId } }, values);
      const { action, subject, note, before, after } = values;
      await audit.recordPlatform(
        {
          actorId: operatorId,
          action,
          subject,
          ...(note && { note }),
          ...(before && { before }),
          ...(after && { after }),
        },
        tx,
      );
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

/** Every workspace id in the platform directory, newest first (not workspace-owned; see the schema). */
export async function listDirectory(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: directory.workspaceId })
    .from(directory)
    .orderBy(desc(directory.createdAt), desc(directory.workspaceId));
  return rows.map((r) => r.id);
}

/** The workspace's platform facts, over its own scoped transaction; the filter and RLS both apply. */
export async function readSummary(tx: Tx, workspaceId: string): Promise<WorkspaceSummary | null> {
  const [found] = await tx
    .select({
      id: workspace.id,
      name: workspace.name,
      type: workspace.type,
      createdAt: workspace.createdAt,
      synthetic: workspace.synthetic,
      status: workspace.status,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  if (!found) return null;
  const [members] = await tx
    .select({ n: count() })
    .from(member)
    .where(and(inWorkspace(workspaceId), eq(member.status, 'active')));
  return { ...found, activeMembers: members?.n ?? 0 };
}

const budgetOf = (override: number | null) => override ?? AI_DAILY_TOKEN_BUDGET.default;

/** Daily AI token use (AIV-P0-033) and its budget (AIV-P2-038), over a workspace-scoped transaction; the filter and RLS both apply. */

export function aiTokenUsageStore(tx: Tx) {
  return {
    /** The day's tokens and the budget in force, in one statement. Throws when the workspace is not visible. */
    async spent(workspaceId: string, day: string) {
      const [found] = await tx
        .select({ override: workspace.aiDailyTokenBudget, tokens: aiTokenUsage.tokens })
        .from(workspace)
        .leftJoin(aiTokenUsage, and(eq(aiTokenUsage.workspaceId, workspace.id), eq(aiTokenUsage.usageDay, day)))
        .where(eq(workspace.id, workspaceId));
      if (!found) throw new Error('no such workspace in this scope');
      return { spent: found.tokens ?? 0, limit: budgetOf(found.override) };
    },
    // One statement, so concurrent calls from any process never lose an increment (no read-then-write).
    async add(workspaceId: string, day: string, tokens: number) {
      await tx
        .insert(aiTokenUsage)
        .values({ workspaceId, usageDay: day, tokens })
        .onConflictDoUpdate({
          target: [aiTokenUsage.workspaceId, aiTokenUsage.usageDay],
          set: { tokens: sql`${aiTokenUsage.tokens} + excluded.tokens` },
        });
    },
    /** The budget and the `days` UTC days ending on `today`; null when the workspace is not visible. */
    async usage(workspaceId: string, today: string, days: number): Promise<AiTokenUse | null> {
      const [found] = await tx
        .select({ override: workspace.aiDailyTokenBudget })
        .from(workspace)
        .where(eq(workspace.id, workspaceId));
      if (!found) return null;
      const window = usageWindow(today, days, []);
      const used = await tx
        .select({ day: aiTokenUsage.usageDay, tokens: aiTokenUsage.tokens })
        .from(aiTokenUsage)
        .where(
          and(
            eq(aiTokenUsage.workspaceId, workspaceId),
            gte(aiTokenUsage.usageDay, window.at(-1)?.day ?? today),
            lte(aiTokenUsage.usageDay, today),
          ),
        );
      return {
        dailyBudget: budgetOf(found.override),
        overridden: found.override !== null,
        days: usageWindow(today, days, used),
      };
    },
    /**
     * Sets the override (null: back to the default) under a row lock, so concurrent changes record a true "before".
     * Returns the budget in force before; null when the workspace is not visible.
     */
    async setDailyBudget(workspaceId: string, override: number | null): Promise<number | null> {
      const [found] = await tx
        .select({ override: workspace.aiDailyTokenBudget })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        // Serialises budget changes without waiting behind every request's KEY SHARE (only a status change needs that).
        .for('no key update');
      if (!found) return null;
      await tx.update(workspace).set({ aiDailyTokenBudget: override }).where(eq(workspace.id, workspaceId));
      return budgetOf(found.override);
    },
  };
}
