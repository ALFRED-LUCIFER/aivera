// When evidence is "Independently corroborated" and when it is "Contradictory" (AIV-P1-029). Pure and deterministic.
// Nothing is called verified unless a second, independent origin supports the same competency; a contradiction is
// never averaged away: the items are withheld from the backed score until a person resolves it (AGENTS.md 1.5, 1.6).
import type { Provenance, SourceKind } from './evidence.ts';
import { precheckNumbers } from './numericCheck.ts';

/** One of the candidate's sources, with what decides whether its origin is independent of the candidate. */
export type OriginSource = {
  id: string;
  kind: SourceKind;
  /** A read repository whose commit history was measured (AIV-P1-026). */
  commitHistory: boolean;
  /** The merged pull requests this source holds (an upstream repository's source); empty for any other source. */
  pullRequests: readonly { repository: string; mergedBy: string | null; selfMerged: boolean }[];
};

/**
 * A pull request merged by someone else into a repository the candidate does not own: a second person judged the work.
 * `logins` are the candidate's own GitHub logins, lower case. A merger GitHub no longer names never counts.
 */
const mergedByAnotherMaintainer = (pr: OriginSource['pullRequests'][number], logins: readonly string[]): boolean =>
  !pr.selfMerged &&
  pr.mergedBy !== null &&
  !logins.includes(pr.mergedBy.toLowerCase()) &&
  !logins.includes(pr.repository.split('/')[0]?.toLowerCase() ?? '');

/**
 * Whether the source is an origin the candidate does not control: a reference call, a measured commit history, or an
 * upstream repository every one of whose pull requests another maintainer merged (one self-merge there means the
 * candidate can merge their own work into it). CVs, documents, write-ups and portal submissions are the candidate's own
 * account; an interview note is not one of the ticket's independent origins (it records what the candidate said), so it
 * never corroborates either.
 */
// shortcut: published benchmarks and employer system records have no source kind yet; add them here with the kind. An
// organisation the candidate controls is not known (only their supplied logins), so its repositories count as others'.
export function isIndependent(source: OriginSource, logins: readonly string[]): boolean {
  if (source.kind === 'reference_call') return true;
  if (source.kind !== 'repository') return false;
  if (source.pullRequests.length) return source.pullRequests.every((pr) => mergedByAnotherMaintainer(pr, logins));
  return source.commitHistory;
}

/** A link the rules read: the competency, the source it cites and the provenance the mapping guards gave it. */
export type RuleLink = { competencyId: string; sourceId: string; provenance: Provenance };

/** The origin of each source: its near-duplicate group (AIV-P1-071), or itself when it is in none. */
const originOf = (groups: readonly (readonly string[])[]) => (sourceId: string) => {
  const group = groups.findIndex((g) => g.includes(sourceId));
  return group >= 0 ? `group:${group}` : `own:${sourceId}`;
};

/**
 * The competencies "Independently corroborated": their Candidate-submitted links come from at least two origins and at
 * least one of those is independent. Near-duplicate sources are one origin, so a re-uploaded write-up never confirms
 * itself; two candidate-authored origins never corroborate each other; claims and `withheld` sources (in an open
 * contradiction) count toward neither.
 */
// shortcut: decided per competency, so every Candidate-submitted link on it becomes corroborated, not only the ones the
// independent source speaks to; narrow it to the claim once the AI comparison (AIV-P1-078) can match claims.
export function corroboratedCompetencies(input: {
  links: readonly RuleLink[];
  sources: readonly OriginSource[];
  originGroups: readonly (readonly string[])[];
  logins: readonly string[];
  withheld?: ReadonlySet<string>;
}): Set<string> {
  const origin = originOf(input.originGroups);
  const independent = new Set(input.sources.filter((s) => isIndependent(s, input.logins)).map((s) => s.id));
  const result = new Set<string>();
  for (const competencyId of new Set(input.links.map((l) => l.competencyId))) {
    const own = input.links.filter(
      (l) => l.competencyId === competencyId && l.provenance === 'submitted' && !input.withheld?.has(l.sourceId),
    );
    const origins = new Set(own.map((l) => origin(l.sourceId)));
    if (origins.size >= 2 && own.some((l) => independent.has(l.sourceId))) result.add(competencyId);
  }
  return result;
}

export const COMPARISON_OUTCOMES = ['agreement', 'contradiction'] as const;
export type ComparisonOutcome = (typeof COMPARISON_OUTCOMES)[number];

/** How a comparison was decided: the numeric pre-check (AIV-P1-029) or the AI comparison (AIV-P1-078). */
export const COMPARISON_METHODS = ['numeric_precheck', 'ai'] as const;
export type ComparisonMethod = (typeof COMPARISON_METHODS)[number];

/**
 * Pairs of links on the same competency, from different origins, whose excerpts the numeric pre-check compared, by
 * index into `links`. A `not_settled` pair is for the AI comparison (AIV-P1-078); a settled one never reaches it.
 */
export function comparablePairs(
  links: readonly (RuleLink & { excerpt: string })[],
  originGroups: readonly (readonly string[])[],
): { a: number; b: number; outcome: ComparisonOutcome | 'not_settled' }[] {
  const origin = originOf(originGroups);
  const pairs: { a: number; b: number; outcome: ComparisonOutcome | 'not_settled' }[] = [];
  links.forEach((first, a) =>
    links.forEach((second, b) => {
      if (b <= a || first.competencyId !== second.competencyId) return;
      if (origin(first.sourceId) === origin(second.sourceId)) return;
      const outcome = precheckNumbers(first.excerpt, second.excerpt);
      if (outcome !== 'not_compared') pairs.push({ a, b, outcome });
    }),
  );
  return pairs;
}

/**
 * A comparison of two cited items' excerpts (AIV-P1-029). An unresolved contradiction shows both items as
 * "Contradictory" and keeps them out of the backed score; a person resolves it with a note and the limit both items
 * then state. An agreement is a recorded fact and changes nothing.
 */
export type Comparison = {
  id: string;
  workspaceId: string;
  candidateId: string;
  jobId: string;
  mappingId: string;
  competencyId: string;
  itemId: string;
  otherItemId: string;
  outcome: ComparisonOutcome;
  method: ComparisonMethod;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  resolutionLimit: string | null;
  createdAt: Date;
};

/** A person's resolution, kept on a re-map when the same two excerpts of the same two sources contradict again. */
export type Resolution = Pick<Comparison, 'resolvedBy' | 'resolvedAt' | 'resolutionNote' | 'resolutionLimit'>;

/** The key of a pair of cited excerpts, the same in either order. */
export const pairKey = (a: { sourceId: string; excerpt: string }, b: { sourceId: string; excerpt: string }) =>
  [a, b]
    .map((x) => `${x.sourceId}\u0000${x.excerpt}`)
    .toSorted()
    .join('\u0001');

/** The provenance and limit an item shows: "Contradictory" while a contradiction on it is open, else its own. */
export function shownAs(
  item: { id: string; provenance: Provenance; limit: string },
  comparisons: readonly Comparison[],
): { provenance: Provenance; limit: string } {
  const own = comparisons.filter(
    (c) => c.outcome === 'contradiction' && (c.itemId === item.id || c.otherItemId === item.id),
  );
  if (own.some((c) => c.resolvedAt === null)) return { provenance: 'contradictory', limit: item.limit };
  const latest = own.toSorted((x, y) => (y.resolvedAt?.getTime() ?? 0) - (x.resolvedAt?.getTime() ?? 0))[0];
  return { provenance: item.provenance, limit: latest?.resolutionLimit ?? item.limit };
}
