import type { AuditContract } from '@credalent/audit';
import type { Tx } from '@credalent/db/client';
import { and, eq } from 'drizzle-orm';
import type { PublishStore } from '../application/catalogue-publish.ts';
import { evalStore } from './catalogue-eval.ts';
import {
  catalogueJobType,
  cataloguePack,
  cataloguePackCompetency,
  catalogueRegion,
  catalogueRegionalHint,
  catalogueVersion,
} from './schema.ts';

// Children before parents (foreign keys): the reverse of the order a draft is copied in. Eval runs stay: deleting the
// version sets their version to null (migration 0021), so their tokens still count against the day's eval budget.
const DRAFT_ROWS = [
  catalogueRegionalHint,
  cataloguePackCompetency,
  cataloguePack,
  catalogueRegion,
  catalogueJobType,
] as const;
const draftVersion = (version: number) =>
  and(eq(catalogueVersion.version, version), eq(catalogueVersion.status, 'draft'));

/** Publish and discard over one transaction on the app's pool; the platform audit write joins it. */
export function publishStore(tx: Tx, audit: Pick<AuditContract, 'recordPlatform'>): PublishStore {
  const { lockDraft, read, recordPlatform, latestRun } = evalStore(tx, audit);
  return {
    lockDraft,
    read,
    recordPlatform,
    latestRun,

    async publish(version, { operatorId, at, reason }) {
      // From here the freeze triggers (migration 0016) refuse any change to the version's rows.
      await tx
        .update(catalogueVersion)
        .set({ status: 'published', publishedBy: operatorId, publishedAt: at, reason })
        .where(draftVersion(version));
    },

    async discard(version) {
      for (const table of DRAFT_ROWS) await tx.delete(table).where(eq(table.version, version));
      await tx.delete(catalogueVersion).where(draftVersion(version));
    },
  };
}
