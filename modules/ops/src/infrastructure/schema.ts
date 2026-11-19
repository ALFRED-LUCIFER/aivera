import { sql } from 'drizzle-orm';
import { boolean, check, pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';

export const ops = pgSchema('ops');

// The platform settings the operators change from the console (AIV-P2-039, ADR-012 point 9): one row, keyed on a
// constant so a second row cannot exist. Not workspace-owned and holds no personal data (tenancy.test.ts
// GLOBAL_TABLES); migration 0001 inserts the row with the defaults, so a change always locks an existing row.
export const platformSetting = ops.table(
  'platform_setting',
  {
    id: boolean().primaryKey().default(true),
    // While on, a sign-up's workspace waits for an operator (workspaces.workspace.status = 'pending_approval').
    approvalRequired: boolean('approval_required').notNull().default(true),
    // The operator's identity user id (opaque, ADR-009); null until an operator first changes a setting.
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('platform_setting_single_row', sql`${t.id}`)],
);
