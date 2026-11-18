# ADR-005: Workspace tenancy with a repository filter and row-level security

- **Status:** Accepted, 18 Nov 2026
- **Ticket:** AIV-P0-001 (decision), AIV-P0-002 (database helper), workspaces module ticket (module); job scope and agency clients AIV-P0-905 ([ADR-009](ADR-009-identity-and-account-model.md)), built in AIV-P0-010 and AIV-P0-906

## Context

A workspace is one hiring organisation: an in-house team, an agency, or a solo recruiter ([ADR-009](ADR-009-identity-and-account-model.md)). Candidates' data must never leak between workspaces. A single missed `WHERE workspace_id = …` must not be enough to leak it. Inside an agency's workspace, one client's people must not see another client's jobs or candidates either.

## Decision

Two independent layers, never one without the other:

1. **Repository filter.** Every repository method on a workspace-owned table takes the workspace id from the request context and filters by it. Repositories never accept a workspace id from client input.
2. **PostgreSQL row-level security.** Every workspace-owned table has `workspace_id uuid not null`, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a policy `USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)` with the same `WITH CHECK`. The `nullif` matters: once a pooled connection has run a workspace transaction, the unset setting reads as `''`, and casting `''` to uuid would raise an error instead of returning no rows. The policy comes from `tenantPolicy(name, column)` in `@aivera/db/tenant-policy` (AIV-P0-008). Drizzle emits `ENABLE` from `.enableRLS()`; `FORCE` goes in a custom migration (`drizzle-kit generate --custom`). The app connects as `aivera_app`, which does not own the tables. The tenant root table `workspaces.workspace` is keyed on its own `id`, not on a `workspace_id` column, so inside `withWorkspace(W)` only W is visible. Listing a user's workspaces across tenants (needed at sign-in, AIV-P0-009/010) is therefore impossible for `aivera_app` under this policy and needs a named policy and contract method under point 4.
3. **Workspace-scoped transaction.** All workspace data access runs inside `withWorkspace(db, workspaceId, tx => …)` from `packages/db`, which opens a transaction and runs `select set_config('app.workspace_id', $1, true)` (transaction-local, so pooled connections never carry it over). With no workspace set, policies return no rows.
4. **Cross-workspace reads** (candidate site job listings, a candidate's own applications across workspaces) go through explicit, named contract methods using a separate policy keyed on the candidate account or on published status, each with its own integration test. There is no "bypass RLS" role in application code.
5. **Tests:** every new workspace-owned table gets an integration test that removes the repository filter and proves RLS still returns only the current workspace's rows, mutation-checked by dropping the policy.
6. **Job scope sits on top of workspace isolation.** Admins and recruiters see the whole workspace. Hiring owners and interviewers see only the jobs they are granted, so a client's people never see another client's jobs or candidates.
   - **Application authorisation (always).** The request context loads the member's job grants. `authorize(ctx, action, { jobId, clientId })` refuses a job-scoped action for a hiring owner or interviewer unless a grant covers that job, or the job's client. With no job given it refuses (fails closed). Every server action, route handler and worker job that touches a job's records names the job; records with no job, such as the talent pool or candidates across jobs, are not open to these roles. Built in AIV-P0-010 (rule) and AIV-P0-906 (grants).
   - **Row-level security, where cheap.**
     - `withWorkspace` sets three settings, transaction-locally, from the member's grants (AIV-P0-906): `app.job_scope` (`all` for admins and recruiters, `granted` otherwise), `app.job_ids` and `app.client_ids`.
     - A table that carries both the job id and the client id adds a restrictive policy next to the tenant policy: `app.job_scope = 'all'`, or its job id is in `app.job_ids`, or its client id is in `app.client_ids`. The settings are read through `nullif` like `app.workspace_id`, so unset means no rows. The first such table is `jobs.job` (AIV-P1-005).
     - Tables that hold only a job id would need the job's client, which lives in another module's schema, so they rely on the application layer. One may add the policy if it stores the client id too.
   - **Agency clients** are rows in `workspaces.client`, owned by the workspace and under the same tenant policy. A job carries an optional `client_id`; no client means the team's own job. Grants live in `workspaces.job_grant` (member, and either a job id or a client id). A client grant covers that client's current and future jobs. Clients are not tenants: an agency's talent pool, candidates and settings stay workspace-wide.

## Consequences

- A bug in one layer is caught by the other.
- Background jobs must carry the workspace id in their message and open `withWorkspace` themselves.
- Platform-wide operations (support, analytics) need their own audited path and ADR.
- A person in several workspaces (ADR-009) lists their workspaces through a named cross-workspace read keyed on their user id (point 4), never through a relaxed tenant policy.
- Job scope adds one lookup per request (the member's grants). It is cheap because only hiring owners and interviewers have grants.
