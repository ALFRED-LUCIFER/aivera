import type { Tx } from '@credalent/db';
import type { Action, WorkspaceContext } from '@credalent/workspaces';
import {
  checkItem,
  checkItems,
  checkLink,
  checkSource,
  EvidenceError,
  type CompetencyLink,
  type EvidenceItem,
  type EvidenceSource,
} from '../domain/evidence.ts';

/** An item with its source and the links to the asked job's competencies. */
export type EvidenceItemView = EvidenceItem & { source: EvidenceSource; competencies: CompetencyLink[] };

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type EvidenceStore = {
  insert(source: EvidenceSource, items: EvidenceItem[], links: (CompetencyLink & { itemId: string })[]): Promise<void>;
  /** False when the workspace has no such item. Linking twice keeps one link, at the latest level. */
  link(workspaceId: string, itemId: string, link: CompetencyLink): Promise<boolean>;
  /** The candidate's items, oldest first; `jobId` set narrows `competencies` to that job's, null keeps every link. */
  list(
    workspaceId: string,
    filter: { candidateId?: string; itemId?: string },
    jobId: string | null,
  ): Promise<EvidenceItemView[]>;
  /** Deletes all the workspace's evidence; false, with nothing deleted, if any source is not synthetic. */
  deleteSynthetic(workspaceId: string): Promise<boolean>;
};

export type Ports = {
  storeFor(tx: Tx): EvidenceStore;
  /** Writes `EvidenceRecorded.v1` to the outbox in `tx`, so it commits only with the evidence. */
  publishRecorded(tx: Tx, source: EvidenceSource, itemIds: string[]): Promise<void>;
  authorize(ctx: WorkspaceContext, action: Action): Promise<void>;
  isSyntheticWorkspace(ctx: WorkspaceContext): Promise<boolean>;
  newId(): string;
  now(): Date;
};

/** One source and the items it backs. Its caller (an importer, a server action) validates the shape with zod. */
export type RecordEvidenceInput = {
  candidateId: string;
  source: Pick<EvidenceSource, 'kind' | 'label' | 'url' | 'blobFileId' | 'capturedAt' | 'checkedAt' | 'checkMethod'>;
  items: (Pick<EvidenceItem, 'excerpt' | 'excerptSpan' | 'provenance' | 'strength' | 'limit'> & {
    competencies?: CompetencyLink[];
  })[];
  /** Required, so no seed or import can forget it (AGENTS.md 1.1); every item takes the source's. */
  synthetic: boolean;
};

export type RecordEvidenceResult = { sourceId: string; itemIds: string[] };

// shortcut: recording and linking are open to admins and recruiters (`candidate.create`), reading to them alone
// (`candidate.view` with no job); hiring owners and interviewers reach a candidate's evidence through an application's
// job once applications land (AIV-P1-017).
export function evidenceUseCases({ storeFor, publishRecorded, authorize, isSyntheticWorkspace, newId, now }: Ports) {
  return {
    async recordEvidence(ctx: WorkspaceContext, input: RecordEvidenceInput): Promise<RecordEvidenceResult> {
      await authorize(ctx, 'candidate.create');
      checkSource(input.source);
      checkItems(input.items);
      input.items.forEach(checkItem);
      input.items.forEach((i) => i.competencies?.forEach(checkLink));
      const createdAt = now();
      const base = {
        workspaceId: ctx.workspaceId,
        candidateId: input.candidateId,
        synthetic: input.synthetic,
        createdAt,
      };
      const source: EvidenceSource = { ...input.source, ...base, id: newId(), label: input.source.label.trim() };
      const items = input.items.map(({ competencies = [], ...item }) => ({
        item: { ...item, ...base, id: newId(), sourceId: source.id } satisfies EvidenceItem,
        competencies,
      }));
      await storeFor(ctx.tx).insert(
        source,
        items.map((i) => i.item),
        items.flatMap((i) => i.competencies.map((c) => ({ ...c, itemId: i.item.id }))),
      );
      const itemIds = items.map((i) => i.item.id);
      await publishRecorded(ctx.tx, source, itemIds);
      return { sourceId: source.id, itemIds };
    },

    async linkToCompetency(ctx: WorkspaceContext, itemId: string, link: CompetencyLink): Promise<void> {
      await authorize(ctx, 'candidate.create');
      checkLink(link);
      if (!(await storeFor(ctx.tx).link(ctx.workspaceId, itemId, link))) throw new EvidenceError('not_found');
    },

    // shortcut: no paging; a candidate holds tens of items, not thousands. Page when the evidence profile needs it.
    async listEvidenceForCandidate(ctx: WorkspaceContext, candidateId: string, jobId: string) {
      await authorize(ctx, 'candidate.view');
      return storeFor(ctx.tx).list(ctx.workspaceId, { candidateId }, jobId);
    },

    async getEvidenceItem(ctx: WorkspaceContext, itemId: string): Promise<EvidenceItemView | null> {
      await authorize(ctx, 'candidate.view');
      const [item] = await storeFor(ctx.tx).list(ctx.workspaceId, { itemId }, null);
      return item ?? null;
    },

    /** The demo seed's reset (AIV-P0-031): admins; refuses a workspace holding any evidence not synthetic. */
    async purgeSyntheticEvidence(ctx: WorkspaceContext): Promise<void> {
      await authorize(ctx, 'workspace.settings');
      if (!(await isSyntheticWorkspace(ctx))) throw new EvidenceError('not_synthetic');
      if (!(await storeFor(ctx.tx).deleteSynthetic(ctx.workspaceId))) throw new EvidenceError('not_synthetic');
    },
  };
}
