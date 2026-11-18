# ADR-005: Workspace tenancy with a repository filter and row-level security

- **Status:** Accepted, 18 Nov 2026
- **Ticket:** AIV-P0-001 (decision), AIV-P0-002 (database helper), workspaces module ticket (module)

## Context

A workspace is one hiring organisation (or agency). Candidates' data must never leak between workspaces. A single missed `WHERE workspace_id = …` must not be enough to leak it.

## Decision

Two independent layers, never one without the other:

1. **Repository filter.** Every repository method on a workspace-owned table takes the workspace id from the request context and filters by it. Repositories never accept a workspace id from client input.
2. **PostgreSQL row-level security.** Every workspace-owned table has `workspace_id uuid not null`, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a policy `USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)` with the same `WITH CHECK`. The `nullif` matters: once a pooled connection has run a workspace transaction, the unset setting reads as `''`, and casting `''` to uuid would raise an error instead of returning no rows. Drizzle emits `ENABLE` from `.enableRLS()`; `FORCE` goes in a custom migration (`drizzle-kit generate --custom`). The app connects as `aivera_app`, which does not own the tables.
3. **Workspace-scoped transaction.** All workspace data access runs inside `withWorkspace(db, workspaceId, tx => …)` from `packages/db`, which opens a transaction and runs `select set_config('app.workspace_id', $1, true)` (transaction-local, so pooled connections never carry it over). With no workspace set, policies return no rows.
4. **Cross-workspace reads** (candidate site job listings, a candidate's own applications across workspaces) go through explicit, named contract methods using a separate policy keyed on the candidate account or on published status, each with its own integration test. There is no "bypass RLS" role in application code.
5. **Tests:** every new workspace-owned table gets an integration test that removes the repository filter and proves RLS still returns only the current workspace's rows, mutation-checked by dropping the policy.

## Consequences

- A bug in one layer is caught by the other.
- Background jobs must carry the workspace id in their message and open `withWorkspace` themselves.
- Platform-wide operations (support, analytics) need their own audited path and ADR.
