# @aivera/workspaces

The tenancy module (AIV-P0-008). A workspace is one hiring team; members belong to it with a role (`admin`, `recruiter`, `hiring_owner`, `interviewer`) and a status (`invited`, `active`, `removed`). Other code imports only `@aivera/workspaces` (the `WorkspacesContract` types); apps build it with `createWorkspaces(db)` from `@aivera/workspaces/composition`.

- **Tables:** `workspaces.workspace` and `workspaces.member` (primary key `(workspace_id, user_id)`), migrations tracked in `migrations.workspaces` (ADR-004).
- **Row-level security (ADR-005):** both tables have `ENABLE` + `FORCE ROW LEVEL SECURITY` and `tenantPolicy` from `@aivera/db/tenant-policy`.
- **Decision: `workspaces.workspace` is keyed on its own `id`.** Inside `withWorkspace(W)` only workspace W is visible, so a member reads only a workspace whose scoped transaction the request context opened for them. `createWorkspace` generates the id, opens `withWorkspace` on it and inserts the workspace and its first admin in one transaction, so no bypass role is needed.
- **Rules:** only an active admin changes roles; the last active admin cannot stop being one ("A workspace needs at least one admin"). `changeRole` locks the workspace's member rows (`FOR UPDATE`), so two concurrent changes cannot both remove an admin.
- **Tests:** domain rules in `src/domain/workspace.test.ts`; database scenarios in `tests/integration/src/workspaces.test.ts`.
