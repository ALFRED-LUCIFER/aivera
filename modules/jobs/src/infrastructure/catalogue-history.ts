import type { Tx } from '@credalent/db/client';
import { count, desc, eq, lt, sql } from 'drizzle-orm';
import type { HistoryStore } from '../application/catalogue-history.ts';
import { readCatalogueVersion } from './catalogue.ts';
import { catalogueEvalRun, catalogueVersion } from './schema.ts';

const isPublished = eq(catalogueVersion.status, 'published');

/** The version history's reads over one read-only snapshot on the app's pool (AIV-P2-050). */
export function historyStore(tx: Tx): HistoryStore {
  return {
    async page(offset, limit) {
      const [total] = await tx.select({ n: count() }).from(catalogueVersion).where(isPublished);
      const rows = await tx
        .select({ version: catalogueVersion.version })
        .from(catalogueVersion)
        .where(isPublished)
        .orderBy(desc(catalogueVersion.version))
        .limit(limit)
        .offset(offset);
      return { total: total?.n ?? 0, versions: rows.map((r) => r.version) };
    },

    read: (version, before) =>
      readCatalogueVersion(
        tx,
        sql`${isPublished} and ${before ? lt(catalogueVersion.version, version) : eq(catalogueVersion.version, version)}`,
      ),

    async latestRunStatus(version) {
      const [row] = await tx
        .select({ status: catalogueEvalRun.status })
        .from(catalogueEvalRun)
        .where(eq(catalogueEvalRun.version, version))
        .orderBy(desc(catalogueEvalRun.requestedAt), desc(catalogueEvalRun.id))
        .limit(1);
      return row?.status ?? null;
    },
  };
}
