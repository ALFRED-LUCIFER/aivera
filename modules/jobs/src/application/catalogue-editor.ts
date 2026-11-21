import type { NewPlatformEntry } from '@credalent/audit';
import {
  assertCompetencyFits,
  assertFairCompetency,
  CatalogueError,
  draftCompetencySchema,
  draftPackSchema,
  isNewInDraft,
  retireEntrySchema,
  type CatalogueEditorView,
  type DraftCompetencyInput,
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
  /** Marks the entry retired. */
  retire(version: number, entry: DraftEntry): Promise<void>;
  /** Deletes the entry; a pack with its competencies and hints. */
  remove(version: number, entry: DraftEntry): Promise<void>;
  recordPlatform(entry: NewPlatformEntry): Promise<void>;
};

/** A retire or remove target without the save's version and revision. */
export type DraftEntry =
  { entry: 'pack'; packKey: string } | { entry: 'competency'; packKey: string; position: number };

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
     * Retires a pack or competency a published version holds, or removes one new in this draft (ADR-013 point 6).
     * Returns which it did.
     */
    retireDraftEntry: async (operatorId: string, raw: RetireEntryInput): Promise<'retired' | 'removed'> => {
      const parsed = retireEntrySchema.parse(raw);
      const { revision: _revision, version: _version, ...entry } = parsed;
      const position = entry.entry === 'competency' ? entry.position : undefined;
      return inTransaction(async (store) => {
        const { draft, published, version, next } = await begin(store, parsed);
        const pack = draft.packs.find((p) => p.key === entry.packKey);
        const target = position === undefined ? pack : pack?.competencies.find((c) => c.position === position);
        if (!target) throw new CatalogueError('not_found');
        if (target.retired) throw new CatalogueError('entry_retired');
        if (position !== undefined && pack?.retired) throw new CatalogueError('pack_retired');
        const removed = isNewInDraft(published, entry.packKey, position);
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
