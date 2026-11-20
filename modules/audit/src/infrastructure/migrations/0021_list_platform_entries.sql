-- Custom migration (drizzle-kit generate --custom), AIV-P2-053: the console's one read path into the platform audit
-- log (ADR-012 point 8). aivera_app still has no privilege on the table; it may only execute this function, which runs
-- as its owner (the migrator), returns the platform columns newest first and at most 50 rows a call. Each filter is
-- skipped when null; p_after is the id of the last entry of the previous page (keyset pagination).
-- shortcut: no index on occurred_at; the log holds operator actions only, so a scan is cheap. Add one when the console's
-- audit page is slow.
CREATE FUNCTION "audit"."list_platform_entries"(
  p_action text, p_actor uuid, p_target uuid, p_from timestamptz, p_to timestamptz, p_after uuid, p_page_size int)
RETURNS TABLE (
  id uuid, occurred_at timestamptz, actor_id uuid, action text, subject_type text, subject_id uuid, note text,
  before jsonb, after jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT e.id, e.occurred_at, e.actor_id, e.action, e.subject_type, e.subject_id, e.note, e.before, e.after
  FROM "audit"."platform_entry" e
  WHERE (p_action IS NULL OR e.action = p_action)
    AND (p_actor IS NULL OR e.actor_id = p_actor)
    AND (p_target IS NULL OR e.subject_id = p_target)
    AND (p_from IS NULL OR e.occurred_at >= p_from)
    AND (p_to IS NULL OR e.occurred_at < p_to)
    AND (p_after IS NULL OR (e.occurred_at, e.id) <
      (SELECT c.occurred_at, c.id FROM "audit"."platform_entry" c WHERE c.id = p_after))
  ORDER BY e.occurred_at DESC, e.id DESC
  LIMIT least(p_page_size, 50)
$$;
--> statement-breakpoint
-- Functions are executable by PUBLIC by default; only the app role may call this one.
REVOKE ALL ON FUNCTION "audit"."list_platform_entries"(text, uuid, uuid, timestamptz, timestamptz, uuid, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "audit"."list_platform_entries"(text, uuid, uuid, timestamptz, timestamptz, uuid, int) TO aivera_app;
