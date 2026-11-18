# @aivera/audit

The append-only audit log (AIV-P0-013): who did what to which record, when and why. Score changes, rubric approvals, merges, decisions, assistant-confirmed actions and role changes write here (AGENTS.md 1.5, 3.6). Other code imports only `@aivera/audit` (the `AuditContract` types); apps build it with `createAudit(db, now)` from `@aivera/audit/composition`.

- **Table:** `audit.entry` (id, workspace id, `occurred_at` from the injected clock, actor type and id, action, subject type and id, note, `before` and `after` as JSONB, correlation id). Migrations are tracked in `migrations.audit`; `audit` migrates first (ADR-004).
- **Writing in the caller's transaction:** `record({ tx, workspaceId, actor }, { action, subject, note, before, after })` inserts through the caller's own `withWorkspace` transaction, so the entry commits or rolls back with the change it records. Make it the last statement before commit.
- **Append-only, enforced by PostgreSQL, two layers** (migration `0001_append_only`):
  1. `REVOKE UPDATE, DELETE, TRUNCATE ON audit.entry FROM aivera_app`. `roles.sql` grants UPDATE and DELETE on every new table by default privilege, so the revoke is explicit. `aivera_app` gets `permission denied` (SQLSTATE 42501).
  2. Triggers `entry_append_only` (UPDATE, DELETE) and `entry_no_truncate` (TRUNCATE) call `audit.refuse_change()`, which raises `audit entries are append-only` (42501) for every role, the owner included.
- **Future audit tables:** a new table in `audit` repeats the REVOKE and both triggers on `audit.refuse_change()` in its migration. An integration test checks every table in the `audit` schema for both and fails otherwise.
- **Row-level security (ADR-005):** `ENABLE` + `FORCE ROW LEVEL SECURITY` with `tenantPolicy` on `workspace_id`; `listFor` also filters by workspace.
- **Rules:** `action` is one of `ACTIONS` (domain list, mirrored by a check constraint). `score.changed` and `decision.recorded` need a note ("A note is required for this action"), checked in the domain and by the `entry_note_check` constraint.
- **No candidate personal data (AGENTS.md 1.2):** actors and subjects are opaque ids. `before` and `after` are flat maps of ids, field names, enum values and numbers; `record` refuses any value that looks like an email address or phone number, and the error never repeats the value. Names cannot be detected by pattern, so callers must not put them there (recorded as a `shortcut:` in `domain/entry.ts`). A note is a person's reason for a change and must not hold contact details.
- **Not here:** rendering an entry as a sentence ("12 Nov · Evidence assessed by Aivera…") belongs with the audit trail UI and its translations (AIV-P2-006).
- **Tests:** domain rules in `src/domain/entry.test.ts`; database scenarios in `tests/integration/src/audit.test.ts`.
