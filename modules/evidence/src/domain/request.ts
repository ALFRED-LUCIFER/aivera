// Evidence requests (AIV-P1-037): one request per candidate per job, naming only that candidate's open claims, with a
// follow-up policy. A person makes every first contact (AGENTS.md 1.5): only a user can send a draft; the system may
// only record what happens after (opened, answered, gone quiet).
import type { EvidenceItem } from './evidence.ts';

export const REQUEST_STATUSES = ['draft', 'sent', 'opened', 'answered', 'quiet', 'closed'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Who moves a request: a signed-in user, or the system (the worker, the candidate portal). */
export type RequestActor = 'user' | 'system';

/** The default policy: follow up automatically after 2 days, at most twice. */
export const DEFAULT_FOLLOW_UP = { afterDays: 2, maxCount: 2 } as const;
export const PORTAL_TOKEN_DAYS = 30;

const TRANSITIONS: Record<RequestStatus, Partial<Record<RequestStatus, RequestActor>>> = {
  // Sending is a person's decision; nothing else can make the first contact.
  draft: { sent: 'user', closed: 'user' },
  sent: { opened: 'system', answered: 'system', quiet: 'system', closed: 'user' },
  opened: { answered: 'system', quiet: 'system', closed: 'user' },
  answered: { closed: 'user' },
  quiet: { answered: 'system', closed: 'user' },
  closed: {},
};

/** True when `actor` may move a request from `from` to `to`. */
export function canMove(from: RequestStatus, to: RequestStatus, actor: RequestActor): boolean {
  return TRANSITIONS[from][to] === actor;
}

/** The provenances that mean "rests on a claim": Claim awaiting validation, Awaiting live defence. */
const OPEN_CLAIM: readonly EvidenceItem['provenance'][] = ['claim', 'awaiting-defence'];

export type OpenClaim = { competencyId: string; itemId: string; claim: string };

/**
 * The candidate's open claims for one job: one per competency, from items that rest on a claim, oldest first. Items
 * linked to another job, or that are not claims, never appear, so a request names only this candidate's own claims.
 */
export function openClaims(
  jobId: string,
  items: readonly (Pick<EvidenceItem, 'id' | 'excerpt' | 'provenance'> & {
    competencies: readonly { jobId: string; competencyId: string }[];
  })[],
): OpenClaim[] {
  const byCompetency = new Map<string, OpenClaim>();
  for (const item of items)
    if (OPEN_CLAIM.includes(item.provenance))
      for (const link of item.competencies)
        if (link.jobId === jobId && !byCompetency.has(link.competencyId))
          byCompetency.set(link.competencyId, {
            competencyId: link.competencyId,
            itemId: item.id,
            claim: item.excerpt,
          });
  return [...byCompetency.values()];
}
