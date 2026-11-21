// The catalogue editor at /ops/catalogue (AIV-P2-045, ADR-013): what the page shows of the draft, the form values and
// what a save answers. Pure (ADR-003). The input schemas and rules are the jobs module's; the server checks them again.
import {
  catalogueDiff,
  competencyStatus,
  discardDraftSchema,
  draftCompetencySchema,
  draftHintSchema,
  draftJobTypeSchema,
  draftPackSchema,
  draftRegionSchema,
  hintStatus,
  isHintNewInDraft,
  isNewInDraft,
  isRegionNewInDraft,
  jobTypeStatus,
  packStatus,
  publishDraftSchema,
  regionStatus,
  retireEntrySchema,
  type CatalogueChange,
  type CatalogueEditorView,
  type CatalogueErrorCode,
  type CatalogueField,
  type DraftCompetencyInput,
  type EditorCompetency,
  type EntryStatus,
} from '@credalent/jobs';
import type { ZodError } from 'zod';

export {
  discardDraftSchema,
  draftCompetencySchema,
  draftHintSchema,
  draftJobTypeSchema,
  draftPackSchema,
  draftRegionSchema,
  publishDraftSchema,
  retireEntrySchema,
};
export type { EntryStatus } from '@credalent/jobs';

export type CompetencyRow = Pick<
  EditorCompetency,
  'position' | 'name' | 'meaning' | 'evidence' | 'levels' | 'appliesTo' | 'core' | 'levelNeeded'
> & { status: EntryStatus; removable: boolean };
/** A regional hint (AIV-P2-046): a competency row without core, for one region. */
export type HintRow = Omit<CompetencyRow, 'core'> & { region: string };
export type PackRow = {
  key: string;
  label: string;
  status: EntryStatus;
  removable: boolean;
  competencies: CompetencyRow[];
  hints: HintRow[];
};
/** A region in the draft (AIV-P2-059), retired ones too: they stay listed, with their hints, never deleted. */
export type RegionRow = { key: string; label: string; status: EntryStatus; removable: boolean };
/** A job type in the draft, retired ones too (they stay listed, never deleted). */
export type JobTypeRow = {
  key: string;
  label: string;
  evidence: string;
  starters: string[];
  status: EntryStatus;
};

/** The draft's version and revision name it in every save, so a save on another draft or an older copy is stale. */
export type DraftModel = {
  version: number;
  revision: number;
  /** The job types a competency may apply to: the draft's, not retired. */
  jobTypes: { key: string; label: string }[];
  /** Every region of the draft in catalogue order; a hint may be added only for one that is not retired. */
  regions: RegionRow[];
  /** Every job type of the draft in Add a job order, for the job type list (AIV-P2-047). */
  jobTypeEntries: JobTypeRow[];
  packs: PackRow[];
  /** What the draft changes against the published version: the publish preview's diff (AIV-P2-049). */
  changes: CatalogueChange[];
};

/**
 * The draft as the editor lists it: every pack with its status word, each competency with its own, and whether it is
 * new in the draft (so it is removed, not retired, and a new pack's key may still change). Null when no draft is open.
 * shortcut: English labels only; pick the viewer's locale when the console ships in Arabic (AIV-P5-009).
 */
export function draftModel({ published, draft }: CatalogueEditorView): DraftModel | null {
  if (!draft) return null;
  const retiredRegions = new Set(draft.regions.filter((r) => r.retired).map((r) => r.key));
  return {
    version: draft.version,
    revision: draft.revision,
    jobTypes: draft.jobTypes.filter((t) => !t.retired).map((t) => ({ key: t.key, label: t.label.en })),
    regions: draft.regions.map((r) => ({
      key: r.key,
      label: r.label.en,
      status: regionStatus(published, r),
      removable: isRegionNewInDraft(published, r.key),
    })),
    jobTypeEntries: draft.jobTypes.map((t) => ({
      key: t.key,
      label: t.label.en,
      evidence: t.evidence.en,
      starters: [...t.starterCompetencies],
      status: jobTypeStatus(published, t),
    })),
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
      hints: pack.hints.map((h) => ({
        region: h.region,
        position: h.position,
        name: h.name,
        meaning: h.meaning,
        evidence: h.evidence,
        levels: h.levels,
        appliesTo: h.appliesTo,
        levelNeeded: h.levelNeeded,
        // A retired region's hints read as retired: they can no longer be edited (AIV-P2-059).
        status: retiredRegions.has(h.region) ? 'retired' : hintStatus(published, pack.key, h),
        removable: isHintNewInDraft(published, pack.key, h.region, h.position),
      })),
    })),
    changes: catalogueDiff(published, draft),
  };
}

/** The pack form, or the region form (AIV-P2-059): the same key and label. `previousKey` null adds one. */
export type PackForm = {
  entry: 'pack' | 'region';
  previousKey: string | null;
  key: string;
  label: string;
  keyEditable: boolean;
};
export const newPackForm = (entry: PackForm['entry'] = 'pack'): PackForm => ({
  entry,
  previousKey: null,
  key: '',
  label: '',
  keyEditable: true,
});
export const packFormFor = (row: PackRow | RegionRow, entry: PackForm['entry'] = 'pack'): PackForm => ({
  entry,
  previousKey: row.key,
  key: row.key,
  label: row.label,
  keyEditable: row.removable,
});

/**
 * The job type form: `adding` adds one; its key is fixed once saved. `position` counts from 1 in the Add a job list,
 * which leaves out retired job types; the save sends it from 0.
 */
export type JobTypeForm = {
  adding: boolean;
  key: string;
  label: string;
  evidence: string;
  starters: string[];
  position: number;
};
export const newJobTypeForm = (draft: DraftModel): JobTypeForm => ({
  adding: true,
  key: '',
  label: '',
  evidence: '',
  starters: ['', '', '', ''],
  position: draft.jobTypes.length + 1,
});
export const jobTypeFormFor = (draft: DraftModel, row: JobTypeRow): JobTypeForm => ({
  adding: false,
  key: row.key,
  label: row.label,
  evidence: row.evidence,
  starters: [...row.starters],
  position: draft.jobTypes.findIndex((t) => t.key === row.key) + 1,
});
/** The job type form as the save action takes it; empty starters are sent, so the schema names the starters field. */
export const jobTypeInput = ({ version, revision }: DraftModel, form: JobTypeForm) => ({
  version,
  revision,
  ...form,
  key: form.key.trim(),
  position: form.position - 1,
});

/**
 * The competency form: `position` null adds one to `packKey`. Type is always Desirable, so it is not a field. With a
 * `region` it is a regional hint's form (AIV-P2-046), and `core` is not sent.
 */
export type CompetencyForm = Omit<DraftCompetencyInput, 'version' | 'revision' | 'levelNeeded'> & {
  levelNeeded: 2 | 3;
  region: string | null;
};
export const newCompetencyForm = (packKey: string, region: string | null = null): CompetencyForm => ({
  packKey,
  region,
  position: null,
  name: '',
  meaning: '',
  evidence: '',
  levels: { 1: '', 3: '', 5: '' },
  appliesTo: [],
  core: [],
  levelNeeded: 3,
});
export const competencyFormFor = (packKey: string, row: CompetencyRow | HintRow): CompetencyForm => ({
  packKey,
  region: 'region' in row ? row.region : null,
  position: row.position,
  name: row.name,
  meaning: row.meaning,
  evidence: row.evidence,
  levels: { ...row.levels },
  appliesTo: [...row.appliesTo],
  core: 'core' in row ? [...row.core] : [],
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
export type EditorField = CatalogueField | 'label' | 'levels' | 'position' | 'reason';

/** What a save answers. `invalid` names the field the schema refused; `stale` names who saved last (null: unknown). */
export type CatalogueSaveResult =
  | { ok: true }
  | { ok: false; error: CatalogueErrorCode | 'invalid' | 'failed'; field?: EditorField; by?: string | null };

const FIELDS: readonly string[] = [
  'key',
  'label',
  'name',
  'meaning',
  'evidence',
  'levels',
  'appliesTo',
  'core',
  'starters',
  'position',
  'reason',
];

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
  jobTypeForm: JobTypeForm | null;
  /** The open form's refusal, or a retire's when no form is open. */
  error: Refusal | null;
  pending: boolean;
  onAddPack: () => void;
  onEditPack: (pack: PackRow) => void;
  onPackChange: (patch: Partial<Pick<PackForm, 'key' | 'label'>>) => void;
  onAddRegion: () => void;
  onEditRegion: (row: RegionRow) => void;
  onRetireRegion: (key: string) => Promise<void>;
  onAddCompetency: (packKey: string) => void;
  onEditCompetency: (packKey: string, row: CompetencyRow) => void;
  onAddHint: (packKey: string, region: string) => void;
  onEditHint: (packKey: string, row: HintRow) => void;
  onCompetencyChange: (patch: Partial<CompetencyForm>) => void;
  onToggleJobType: (list: 'appliesTo' | 'core', key: string) => void;
  onAddJobType: () => void;
  onEditJobType: (row: JobTypeRow) => void;
  onJobTypeChange: (patch: Partial<Omit<JobTypeForm, 'adding'>>) => void;
  onRetireJobType: (key: string) => Promise<void>;
  onSave: () => Promise<void>;
  onClose: () => void;
  /** After a stale save: closes the form and loads the latest draft. */
  onReload: () => void;
  onRetire: (packKey: string, position?: number) => Promise<void>;
  onRetireHint: (packKey: string, row: HintRow) => Promise<void>;
};
