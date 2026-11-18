import { sql } from 'drizzle-orm';
import { check, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const identity = pgSchema('identity');

// Global, not workspace-owned: a person signs in before any workspace is chosen, and one user belongs to many
// workspaces (ADR-009). No row-level security; workspaces reach a user only through workspaces.member.user_id.
export const user = identity.table(
  'user',
  {
    id: uuid().primaryKey(),
    // Lower-case text with a check instead of citext: the citext extension needs an allow-list change on Azure.
    email: text().notNull().unique('user_email_unique'),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('user_email_lower_case', sql`${t.email} = lower(${t.email})`)],
);

export const signInMethod = identity.table(
  'sign_in_method',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    issuer: text().notNull(),
    subject: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'sign_in_method_pkey', columns: [t.issuer, t.subject] })],
);
