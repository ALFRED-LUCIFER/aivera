import type { Tx } from '@credalent/db';
import type { WorkspaceContext } from '@credalent/workspaces';
import type { EvidenceItem, SourceKind } from '../domain/evidence.ts';
import {
  findGaps,
  guardLinks,
  rankChanges,
  sourceText,
  type DiscardReason,
  type EvidenceGap,
  type MapGrade,
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
  ): Promise<void>;
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
  promptVersion: string;
  model: string;
  /** Writes `EvidenceMapped.v1` to the outbox in `tx`. */
  publishMapped(tx: Tx, run: MappingRun): Promise<void>;
  /** Counts only, never text (AGENTS.md 1.2): guard failures and uncited checks show up in telemetry. */
  logMapped(fields: {
    mappingId: string;
    links: number;
    gaps: number;
    discarded: Partial<Record<DiscardReason, number>>;
    uncitedChanges: number;
  }): void;
};

/**
 * The worker job `evidence.mapping` (AIV-P1-027): maps the candidate's recorded evidence to the job's approved rubric
 * version through the model, applies the guards, and stores the links, the gaps and "What would change this" as one
 * run, then writes `EvidenceMapped.v1`. Before a rubric is approved it stores nothing (the evidence stays recorded).
 * A model failure throws, so the consumer retries with back-off and nothing is half-stored.
 */
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
  const aiSources: Parameters<MappingPorts['mapToCompetencies']>[2] = [];
  const synthetic = new Map<string, boolean>();
  for (const [sourceId, own] of bySource) {
    const { source } = own[0] as EvidenceItemView;
    const read = source.kind === 'repository' ? await reads.find(workspaceId, sourceId) : null;
    const measured = read && authorshipOf(read.read);
    // A re-read appends an authorship item and keeps the earlier one as history: only the newest is mapped.
    const excerpts = (read ? own.slice(-1) : own).map((i) => i.excerpt);
    const { text, declarationSpans } = sourceText(
      source.label,
      excerpts,
      grades.filter((g) => g.repositorySourceId === sourceId),
    );
    mapSources.push({
      id: sourceId,
      kind: source.kind,
      authorship: measured && classifyAuthorship(measured),
      declarationSpans,
    });
    aiSources.push({ id: sourceId, kind: AI_KIND[source.kind], text });
    synthetic.set(sourceId, source.synthetic);
  }

  const answer = aiSources.length
    ? await ports.mapToCompetencies(workspaceId, rubric.competencies, aiSources)
    : { links: [], changes: [] };
  const competencyIds = rubric.competencies.map((c) => c.id);
  const mapGrades: MapGrade[] = grades.map((g) => ({ ...g, sourceId: g.repositorySourceId }));
  const { links, discarded } = guardLinks({
    competencyIds,
    sources: mapSources,
    grades: mapGrades,
    links: answer.links,
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
      closes: 'gap' in closes ? { gapId: gapRows[closes.gap]?.id ?? '' } : { itemId: items[closes.link]?.id ?? '' },
      text,
    })),
    createdAt,
  };
  await ports.mappingStoreFor(tx).insert(
    run,
    items,
    links.map((l, i) => ({ itemId: items[i]?.id ?? '', jobId, competencyId: l.competencyId, level: l.level })),
    gapRows,
  );
  await ports.publishMapped(tx, run);
  const counts: Partial<Record<DiscardReason, number>> = {};
  for (const d of discarded) counts[d.reason] = (counts[d.reason] ?? 0) + 1;
  ports.logMapped({
    mappingId,
    links: links.length,
    gaps: gaps.length,
    discarded: counts,
    uncitedChanges: ranked.uncited,
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
