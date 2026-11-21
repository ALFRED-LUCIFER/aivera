import {
  CatalogueError,
  discardDraftSchema,
  publishDraftSchema,
  type DiscardDraftInput,
  type PublishDraftInput,
} from '../domain/catalogue-draft.ts';
import { catalogueDiff, diffCounts } from '../domain/catalogue-diff.ts';
import { draftEvalState, evalAllowsPublish, isRunning } from '../domain/catalogue-eval.ts';
import { contentHash } from '../domain/catalogue-hash.ts';
import { begin } from './catalogue-editor.ts';
import type { EvalStore } from './catalogue-eval.ts';

// Publishing or discarding the catalogue draft (AIV-P2-049, ADR-013 points 4, 13 and 14).

export type PublishStore = Pick<EvalStore, 'lockDraft' | 'read' | 'recordPlatform' | 'latestRun'> & {
  /** Makes the draft published version `version`: one row update, so readers switch to it at commit. */
  publish(version: number, by: { operatorId: string; at: Date; reason: string }): Promise<void>;
  /** Deletes the draft version's eval runs and rows. */
  discard(version: number): Promise<void>;
};

export type CataloguePublishPorts = {
  inTransaction<T>(work: (store: PublishStore) => Promise<T>): Promise<T>;
  now: () => Date;
};

export function cataloguePublish({ inTransaction, now }: CataloguePublishPorts) {
  return {
    /**
     * Publishes the draft as the page showed it (`stale` otherwise) with the operator's reason. Refused unless the latest
     * eval run passed on the locked draft's current content (`eval_required`) and the draft changes something
     * (`no_changes`). The draft row lock orders it against every edit, eval request, publish and discard: whichever
     * commits second finds the draft moved on and changes nothing. Audited `catalogue.published`, last.
     */
    publishDraft: async (operatorId: string, raw: PublishDraftInput): Promise<void> => {
      const input = publishDraftSchema.parse(raw);
      return inTransaction(async (store) => {
        const { draft, published, version } = await begin(store, input);
        const at = now();
        // Never the client's word: the state is read here, on the locked draft's content.
        if (!evalAllowsPublish(draftEvalState(contentHash(draft), await store.latestRun(version), at)))
          throw new CatalogueError('eval_required');
        const changes = catalogueDiff(published, draft);
        if (changes.length === 0) throw new CatalogueError('no_changes');
        await store.publish(version, { operatorId, at, reason: input.reason });
        await store.recordPlatform({
          actorId: operatorId,
          action: 'catalogue.published',
          note: input.reason,
          after: {
            catalogueVersion: version,
            publishedVersion: published.version,
            revision: draft.revision,
            ...diffCounts(changes),
          },
        });
      });
    },

    /**
     * Deletes the draft as the page showed it (`stale` otherwise): nothing references a draft (ADR-013 point 4).
     * Refused while an eval run on it is running (`eval_running`), since its worker holds the run. Audited
     * `catalogue.draft_discarded`, last; the next draft reuses the number, so the log tells drafts apart by order:
     * each runs from its `catalogue.draft_opened` to its `catalogue.draft_discarded` or `catalogue.published`.
     */
    discardDraft: async (operatorId: string, raw: DiscardDraftInput): Promise<void> => {
      const input = discardDraftSchema.parse(raw);
      return inTransaction(async (store) => {
        const { draft, published, version } = await begin(store, input);
        if (isRunning(await store.latestRun(version), now())) throw new CatalogueError('eval_running');
        await store.discard(version);
        await store.recordPlatform({
          actorId: operatorId,
          action: 'catalogue.draft_discarded',
          after: { catalogueVersion: version, publishedVersion: published.version, revision: draft.revision },
        });
      });
    },
  };
}
