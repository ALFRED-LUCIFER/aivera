// The platform audit log page (AIV-P2-054, ADR-012 point 8). Pure: no React, no I/O (ADR-003).
import { PLATFORM_ACTIONS, type PlatformEntry, type PlatformEntryQuery } from '@aivera/audit';
import { z } from 'zod';

// A missing, empty, repeated or malformed parameter is dropped, never an error: the page redirects to the valid rest.
const param = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

/**
 * The filters in the URL: an action key, opaque ids and UTC days only, never a name or email (AGENTS.md 1.2). `to` is
 * the last day shown (inclusive); `cursor` is the last entry of the previous page.
 */
export const auditParamsSchema = z.object({
  action: param(z.enum(PLATFORM_ACTIONS)),
  actor: param(z.uuid()),
  target: param(z.uuid()),
  from: param(z.iso.date()),
  to: param(z.iso.date()),
  cursor: param(z.uuid()),
});
export type AuditParams = z.infer<typeof auditParamsSchema>;

/** The set parameters as a query string, in a fixed order: the page's canonical URL. */
export const auditQuery = (params: AuditParams) =>
  new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ).toString();

export const auditHref = (params: AuditParams) => {
  const query = auditQuery(params);
  return query ? `/ops/audit?${query}` : '/ops/audit';
};

const DAY = 86_400_000;

/** The contract's query: the days as UTC midnights, and the inclusive last day as the exclusive midnight after it. */
export const toEntryQuery = ({ action, actor, target, from, to, cursor }: AuditParams): PlatformEntryQuery => ({
  ...(action && { action }),
  ...(actor && { actorId: actor }),
  ...(target && { targetId: target }),
  ...(from && { from: new Date(`${from}T00:00:00Z`) }),
  ...(to && { to: new Date(Date.parse(`${to}T00:00:00Z`) + DAY) }),
  ...(cursor && { cursor }),
});

/** "2026-11-20 09:30": the entry's time in UTC, which the page states beside it. */
export const utcMinute = (date: Date) => date.toISOString().slice(0, 16).replace('T', ' ');

/** An entry with its operator's display name, or null when the identity user has none (the id stays opaque). */
export type AuditRow = PlatformEntry & { operatorName: string | null };

/** An operator for the filter: opaque id and display name. */
export type AuditOperator = { id: string; name: string };

export type AuditLogView = {
  /** The filter form (absent while loading or after an error), with the values the page was opened with. */
  filters?: { params: AuditParams; operators: AuditOperator[] };
  table:
    | { status: 'loading' }
    | { status: 'error'; onRetry: () => void }
    | {
        status: 'ready';
        rows: AuditRow[];
        /** Whether a filter or a page cursor is set, for "No entries match these filters." */
        filtered: boolean;
        /** The next page's URL, or null on the last page. */
        nextHref: string | null;
      };
};
