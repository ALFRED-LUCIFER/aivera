-- Custom migration (drizzle-kit generate --custom), AIV-P2-039: the one settings row with its defaults, so the pilot
-- starts with "New workspaces need approval" on and a change always locks an existing row. ON CONFLICT keeps a value an
-- operator already set.
INSERT INTO "ops"."platform_setting" ("id", "approval_required") VALUES (true, true) ON CONFLICT ("id") DO NOTHING;
