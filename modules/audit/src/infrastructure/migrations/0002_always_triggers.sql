-- Custom migration: ENABLE ALWAYS so the append-only triggers also fire under session_replication_role = replica,
-- which would otherwise skip ordinary (origin-only) triggers.
-- shortcut: the owner (aivera_migrator) can still disable or drop the triggers or drop the table; before the pilot, move ownership to a separate role or add an event trigger plus immutable backup
ALTER TABLE "audit"."entry" ENABLE ALWAYS TRIGGER "entry_append_only";
--> statement-breakpoint
ALTER TABLE "audit"."entry" ENABLE ALWAYS TRIGGER "entry_no_truncate";
