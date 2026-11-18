import { ForbiddenError, JOB_SCOPED_ROLES, PERMISSIONS, type Action, type JobResource } from '../domain/permissions.ts';
import type { Role } from '../domain/workspace.ts';
import type { WorkspaceStore } from './workspaces.ts';

/** What every server action, route handler and worker job runs with: one workspace, its scoped transaction. */
export type WorkspaceContext<Tx> = { userId: string; workspaceId: string; role: Role; tx: Tx };

/** The signed-in user, from the server-side session. */
export type Session = { userId: string };

/** Whether one of the member's job grants covers the job or its client. The real lookup is AIV-P0-906. */
export type JobGrants<Tx> = {
  covers(ctx: WorkspaceContext<Tx>, resource: JobResource): Promise<boolean>;
};

/** The user's active workspace, held server-side (ADR-009): the session cookie holds only the user id. */
export type ActiveWorkspaces = {
  get(userId: string): Promise<string | null>;
  set(userId: string, workspaceId: string): Promise<void>;
};

export type ContextPorts<Tx> = {
  inWorkspace<T>(workspaceId: string, work: (store: WorkspaceStore, tx: Tx) => Promise<T>): Promise<T>;
  grants: JobGrants<Tx>;
  active: ActiveWorkspaces;
};

export function contextUseCases<Tx>({ inWorkspace, grants, active }: ContextPorts<Tx>) {
  return {
    /**
     * Runs `fn` in `workspaceId`'s scoped transaction, after checking in that same transaction that the user is an
     * active member. A user who is not (a forged id, a removed member) gets `ForbiddenError` and `fn` never runs.
     */
    withWorkspace<T>(session: Session, workspaceId: string, fn: (ctx: WorkspaceContext<Tx>) => Promise<T>): Promise<T> {
      return inWorkspace(workspaceId, async (store, tx) => {
        const member = await store.findMember(workspaceId, session.userId);
        if (member?.status !== 'active') throw new ForbiddenError();
        return fn({ userId: session.userId, workspaceId, role: member.role, tx });
      });
    },

    /** Throws `ForbiddenError` unless the context's role, and for job-scoped roles a job grant, allows `action`. */
    async authorize(ctx: WorkspaceContext<Tx>, action: Action, resource?: JobResource): Promise<void> {
      const permission = PERMISSIONS[action];
      if (!(permission.roles as readonly Role[]).includes(ctx.role)) throw new ForbiddenError();
      if (permission.scope === 'workspace' || !JOB_SCOPED_ROLES.includes(ctx.role)) return;
      // Fails closed: a job-scoped role with no job named is refused.
      if (!resource || !(await grants.covers(ctx, resource))) throw new ForbiddenError();
    },

    activeWorkspace: (userId: string): Promise<string | null> => active.get(userId),

    /** Re-checks membership; a refused switch throws `ForbiddenError` and leaves the active workspace as it was. */
    async switchWorkspace(session: Session, workspaceId: string): Promise<void> {
      const member = await inWorkspace(workspaceId, (store) => store.findMember(workspaceId, session.userId));
      if (member?.status !== 'active') throw new ForbiddenError();
      await active.set(session.userId, workspaceId);
    },
  };
}
