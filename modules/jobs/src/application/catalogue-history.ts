import { z } from 'zod';
import { catalogueDiff, diffCounts, type CatalogueChange } from '../domain/catalogue-diff.ts';
import type { EditorVersion } from '../domain/catalogue-draft.ts';
import type { EvalRunStatus } from '../domain/catalogue-eval.ts';

// The catalogue's version history at /ops/catalogue/versions (AIV-P2-050, ADR-013 point 13): every published version
// with what it changed against the version before. Read-only: published versions never change (point 4).

/** Who published version 1, the seed from code (migration 0017). */
export const SEED_ACTOR = 'system:seed';

/** Versions per page of the history. */
export const HISTORY_PAGE_SIZE = 20;

/** One published version in the list. `counts` is null for the first version, which has nothing before it. */
export type CatalogueVersionSummary = {
  readonly version: number;
  readonly publishedAt: Date;
  /** An operator's opaque id, or `SEED_ACTOR` for version 1. */
  readonly publishedBy: string;
  readonly reason: string;
  readonly counts: ReturnType<typeof diffCounts> | null;
  /** The status of the version's last eval run (the one that allowed the publish); null when it had none. */
  readonly evalStatus: EvalRunStatus | null;
};

/** One published version with its entries and its diff against the version before (null for the first). */
export type CatalogueVersionDetail = {
  readonly summary: CatalogueVersionSummary;
  readonly version: EditorVersion;
  readonly changes: readonly CatalogueChange[] | null;
};

export type HistoryStore = {
  /** One page of published version numbers, newest first, and how many published versions there are. */
  page(offset: number, limit: number): Promise<{ total: number; versions: number[] }>;
  /** Published version `version`, or the newest published one before it (`before`); null when none. */
  read(version: number, before?: 'before'): Promise<EditorVersion | null>;
  latestRunStatus(version: number): Promise<EvalRunStatus | null>;
};

export type CatalogueHistoryPorts = {
  /** One repeatable-read, read-only snapshot. */
  inSnapshot<T>(work: (store: HistoryStore) => Promise<T>): Promise<T>;
};

// `version` is an int4 column.
const positive = z.number().int().positive().max(2_147_483_647);

async function summary(store: HistoryStore, version: EditorVersion, before: EditorVersion | null) {
  const { publishedAt, publishedBy, reason } = version;
  // The database check holds these for every published row (catalogue_version_published_check).
  if (!publishedAt || !publishedBy || !reason) throw new Error('published version without its publisher');
  const changes = before && catalogueDiff(before, version);
  const row: CatalogueVersionSummary = {
    version: version.version,
    publishedAt,
    publishedBy,
    reason,
    counts: changes && diffCounts(changes),
    evalStatus: await store.latestRunStatus(version.version),
  };
  return { row, changes };
}

export function catalogueHistory({ inSnapshot }: CatalogueHistoryPorts) {
  return {
    /** Page `page` (from 1) of the published versions, newest first. */
    listVersions: async (page: number): Promise<{ total: number; rows: CatalogueVersionSummary[] }> => {
      const offset = (positive.parse(page) - 1) * HISTORY_PAGE_SIZE;
      return inSnapshot(async (store) => {
        const { total, versions } = await store.page(offset, HISTORY_PAGE_SIZE);
        // shortcut: reads every version on the page in full to count its diff (21 reads a page); store the counts with
        // the version if the history grows long enough to show in the page's latency.
        const read: EditorVersion[] = [];
        for (const v of versions) {
          const version = await store.read(v);
          if (!version) throw new Error('published version not found');
          read.push(version);
        }
        const last = versions.at(-1);
        const beforePage = last === undefined ? null : await store.read(last, 'before');
        const rows: CatalogueVersionSummary[] = [];
        for (const [i, version] of read.entries())
          rows.push((await summary(store, version, read[i + 1] ?? beforePage)).row);
        return { total, rows };
      });
    },

    /** Published version `version` with its diff against the one before; null when no published version has it. */
    getVersion: async (version: number): Promise<CatalogueVersionDetail | null> => {
      const n = positive.parse(version);
      return inSnapshot(async (store) => {
        const current = await store.read(n);
        if (!current) return null;
        const { row, changes } = await summary(store, current, await store.read(n, 'before'));
        return { summary: row, version: current, changes };
      });
    },
  };
}
