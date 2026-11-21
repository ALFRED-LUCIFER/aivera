// The catalogue editor at /ops/catalogue (AIV-P2-045, ADR-013): what the page shows of the draft, the form values and
// what a save answers. Pure (ADR-003). The input schemas and rules are the jobs module's; the server checks them again.
import {
  competencyStatus,
  draftCompetencySchema,
  draftPackSchema,
  isNewInDraft,
  packStatus,
  retireEntrySchema,
  type CatalogueEditorView,
  type CatalogueErrorCode,
  type CatalogueField,
  type DraftCompetencyInput,
  type EditorCompetency,
  type EntryStatus,
} from '@credalent/jobs';
import type { ZodError } from 'zod';

export { draftCompetencySchema, draftPackSchema, retireEntrySchema };
export type { EntryStatus } from '@credalent/jobs';

export type CompetencyRow = Pick<
  EditorCompetency,
  'position' | 'name' | 'meaning' | 'evidence' | 'levels' | 'appliesTo' | 'core' | 'levelNeeded'
> & { status: EntryStatus; removable: boolean };
export type PackRow = {
  key: string;
  label: string;
  status: EntryStatus;
  removable: boolean;
  competencies: CompetencyRow[];
};
/** The draft's version and revision name it in every save, so a save on another draft or an older copy is stale. */
export type DraftModel = {
  version: number;
  revision: number;
  jobTypes: { key: string; label: string }[];
  packs: PackRow[];
};

/**
 * The draft as the editor lists it: every pack with its status word, each competency with its own, and whether it is
 * new in the draft (so it is removed, not retired, and a new pack's key may still change). Null when no draft is open.
 * shortcut: English labels only; pick the viewer's locale when the console ships in Arabic (AIV-P5-009).
 */
export function draftModel({ published, draft }: CatalogueEditorView): DraftModel | null {
  if (!draft) return null;
  return {
    version: draft.version,
    revision: draft.revision,
    jobTypes: draft.jobTypes.filter((t) => !t.retired).map((t) => ({ key: t.key, label: t.label.en })),
    packs: draft.packs.map((pack) => ({
      key: pack.key,
      label: pack.label.en,
      status: packStatus(published, pack),
      removable: isNewInDraft(published, pack.key),
      competencies: pack.competencies.map((c) => ({
        position: c.position,
        name: c.name,
        meaning: c.meaning,
        evidence: c.evidence,
        levels: c.levels,
        appliesTo: c.appliesTo,
        core: c.core,
        levelNeeded: c.levelNeeded,
        status: competencyStatus(published, pack.key, c),
        removable: isNewInDraft(published, pack.key, c.position),
      })),
    })),
  };
}

/** The pack form: `previousKey` null adds a pack. */
export type PackForm = { previousKey: string | null; key: string; label: string; keyEditable: boolean };
export const newPackForm = (): PackForm => ({ previousKey: null, key: '', label: '', keyEditable: true });
export const packFormFor = (pack: PackRow): PackForm => ({
  previousKey: pack.key,
  key: pack.key,
  label: pack.label,
  keyEditable: pack.removable,
});

/** The competency form: `position` null adds one to `packKey`. Type is always Desirable, so it is not a field. */
export type CompetencyForm = Omit<DraftCompetencyInput, 'version' | 'revision' | 'levelNeeded'> & {
  levelNeeded: 2 | 3;
};
export const newCompetencyForm = (packKey: string): CompetencyForm => ({
  packKey,
  position: null,
  name: '',
  meaning: '',
  evidence: '',
  levels: { 1: '', 3: '', 5: '' },
  appliesTo: [],
  core: [],
  levelNeeded: 3,
});
export const competencyFormFor = (packKey: string, row: CompetencyRow): CompetencyForm => ({
  packKey,
  position: row.position,
  name: row.name,
  meaning: row.meaning,
  evidence: row.evidence,
  levels: { ...row.levels },
  appliesTo: [...row.appliesTo],
  core: [...row.core],
  levelNeeded: row.levelNeeded === 2 ? 2 : 3,
});

/** Ticks or unticks a job type; unticking applies-to also drops it from core, so core stays within applies-to. */
export function toggleJobType(form: CompetencyForm, list: 'appliesTo' | 'core', key: string): CompetencyForm {
  const on = !form[list].includes(key);
  const next = on ? [...form[list], key] : form[list].filter((k) => k !== key);
  if (list === 'core')
    return {
      ...form,
      core: next,
      appliesTo: on && !form.appliesTo.includes(key) ? [...form.appliesTo, key] : form.appliesTo,
    };
  return { ...form, appliesTo: next, core: on ? form.core : form.core.filter((k) => k !== key) };
}

/** A form field the error goes under: the refused rule's field, or the first field the schema refused. */
export type EditorField = CatalogueField | 'label' | 'levels';

/** What a save answers. `invalid` names the field the schema refused; `stale` names who saved last (null: unknown). */
export type CatalogueSaveResult =
  | { ok: true }
  | { ok: false; error: CatalogueErrorCode | 'invalid' | 'failed'; field?: EditorField; by?: string | null };

const FIELDS: readonly string[] = ['key', 'label', 'name', 'meaning', 'evidence', 'levels', 'appliesTo', 'core'];

/** The schema's refusal as a save result, naming the first field it refused. */
export function invalidResult(error: ZodError): CatalogueSaveResult {
  const path = error.issues.map((issue) => String(issue.path[0])).find((p) => FIELDS.includes(p));
  return path ? { ok: false, error: 'invalid', field: path as EditorField } : { ok: false, error: 'failed' };
}

export type Refusal = Extract<CatalogueSaveResult, { ok: false }>;

/** The editor's view model: the draft, the open form (one at a time) and the last refusal. */
export type EditorViewModel = {
  draft: DraftModel;
  packForm: PackForm | null;
  competencyForm: CompetencyForm | null;
  /** The open form's refusal, or a retire's when no form is open. */
  error: Refusal | null;
  pending: boolean;
  onAddPack: () => void;
  onEditPack: (pack: PackRow) => void;
  onPackChange: (patch: Partial<Pick<PackForm, 'key' | 'label'>>) => void;
  onAddCompetency: (packKey: string) => void;
  onEditCompetency: (packKey: string, row: CompetencyRow) => void;
  onCompetencyChange: (patch: Partial<CompetencyForm>) => void;
  onToggleJobType: (list: 'appliesTo' | 'core', key: string) => void;
  onSave: () => Promise<void>;
  onClose: () => void;
  /** After a stale save: closes the form and loads the latest draft. */
  onReload: () => void;
  onRetire: (packKey: string, position?: number) => Promise<void>;
};
