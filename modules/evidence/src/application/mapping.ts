import type { Tx } from '@credalent/db';
import type { WorkspaceContext } from '@credalent/workspaces';
import {
  comparablePairs,
  corroboratedCompetencies,
  pairKey,
  type Comparison,
  type ComparisonMethod,
  type ComparisonOutcome,
  type OriginSource,
  type Resolution,
  type RuleLink,
} from '../domain/corroboration.ts';
import type { EvidenceItem, SourceKind } from '../domain/evidence.ts';
import { groupOrigins } from '../domain/fingerprint.ts';
import {
  findGaps,
  guardLinks,
  rankChanges,
  settleProvenance,
  sourceText,
  type DiscardReason,
  type EvidenceGap,
  type MapGrade,
  type MappedLink,
  type MapSource,
  type ModelLink,
  type StoredChange,
} from '../domain/mapping.ts';
import { classifyAuthorship } from '../domain/repository.ts';
import type { EvidenceItemView, Ports } from './evidence.ts';
import { type ApprovedRubricPort, authorshipOf, gradeSources, type RepositoryReadStore } from './repositoryRead.ts';

/** One mapping run (AIV-P1-027): the rubric version, prompt and model its links rest on, and its checks. */
export type MappingRun = {
  id: string;
  workspaceId: string;
  candidateId: string;
  jobId: string;
  rubricVersionId: string;
  promptVersion: string;
  model: string;
  changes: StoredChange[];
  createdAt: Date;
};

export type EvidenceGapRow = EvidenceGap & { id: string; workspaceId: string; mappingId: string };

/** The candidate's newest mapping run for a job, with its evidence gaps; read by AIV-P1-037, AIV-P1-038, AIV-P2-003. */
export type EvidenceMappingView = MappingRun & { gaps: EvidenceGapRow[] };

/** Over one workspace-scoped transaction; every method filters by `workspaceId`. */
export type MappingStore = {
  insert(
    run: MappingRun,
    items: (EvidenceItem & { mappingId: string })[],
    links: { itemId: string; jobId: string; competencyId: string; level: number }[],
    gaps: EvidenceGapRow[],
    comparisons: Comparison[],
  ): Promise<void>;
  /** Resolved contradictions of the candidate's earlier runs for the job, by `pairKey` of their two cited excerpts. */
  resolutions(workspaceId: string, candidateId: string, jobId: string): Promise<Map<string, Resolution>>;
  /** `pairKey`s of every pair the AI comparison flagged in the candidate's earlier runs for the job (AIV-P1-078). */
  aiFlags(workspaceId: string, candidateId: string, jobId: string): Promise<Set<string>>;
  newest(workspaceId: string, candidateId: string, jobId: string): Promise<EvidenceMappingView | null>;
};

/** The source kinds as the citation contract names them (@credalent/ai). */
const AI_KIND = {
  cv: 'cv',
  repository: 'repo',
  document: 'document',
  shipped_product: 'document',
  portal_submission: 'document',
  reference_call: 'reference',
  interview_note: 'interview',
} as const satisfies Record<SourceKind, string>;

export type MappingPorts = Pick<Ports, 'storeFor' | 'newId' | 'now'> & {
  readStoreFor(tx: Tx): RepositoryReadStore;
  mappingStoreFor(tx: Tx): MappingStore;
  approvedRubric: ApprovedRubricPort;
  /** The `evidence.mapToCompetency` call through `@credalent/ai`; quotes are checked by its citation contract. */
  mapToCompetencies(
    workspaceId: string,
    competencies: { id: string; name: string; evidenceExpected: string }[],
    sources: { id: string; kind: (typeof AI_KIND)[SourceKind]; text: string }[],
  ): Promise<{ links: ModelLink[]; changes: { competencyId: string; text: string }[] }>;
  /**
   * The `evidence.compareExcerpts` call through `@credalent/ai` (AIV-P1-078): the indexes into `pairs` the model flags
   * as contradicting, each citing both excerpts; null when its answer was rejected by the citation contract or schema.
   */
  compareExcerpts(
    workspaceId: string,
    sources: { id: string; kind: (typeof AI_KIND)[SourceKind]; text: string }[],
    pairs: [string, string][],
  ): Promise<number[] | null>;
  promptVersion: string;
  model: string;
  /** Writes `EvidenceMapped.v1` to the outbox in `tx`. */
  publishMapped(tx: Tx, run: MappingRun): Promise<void>;
  /** Counts only, never text (AGENTS.md 1.2): guard failures and uncited checks show up in telemetry. */
  logMapped(fields: {
    mappingId: string;
    links: number;
    gaps: number;
    contradictions: number;
    discarded: Partial<Record<DiscardReason, number>>;
    uncitedChanges: number;
    /** Pairs sent to the AI comparison, flagged by it, and left uncompared because its answer was rejected. */
    compared: { sent: number; flagged: number; rejected: number };
  }): void;
};

type ComparedPair = { a: number; b: number; outcome: ComparisonOutcome; method: ComparisonMethod };

/**
 * Pre-checks every pair of links on one competency from different origins (AIV-P1-029); the pairs it leaves
 * `not_settled` go to the model in one call for the candidate and job (AIV-P1-078), and only its flags are kept, as
 * contradictions. A settled pair never reaches the model. A pair the model flagged in an earlier run (`flagged`, by
 * `pairKey`) stays a contradiction without a new call, so only a person's resolution ends it, never a later answer that
 * leaves it out or is rejected. A rejected answer stores no new AI contradiction.
 */
// shortcut: a pair with no number on either side (`not_compared`) is never sent, so a conflict in words alone ("led the
// team" against "a junior contributor") is missed; send those too if pilot resolutions show misses.
// shortcut: every run sends its unflagged unsettled pairs again; cache "not contradicting" verdicts by `pairKey` if pilot
// token use shows it.
export async function comparePairs(
  links: readonly (RuleLink & { excerpt: string })[],
  originGroups: readonly (readonly string[])[],
  flagged: ReadonlySet<string>,
  kindOf: (sourceId: string) => (typeof AI_KIND)[SourceKind],
  compare: (
    sources: Parameters<MappingPorts['compareExcerpts']>[1],
    pairs: [string, string][],
  ) => Promise<number[] | null>,
): Promise<{ pairs: ComparedPair[]; compared: { sent: number; flagged: number; rejected: number } }> {
  const pairs = comparablePairs(links, originGroups);
  const settled: ComparedPair[] = pairs.flatMap((p) =>
    p.outcome === 'not_settled' ? [] : [{ ...p, outcome: p.outcome, method: 'numeric_precheck' as const }],
  );
  const linkAt = (i: number) => links[i] as RuleLink & { excerpt: string };
  const isKnown = (p: { a: number; b: number }) => flagged.has(pairKey(linkAt(p.a), linkAt(p.b)));
  const known: ComparedPair[] = pairs.flatMap((p) =>
    p.outcome === 'not_settled' && isKnown(p) ? [{ a: p.a, b: p.b, outcome: 'contradiction', method: 'ai' }] : [],
  );
  const unsettled = pairs.filter((p) => p.outcome === 'not_settled' && !isKnown(p));
  if (!unsettled.length) return { pairs: [...settled, ...known], compared: { sent: 0, flagged: 0, rejected: 0 } };
  const sources = [...new Set(unsettled.flatMap((p) => [p.a, p.b]))].map((i) => {
    const link = linkAt(i);
    return { id: String(i), kind: kindOf(link.sourceId), text: link.excerpt };
  });
  const answer = await compare(
    sources,
    unsettled.map((p) => [String(p.a), String(p.b)]),
  );
  const ai = (answer ?? []).flatMap((i) => {
    const pair = unsettled[i];
    return pair ? [{ a: pair.a, b: pair.b, outcome: 'contradiction' as const, method: 'ai' as const }] : [];
  });
  return {
    pairs: [...settled, ...known, ...ai],
    compared: { sent: unsettled.length, flagged: ai.length, rejected: answer ? 0 : unsettled.length },
  };
}

const idOf = (rows: readonly { id: string }[], i: number) => {
  const row = rows[i];
  if (!row) throw new Error('mapping row index out of range');
  return row.id;
};

/**
 * The worker job `evidence.mapping` (AIV-P1-027): maps the candidate's recorded evidence to the job's approved rubric
 * version through the model, applies the guards, and stores the links, the gaps and "What would change this" as one
 * run, then writes `EvidenceMapped.v1`. Before a rubric is approved it stores nothing (the evidence stays recorded).
 * A transient model failure throws, so the consumer retries with back-off; an out-of-budget or permanently rejected answer is rescheduled or dead-lettered by the handler.
 */
// shortcut: an invented quote rejects the whole answer (citation contract), so a model repeating it dead-letters the
// candidate's mapping; drop only that link if pilot telemetry shows it happening.
// shortcut: the model call runs inside the consumer's workspace transaction, as the GitHub reads do; call it before
// opening the write transaction if pilot mappings hold connections too long.
export async function mapEvidence(
  ports: MappingPorts,
  tx: Tx,
  workspaceId: string,
  candidateId: string,
  jobId: string,
): Promise<MappingRun | null> {
  const rubric = await ports.approvedRubric(tx, workspaceId, jobId);
  if (!rubric) return null;
  const reads = ports.readStoreFor(tx);
  // Grades exist only after grading against this version (AIV-P1-072); stored signals are enough, no GitHub call.
  await gradeSources(reads, workspaceId, candidateId, rubric);
  const grades = await reads.listGrades(workspaceId, candidateId, rubric.id);

  const bySource = new Map<string, EvidenceItemView[]>();
  for (const i of await ports.storeFor(tx).list(workspaceId, { candidateId, unmapped: true }, null))
    bySource.set(i.sourceId, [...(bySource.get(i.sourceId) ?? []), i]);
  const mapSources: MapSource[] = [];
  const originSources: OriginSource[] = [];
  const { logins, pulls } = await reads.pullRequestOrigins(workspaceId, candidateId);
  const aiSources: Parameters<MappingPorts['mapToCompetencies']>[2] = [];
  const synthetic = new Map<string, boolean>();
  for (const [sourceId, own] of bySource) {
    const { source } = own[0] as EvidenceItemView;
    const read = source.kind === 'repository' ? await reads.find(workspaceId, sourceId) : null;
    const measured = read && authorshipOf(read.read);
    // A re-read appends an authorship item and keeps the earlier one as history: only the newest is mapped.
    const excerpts = (read ? own.slice(-1) : own).map((i) => i.excerpt);
    // A recruiter-typed label could carry a name (AGENTS.md 3.12): only a repository's own name goes to the model.
    const { text, declarationSpans } = sourceText(
      source.kind === 'repository' ? source.label : source.kind,
      excerpts,
      grades.filter((g) => g.repositorySourceId === sourceId),
    );
    mapSources.push({
      id: sourceId,
      kind: source.kind,
      authorship: measured && classifyAuthorship(measured),
      hasLogin: !!read?.read.githubLogin,
      declarationSpans,
    });
    originSources.push({
      id: sourceId,
      kind: source.kind,
      commitHistory: !!measured,
      pullRequests: pulls.filter((pr) => pr.sourceId === sourceId),
    });
    aiSources.push({ id: sourceId, kind: AI_KIND[source.kind], text });
    synthetic.set(sourceId, source.synthetic);
  }

  const answer = aiSources.length
    ? await ports.mapToCompetencies(workspaceId, rubric.competencies, aiSources)
    : { links: [], changes: [] };
  const competencyIds = rubric.competencies.map((c) => c.id);
  const mapGrades: MapGrade[] = grades.map((g) => ({ ...g, sourceId: g.repositorySourceId }));
  const guarded = guardLinks({
    competencyIds,
    sources: mapSources,
    grades: mapGrades,
    links: answer.links,
  });
  const { discarded } = guarded;
  // AIV-P1-029: the only place a link becomes "Independently corroborated"; near-duplicates are one origin.
  const originGroups = groupOrigins(await ports.storeFor(tx).fingerprints(workspaceId, candidateId));
  const resolutions = await ports.mappingStoreFor(tx).resolutions(workspaceId, candidateId, jobId);
  const aiFlags = await ports.mappingStoreFor(tx).aiFlags(workspaceId, candidateId, jobId);
  const kinds = new Map(mapSources.map((s) => [s.id, AI_KIND[s.kind]]));
  const { pairs: compared, compared: comparedCounts } = await comparePairs(
    guarded.links,
    originGroups,
    aiFlags,
    // Never undefined: the guards dropped every link citing a source that is not in `mapSources`.
    (sourceId) => kinds.get(sourceId) ?? 'document',
    (sources, unsettled) => ports.compareExcerpts(workspaceId, sources, unsettled),
  );
  const pairs = compared.map((pair) => ({
    ...pair,
    // A person's resolution of the same two excerpts stands on a re-map; it is not asked for again.
    resolved:
      pair.outcome === 'contradiction'
        ? resolutions.get(pairKey(guarded.links[pair.a] as MappedLink, guarded.links[pair.b] as MappedLink))
        : undefined,
  }));
  // A source in an open contradiction vouches for nothing until a person resolves it.
  const open = pairs
    .filter((p) => p.outcome === 'contradiction' && !p.resolved)
    .map((p) => [guarded.links[p.a]?.sourceId ?? '', guarded.links[p.b]?.sourceId ?? '']);
  const withheld = new Set(open.flat());
  const rules = { links: guarded.links, sources: originSources, originGroups, logins };
  const corroborated = corroboratedCompetencies({ ...rules, withheld });
  // A withheld link shows "Contradictory" while its contradiction is open, then its stored provenance, with no re-map
  // after a resolution: so it is stored as it settles once its own contradictions are resolved, every other open one
  // still withheld (never as the claim its withholding made it, never vouched for by a source still in dispute).
  const links = guarded.links.map((l) => {
    if (!withheld.has(l.sourceId)) return settleProvenance([l], mapSources, corroborated)[0] ?? l;
    const stillHeld = new Set(open.filter((p) => !p.includes(l.sourceId)).flat());
    return settleProvenance([l], mapSources, corroboratedCompetencies({ ...rules, withheld: stillHeld }))[0] ?? l;
  });
  const gaps = findGaps(competencyIds, links, mapGrades);
  const ranked = rankChanges({
    competencies: rubric.competencies.map((c) => ({ id: c.id, weight: c.weightPercent })),
    gaps,
    links,
    suggested: answer.changes,
  });

  const createdAt = ports.now();
  const mappingId = ports.newId();
  const items = links.map((l) => ({
    id: ports.newId(),
    workspaceId,
    sourceId: l.sourceId,
    candidateId,
    excerpt: l.excerpt,
    // shortcut: the span indexes the text the model saw (the source's excerpts and signal lines), so none is stored;
    // store it once mapping reads the source's own text (CV parsing, AIV-P1-025).
    excerptSpan: null,
    provenance: l.provenance,
    strength: l.strength,
    limit: l.limit,
    synthetic: synthetic.get(l.sourceId) ?? true,
    createdAt,
    mappingId,
  }));
  const gapRows = gaps.map((g) => ({ ...g, id: ports.newId(), workspaceId, mappingId }));
  const comparisons: Comparison[] = pairs.map(({ a, b, outcome, method, resolved }) => {
    return {
      id: ports.newId(),
      workspaceId,
      candidateId,
      jobId,
      mappingId,
      competencyId: (links[a] as MappedLink).competencyId,
      itemId: idOf(items, a),
      otherItemId: idOf(items, b),
      outcome,
      method,
      resolvedBy: resolved?.resolvedBy ?? null,
      resolvedAt: resolved?.resolvedAt ?? null,
      resolutionNote: resolved?.resolutionNote ?? null,
      resolutionLimit: resolved?.resolutionLimit ?? null,
      createdAt,
    };
  });
  const run: MappingRun = {
    id: mappingId,
    workspaceId,
    candidateId,
    jobId,
    rubricVersionId: rubric.id,
    promptVersion: ports.promptVersion,
    model: ports.model,
    changes: ranked.changes.map(({ competencyId, closes, text }) => ({
      competencyId,
      closes: 'gap' in closes ? { gapId: idOf(gapRows, closes.gap) } : { itemId: idOf(items, closes.link) },
      text,
    })),
    createdAt,
  };
  await ports.mappingStoreFor(tx).insert(
    run,
    items,
    links.map((l, i) => ({ itemId: idOf(items, i), jobId, competencyId: l.competencyId, level: l.level })),
    gapRows,
    comparisons,
  );
  await ports.publishMapped(tx, run);
  const counts: Partial<Record<DiscardReason, number>> = {};
  for (const d of discarded) counts[d.reason] = (counts[d.reason] ?? 0) + 1;
  ports.logMapped({
    mappingId,
    links: links.length,
    gaps: gaps.length,
    contradictions: comparisons.filter((c) => c.outcome === 'contradiction').length,
    discarded: counts,
    uncitedChanges: ranked.uncited,
    compared: comparedCounts,
  });
  return run;
}

export function mappingUseCases(ports: Pick<Ports, 'authorize'> & { mappingStoreFor(tx: Tx): MappingStore }) {
  return {
    async getEvidenceMapping(
      ctx: WorkspaceContext,
      candidateId: string,
      jobId: string,
    ): Promise<EvidenceMappingView | null> {
      await ports.authorize(ctx, 'candidate.view', { jobId });
      return ports.mappingStoreFor(ctx.tx).newest(ctx.workspaceId, candidateId, jobId);
    },
  };
}
