import { sql } from 'drizzle-orm';
import { pgPolicy, type AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Rows visible and writable only when `column` equals the transaction's `setting`. `nullif` turns the `''` a pooled
 * connection reads after an earlier scoped transaction into null (no rows) instead of a uuid cast error.
 */
function settingPolicy(name: string, column: AnyPgColumn, setting: 'app.workspace_id' | 'app.candidate_account_id') {
  const matches = sql`${column} = nullif(current_setting(${sql.raw(`'${setting}'`)}, true), '')::uuid`;
  return pgPolicy(name, { for: 'all', using: matches, withCheck: matches });
}

/**
 * The row-level security policy every workspace-owned table carries (ADR-005): rows are visible and writable only
 * when `column` equals the transaction's `app.workspace_id`.
 * Use it in a table's extra config with `.enableRLS()`, plus a custom migration for FORCE ROW LEVEL SECURITY.
 * Imported as `@credalent/db/tenant-policy` because Drizzle Kit loads schemas as CommonJS (no import.meta).
 */
export function tenantPolicy(name: string, column: AnyPgColumn) {
  return settingPolicy(name, column, 'app.workspace_id');
}

/** The same for a candidate's own tables (ADR-009): keyed on the transaction's `app.candidate_account_id`. */
export function candidateAccountPolicy(name: string, column: AnyPgColumn) {
  return settingPolicy(name, column, 'app.candidate_account_id');
}
