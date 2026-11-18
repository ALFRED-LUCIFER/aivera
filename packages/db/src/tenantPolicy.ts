import { sql } from 'drizzle-orm';
import { pgPolicy, type AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * The row-level security policy every workspace-owned table carries (ADR-005): rows are visible and writable only
 * when `column` equals the transaction's `app.workspace_id`. `nullif` turns the `''` a pooled connection reads after
 * an earlier workspace transaction into null (no rows) instead of a uuid cast error.
 * Use it in a table's extra config with `.enableRLS()`, plus a custom migration for FORCE ROW LEVEL SECURITY.
 * Imported as `@aivera/db/tenant-policy` because Drizzle Kit loads schemas as CommonJS (no import.meta).
 */
export function tenantPolicy(name: string, column: AnyPgColumn) {
  const matches = sql`${column} = nullif(current_setting('app.workspace_id', true), '')::uuid`;
  return pgPolicy(name, { for: 'all', using: matches, withCheck: matches });
}
