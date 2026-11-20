// An audit entry: who did what to which record, when and why (AGENTS.md 1.5, 3.6). Entries are never changed.
import { z } from 'zod';

/** Adding an action also needs a migration for the `entry_action_check` constraint (infrastructure/schema.ts). */
export const ACTIONS = [
  'rubric.approved',
  'rubric.submitted',
  'rubric.saved',
  'rubric.returned',
  'score.changed',
  'candidate.merged',
  'decision.recorded',
  'assistant.confirmed',
  'member.role_changed',
  'workspace.created',
  'workspace.type_changed',
  'client.added',
  'client.renamed',
  'client.archived',
  'job_access.granted',
  'job_access.revoked',
  'job.created',
  'member.added',
  'workspace.purged',
  'job.published',
  'job.unpublished',
  'ai_budget.changed',
  'workspace.suspended',
  'workspace.reactivated',
  'workspace.approved',
  'workspace.rejected',
  'workspace.settings_changed',
  'member.invited',
  'invitation.revoked',
  'invitation.accepted',
  'member.removed',
  'job.stage_changed',
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * What a Credalent operator did, recorded in the platform audit log with no workspace (ADR-012). Adding one also needs a
 * migration for the `platform_entry_action_check` constraint (infrastructure/schema.ts).
 */
export const PLATFORM_ACTIONS = [
  'ops.console_opened',
  'ops.workspace_viewed',
  'ai_budget.changed',
  'workspace.suspended',
  'workspace.reactivated',
  'workspace.approved',
  'workspace.rejected',
  'ops.approval_mode_changed',
  // The catalogue editor (ADR-013 point 14), by the version id.
  'catalogue.draft_opened',
  'catalogue.entry_added',
  'catalogue.entry_edited',
  'catalogue.entry_retired',
  'catalogue.entry_removed',
  'catalogue.draft_discarded',
  'catalogue.eval_requested',
  'catalogue.published',
] as const;
export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

/**
 * The only keys a platform entry's `before` and `after` may hold: platform values, never a candidate field (AIV-P2-053).
 * A new platform action with other values adds its keys here.
 */
export const PLATFORM_VALUE_KEYS: readonly string[] = ['dailyTokenBudget', 'status', 'approvalRequired'];

/** Actions where a person changes an outcome, so the reason must be written down. */
export const NOTE_REQUIRED: readonly Action[] = ['score.changed', 'decision.recorded', 'ai_budget.changed'];

/** `operator` is a Credalent operator acting on a workspace from the console, by identity user id (ADR-012 point 8). */
export const ACTOR_TYPES = ['user', 'system', 'candidate', 'client', 'operator'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** `system` is Credalent itself and has no id; every other actor is an opaque id from its owning module. */
export type Actor = { type: 'system' } | { type: Exclude<ActorType, 'system'>; id: string };

/** The record the entry is about, by opaque id (`{ type: 'candidate', id }`). */
export type Subject = { type: string; id: string };

/** Ids, field names, enum values and numbers only: no names, contact details or free text about a candidate. */
export type Values = Record<string, string | number | boolean | null>;

export type NewEntry = {
  action: Action;
  subject: Subject;
  note?: string;
  before?: Values;
  after?: Values;
};

/**
 * An operator's action: the operator's identity user id, the target by opaque id when there is one, the reason, and
 * the values before and after a change (ids, enum values and numbers only, as for `NewEntry`).
 */
export type NewPlatformEntry = {
  actorId: string;
  action: PlatformAction;
  subject?: Subject;
  note?: string;
  before?: Values;
  after?: Values;
};

export type PlatformEntry = {
  id: string;
  occurredAt: Date;
  actorId: string;
  action: PlatformAction;
  subject: Subject | null;
  note: string | null;
  before: Values | null;
  after: Values | null;
};

export type AuditEntry = Required<Pick<NewEntry, 'action' | 'subject'>> & {
  id: string;
  workspaceId: string;
  occurredAt: Date;
  actor: Actor;
  note: string | null;
  before: Values | null;
  after: Values | null;
  correlationId: string | null;
};

/** The console's filter for the platform audit log (AIV-P2-053); every field optional, `to` exclusive. */
export const platformEntryQuerySchema = z
  .object({
    action: z.enum(PLATFORM_ACTIONS).optional(),
    actorId: z.uuid().optional(),
    targetId: z.uuid().optional(),
    from: z.date().optional(),
    to: z.date().optional(),
    // The id of the last entry of the previous page.
    cursor: z.uuid().optional(),
    pageSize: z.number().int().min(1).max(50).default(50),
  })
  .strict();
export type PlatformEntryQuery = z.input<typeof platformEntryQuerySchema>;
export type PlatformEntryFilter = z.output<typeof platformEntryQuerySchema>;

/** One page of the platform audit log, newest first. A full page has a cursor; the page after it may be empty. */
export type PlatformEntryPage = { entries: PlatformEntry[]; nextCursor: string | null };

const MESSAGES = {
  unknown_action: 'Unknown audit action',
  note_required: 'A note is required for this action',
  personal_data: 'Audit before and after values hold ids and field names only',
} as const;

export type AuditErrorCode = keyof typeof MESSAGES;

/** A refused audit write. The message never repeats the refused value (AGENTS.md 1.2). */
export class AuditError extends Error {
  readonly code: AuditErrorCode;
  constructor(code: AuditErrorCode) {
    super(MESSAGES[code]);
    this.name = 'AuditError';
    this.code = code;
  }
}

const EMAIL = /@/;
// A whole value of 7 to 15 digits once spaces, dots, dashes and brackets are removed (E.164 length).
const PHONE = /^\+?\d{7,15}$/;

// shortcut: catches email addresses and phone numbers only, not names; keys are not checked for workspace entries; any 7-15 digit value is refused, so a plain date (2026-11-18) is too; add a zod schema per action when actions carry richer values
const looksPersonal = (value: Values[string]) =>
  typeof value === 'string' && (EMAIL.test(value) || PHONE.test(value.replace(/[\s().-]/g, '')));

/** Throws unless `entry` may be written: a known action, a note where required, no contact details in values. */
export function assertValidEntry(entry: NewEntry): void {
  if (!ACTIONS.includes(entry.action)) throw new AuditError('unknown_action');
  if (NOTE_REQUIRED.includes(entry.action) && !entry.note?.trim()) throw new AuditError('note_required');
  for (const values of [entry.before, entry.after])
    if (values && Object.values(values).some(looksPersonal)) throw new AuditError('personal_data');
}

// shortcut: a platform entry's note is the operator's free-text reason, checked for presence only, not for candidate
// fields; operators never see candidate data (ADR-012 point 7). Scan notes when the console shows them to others.
/**
 * Throws unless `entry` names a known platform action, has a note where required, and only platform keys
 * (`PLATFORM_VALUE_KEYS`) without contact details in its values.
 */
export function assertValidPlatformEntry(entry: NewPlatformEntry): void {
  if (!PLATFORM_ACTIONS.includes(entry.action)) throw new AuditError('unknown_action');
  if ((NOTE_REQUIRED as readonly string[]).includes(entry.action) && !entry.note?.trim())
    throw new AuditError('note_required');
  for (const values of [entry.before, entry.after])
    if (
      values &&
      (Object.keys(values).some((key) => !PLATFORM_VALUE_KEYS.includes(key)) ||
        Object.values(values).some(looksPersonal))
    )
      throw new AuditError('personal_data');
}
