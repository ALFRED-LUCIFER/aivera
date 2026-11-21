import type { NewPlatformEntry } from '@credalent/audit';
import {
  assertCompetencyFits,
  assertFairCompetency,
  assertFairHint,
  assertFairStarters,
  CatalogueError,
  draftCompetencySchema,
  draftHintSchema,
  draftJobTypeSchema,
  draftPackSchema,
  isHintNewInDraft,
  isNewInDraft,
  placeJobType,
  retireEntrySchema,
  type CatalogueEditorView,
  type DraftCompetencyInput,
  type DraftHintInput,
  type DraftJobTypeInput,
  type DraftPackInput,
  type RetireEntryInput,
} from '../domain/catalogue-draft.ts';

/** One transaction's view of the catalogue tables; the platform audit write joins it. */
export type DraftStore = {
  /** The latest published version and the open draft, read after `lockDraft`. */
  read(): Promise<CatalogueEditorView>;
  /** The open draft's row, locked for this transaction; null when none is open. */
  lockDraft(): Promise<{ version: number; revision: number; revisedBy: string | null } | null>;
  /** Copies published version `from` into a new draft numbered `to`, created by `operatorId` at `createdAt`. */
  createDraft(from: number, to: number, operatorId: string, createdAt: Date): Promise<void>;
  /** One more revision, by `operatorId`. */
  touch(version: number, operatorId: string): Promise<void>;
  /** Inserts the pack at the end, or updates `previousKey`'s label and key, moving its entries with it. */
  putPack(version: number, previousKey: string | null, pack: { key: string; label: string }): Promise<void>;
  /** Inserts the competency at the pack's end (`position` null) or updates it; returns its position. */
  putCompetency(version: number, input: Omit<DraftCompetencyInput, 'revision' | 'version'>): Promise<number>;
  /** Inserts the hint at the end of its pack's region (`position` null) or updates it; returns its position. */
  putHint(version: number, input: Omit<DraftHintInput, 'revision' | 'version'>): Promise<number>;
  /** Whether any catalogue version, the draft included, holds this job type key. */
  jobTypeKeyUsed(key: string): Promise<boolean>;
  /** Inserts (`adding`) or updates the job type's English texts and starters, then orders the job types as `order`. */
  putJobType(
    version: number,
    input: Pick<DraftJobTypeInput, 'adding' | 'key' | 'label' | 'evidence' | 'starters'>,
    order: readonly string[],
  ): Promise<void>;
  /** Marks the entry retired. */
  retire(version: number, entry: DraftEntry): Promise<void>;
  /** Deletes the entry; a pack with its competencies and hints. */
  remove(version: number, entry: DraftEntry): Promise<void>;
  recordPlatform(entry: NewPlatformEntry): Promise<void>;
};

/** A retire or remove target without the save's version and revision. */
export type DraftEntry =
  | { entry: 'pack'; packKey: string }
  | { entry: 'competency'; packKey: string; position: number }
  | { entry: 'regionalHint'; packKey: string; region: string; position: number }
  | { entry: 'jobType'; jobTypeKey: string };

export type CatalogueEditorPorts = {
  inTransaction<T>(work: (store: DraftStore) => Promise<T>): Promise<T>;
  /** One repeatable-read, read-only snapshot, for the page's read. */
  inSnapshot<T>(work: (store: DraftStore) => Promise<T>): Promise<T>;
  now: () => Date;
};

/**
 * Locks the draft and refuses a save made on another draft or an older revision; returns the draft and what to audit
 * with it.
 */
const begin = async (store: DraftStore, { version, revision }: { version: number; revision: number }) => {
  const draft = await store.lockDraft();
  if (!draft) throw new CatalogueError('no_draft');
  if (draft.version !== version || draft.revision !== revision)
    throw new CatalogueError('stale', { by: draft.revisedBy });
  const view = await store.read();
  if (!view.draft) throw new CatalogueError('no_draft');
  return { ...view, draft: view.draft, version: draft.version, next: draft.revision + 1 };
};
const audit = (operatorId: string, action: NewPlatformEntry['action'], after: Record<string, string | number>) => ({
  actorId: operatorId,
  action,
  after,
});

/**
 * The catalogue draft's use cases (ADR-013 points 3 to 6, 11 and 14). The operator id comes from the session through
 * `platformOperator()`, never from the form. Every save names the revision it read; a newer one refuses it (`stale`),
 * and the audit entry is the last write of its transaction.
 */
export function catalogueEditor({ inTransaction, inSnapshot, now }: CatalogueEditorPorts) {
  return {
    getEditor: (): Promise<CatalogueEditorView> => inSnapshot((store) => store.read()),

    /** "Start a draft": a copy of the latest published version. At most one draft is open (`draft_open`). */
    openDraft: (operatorId: string): Promise<void> =>
      inTransaction(async (store) => {
        if (await store.lockDraft()) throw new CatalogueError('draft_open');
        const { published } = await store.read();
        const version = published.version + 1;
        await store.createDraft(published.version, version, operatorId, now());
        await store.recordPlatform(
          audit(operatorId, 'catalogue.draft_opened', {
            catalogueVersion: version,
            publishedVersion: published.version,
          }),
        );
      }),

    /** Adds a pack, or edits its label; its key only while it is new in the draft (`key_fixed`), never to one in use. */
    saveDraftPack: async (operatorId: string, raw: DraftPackInput): Promise<void> => {
      const input = draftPackSchema.parse(raw);
      return inTransaction(async (store) => {
        const { draft, published, version, next } = await begin(store, input);
        const { previousKey, key } = input;
        const before = previousKey === null ? null : draft.packs.find((p) => p.key === previousKey);
        if (before === undefined) throw new CatalogueError('not_found');
        if (before?.retired) throw new CatalogueError('entry_retired');
        if (previousKey !== key) {
          if (previousKey !== null && !isNewInDraft(published, previousKey))
            throw new CatalogueError('key_fixed', { field: 'key' });
          // The draft holds every key ever published (retired, never deleted), so this also refuses reuse.
          if (draft.packs.some((p) => p.key === key)) throw new CatalogueError('key_taken', { field: 'key' });
        }
        await store.touch(version, operatorId);
        await store.putPack(version, previousKey, { key, label: input.label });
        await store.recordPlatform(
          audit(operatorId, previousKey === null ? 'catalogue.entry_added' : 'catalogue.entry_edited', {
            catalogueVersion: version,
            revision: next,
            entry: 'pack',
            packKey: key,
          }),
        );
      });
    },

    /** Adds or edits a pack competency after the fairness check (ADR-013 point 11) and the core limit. */
    saveDraftCompetency: async (operatorId: string, raw: DraftCompetencyInput): Promise<void> => {
      const parsed = draftCompetencySchema.parse(raw);
      const { revision: _revision, version: _version, ...input } = parsed;
      assertFairCompetency(input);
      return inTransaction(async (store) => {
        const { draft, version, next } = await begin(store, parsed);
        const pack = draft.packs.find((p) => p.key === input.packKey);
        const before = pack?.competencies.find((c) => c.position === input.position);
        if (!pack || (input.position !== null && !before)) throw new CatalogueError('not_found');
        if (pack.retired) throw new CatalogueError('pack_retired');
        if (before?.retired) throw new CatalogueError('entry_retired');
        assertCompetencyFits(draft, pack, parsed);
        await store.touch(version, operatorId);
        const position = await store.putCompetency(version, input);
        await store.recordPlatform(
          audit(operatorId, input.position === null ? 'catalogue.entry_added' : 'catalogue.entry_edited', {
            catalogueVersion: version,
            revision: next,
            entry: 'competency',
            packKey: pack.key,
            position,
          }),
        );
      });
    },

    /**
     * Adds or edits a pack's regional hint (AIV-P2-046) after the residency and fairness checks: always desirable, for
     * a region of the draft that is not retired, on job types the draft offers.
     */
    saveDraftHint: async (operatorId: string, raw: DraftHintInput): Promise<void> => {
      const parsed = draftHintSchema.parse(raw);
      const { revision: _revision, version: _version, ...input } = parsed;
      assertFairHint(input);
      return inTransaction(async (store) => {
        const { draft, version, next } = await begin(store, parsed);
        const pack = draft.packs.find((p) => p.key === input.packKey);
        const region = draft.regions.find((r) => r.key === input.region);
        const before = pack?.hints.find((h) => h.region === input.region && h.position === input.position);
        if (!pack || !region || region.retired || (input.position !== null && !before))
          throw new CatalogueError('not_found');
        if (pack.retired) throw new CatalogueError('pack_retired');
        if (before?.retired) throw new CatalogueError('entry_retired');
        // A hint has no core, so this checks its job types only; a retired one it already had stays on it.
        assertCompetencyFits(draft, pack, { ...parsed, core: [] }, before?.appliesTo ?? []);
        await store.touch(version, operatorId);
        const position = await store.putHint(version, input);
        await store.recordPlatform(
          audit(operatorId, input.position === null ? 'catalogue.entry_added' : 'catalogue.entry_edited', {
            catalogueVersion: version,
            revision: next,
            entry: 'regionalHint',
            packKey: pack.key,
            region: region.key,
            position,
          }),
        );
      });
    },

    /**
     * Adds a job type, or edits its English label, evidence and starters, and places it in the Add a job list. Its key
     * is never reused (ADR-013 point 5); its starters pass the fairness check. A new job type is in no pack until the
     * competency form adds it, so the core limit holds.
     */
    saveDraftJobType: async (operatorId: string, raw: DraftJobTypeInput): Promise<void> => {
      const input = draftJobTypeSchema.parse(raw);
      assertFairStarters(input.starters);
      return inTransaction(async (store) => {
        const { draft, version, next } = await begin(store, input);
        const before = draft.jobTypes.find((t) => t.key === input.key);
        if (input.adding) {
          // Every version, not only the draft: a key any version still holds is never reused, retired ones included.
          if (await store.jobTypeKeyUsed(input.key)) throw new CatalogueError('key_taken', { field: 'key' });
        } else if (!before) throw new CatalogueError('not_found');
        else if (before.retired) throw new CatalogueError('entry_retired');
        await store.touch(version, operatorId);
        await store.putJobType(version, input, placeJobType(draft.jobTypes, input.key, input.position));
        await store.recordPlatform(
          audit(operatorId, input.adding ? 'catalogue.entry_added' : 'catalogue.entry_edited', {
            catalogueVersion: version,
            revision: next,
            entry: 'jobType',
            jobTypeKey: input.key,
          }),
        );
      });
    },

    /**
     * Retires a pack, competency, job type or regional hint a published version holds, or removes one new in this draft (ADR-013
     * point 6). Returns which it did.
     */
    retireDraftEntry: async (operatorId: string, raw: RetireEntryInput): Promise<'retired' | 'removed'> => {
      const parsed = retireEntrySchema.parse(raw);
      const { revision: _revision, version: _version, ...entry } = parsed;
      return inTransaction(async (store) => {
        const { draft, published, version, next } = await begin(store, parsed);
        let removed: boolean;
        if (entry.entry === 'jobType') {
          const target = draft.jobTypes.find((t) => t.key === entry.jobTypeKey);
          if (!target) throw new CatalogueError('not_found');
          if (target.retired) throw new CatalogueError('entry_retired');
          removed = !published.jobTypes.some((t) => t.key === entry.jobTypeKey);
          // A removed key must leave no pack entry pointing at it; a retired one stays readable, so it may.
          const used = draft.packs.some((p) =>
            [...p.competencies, ...p.hints].some((c) => c.appliesTo.includes(entry.jobTypeKey)),
          );
          if (removed && used) throw new CatalogueError('job_type_in_use');
        } else {
          const position = entry.entry === 'competency' ? entry.position : undefined;
          const pack = draft.packs.find((p) => p.key === entry.packKey);
          const target =
            entry.entry === 'regionalHint'
              ? pack?.hints.find((h) => h.region === entry.region && h.position === entry.position)
              : position === undefined
                ? pack
                : pack?.competencies.find((c) => c.position === position);
          if (!target) throw new CatalogueError('not_found');
          if (target.retired) throw new CatalogueError('entry_retired');
          if (entry.entry !== 'pack' && pack?.retired) throw new CatalogueError('pack_retired');
          removed =
            entry.entry === 'regionalHint'
              ? isHintNewInDraft(published, entry.packKey, entry.region, entry.position)
              : isNewInDraft(published, entry.packKey, position);
        }
        await store.touch(version, operatorId);
        await (removed ? store.remove(version, entry) : store.retire(version, entry));
        await store.recordPlatform(
          audit(operatorId, removed ? 'catalogue.entry_removed' : 'catalogue.entry_retired', {
            catalogueVersion: version,
            revision: next,
            ...entry,
          }),
        );
        return removed ? 'removed' : 'retired';
      });
    },
  };
}
