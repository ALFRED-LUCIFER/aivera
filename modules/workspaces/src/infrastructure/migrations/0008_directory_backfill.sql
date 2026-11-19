-- Custom migration (drizzle-kit generate --custom), AIV-P2-036 (ADR-012 point 6): lists the workspaces that existed
-- before the directory. Row-level security stays on: each workspace is read under its own app.workspace_id, set
-- transaction-locally, with ids from active_workspace, the only table that names workspaces without a tenant policy.
-- shortcut: a workspace that is nobody's active workspace is not backfilled; only dev has rows (synthetic, ADR-008) and
-- the pilot database starts empty. A later createWorkspace keeps the directory complete.
DO $$
DECLARE
  target uuid;
BEGIN
  FOR target IN SELECT DISTINCT workspace_id FROM "workspaces"."active_workspace" LOOP
    PERFORM set_config('app.workspace_id', target::text, true);
    INSERT INTO "workspaces"."directory" ("workspace_id", "created_at")
      SELECT "id", "created_at" FROM "workspaces"."workspace" WHERE "id" = target
      ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;
