// Editing a catalogue draft (ADR-013 points 3, 5, 6 and 11): the shapes the editor reads and the rules every save
// checks. Pure: no database, no clock.
import { z } from 'zod';
import {
  CATALOGUE_KEY,
  type CatalogueCompetency,
  type CatalogueHint,
  type CatalogueJobType,
  type CataloguePack,
  type CatalogueVersion,
} from './catalogue.ts';

/**
 * A pack competency as the editor sees it: its position in the pack, which a draft copies, so it names the entry.
 * shortcut: position is both order and identity; a reorder feature must add a stable entry id first.
 */
export type EditorCompetency = CatalogueCompetency & { readonly position: number };
/** A regional hint with its position among the pack's hints for its region (the same shortcut as competencies). */
export type EditorHint = CatalogueHint & { readonly position: number };
export type EditorPack = Omit<CataloguePack, 'competencies' | 'hints'> & {
  readonly competencies: readonly EditorCompetency[];
  readonly hints: readonly EditorHint[];
};
export type EditorVersion = Omit<CatalogueVersion, 'packs'> & { readonly packs: readonly EditorPack[] };
/** The open draft: its entries, its revision and who saved it last (an operator's opaque id). */
export type CatalogueDraft = EditorVersion & { readonly revision: number; readonly revisedBy: string | null };
/** What `/ops/catalogue` reads: the latest published version, and the open draft or null. */
export type CatalogueEditorView = { readonly published: EditorVersion; readonly draft: CatalogueDraft | null };

/** The status word an entry shows in the editor (operator-console.md, catalogue editor layout). */
export type EntryStatus = 'live' | 'changed' | 'new' | 'retired';

const status = <T>(draft: T & { retired: boolean }, published: T | undefined): EntryStatus => {
  if (draft.retired) return 'retired';
  if (!published) return 'new';
  return JSON.stringify(published) === JSON.stringify(draft) ? 'live' : 'changed';
};

export const packStatus = (published: EditorVersion, pack: EditorPack): EntryStatus => {
  const before = published.packs.find((p) => p.key === pack.key);
  return status(
    { key: pack.key, label: pack.label, retired: pack.retired },
    before && {
      key: before.key,
      label: before.label,
      retired: before.retired,
    },
  );
};

export const competencyStatus = (published: EditorVersion, packKey: string, c: EditorCompetency): EntryStatus =>
  status(
    c,
    published.packs.find((p) => p.key === packKey)?.competencies.find((b) => b.position === c.position),
  );

const publishedHint = (published: EditorVersion, packKey: string, region: string, position: number) =>
  published.packs.find((p) => p.key === packKey)?.hints.find((h) => h.region === region && h.position === position);

export const hintStatus = (published: EditorVersion, packKey: string, h: EditorHint): EntryStatus =>
  status(h, publishedHint(published, packKey, h.region, h.position));

/** Whether a regional hint is new in this draft, so it is removed rather than retired. */
export const isHintNewInDraft = (published: EditorVersion, packKey: string, region: string, position: number) =>
  !publishedHint(published, packKey, region, position);
/** A job type's status: by key, its position not compared (order is not content). */
export const jobTypeStatus = (published: EditorVersion, jobType: CatalogueJobType): EntryStatus =>
  status(
    jobType,
    published.jobTypes.find((t) => t.key === jobType.key),
  );

/**
 * The draft's job type keys in their new order with `key` placed at `position` of the offered (not retired) list:
 * before the offered job type now there, or last. Retired ones keep their place among the rest.
 */
export function placeJobType(jobTypes: readonly CatalogueJobType[], key: string, position: number): string[] {
  const rest = jobTypes.filter((t) => t.key !== key);
  const before = rest.filter((t) => !t.retired)[position];
  const at = before ? rest.indexOf(before) : rest.length;
  return [...rest.slice(0, at).map((t) => t.key), key, ...rest.slice(at).map((t) => t.key)];
}

/** Whether a draft entry may be removed: it is new in this draft. Anything a published version holds is retired. */
export const isNewInDraft = (published: EditorVersion, packKey: string, position?: number): boolean => {
  const pack = published.packs.find((p) => p.key === packKey);
  return position === undefined ? !pack : !pack?.competencies.some((c) => c.position === position);
};

/** Default suggestions per job type in one pack (ADR-013 point 1, AIV-P2-045). */
export const CORE_LIMIT = 4;

const RESERVED_KEYS = ['none', 'several', 'other'];
const key = z
  .string()
  .regex(CATALOGUE_KEY)
  .refine((k) => !RESERVED_KEYS.includes(k));
const filled = (max: number) => z.string().trim().min(1).max(max);
// Every save names the draft (its version) and the revision it read: a save made on a discarded draft, or before
// another operator's save, is refused as stale.
const base = { version: z.int().min(2), revision: z.int().min(0) };

/** Add a pack (`previousKey` null) or edit one: its key (only while it is new in the draft) and English label. */
export const draftPackSchema = z.strictObject({
  ...base,
  previousKey: key.nullable(),
  key,
  label: filled(120),
});
export type DraftPackInput = z.infer<typeof draftPackSchema>;

/**
 * Add a competency to a pack (`position` null) or edit one. Evidence may arrive empty so the fairness check can name it;
 * type is always desirable and not part of the input (ADR-013 point 11).
 */
export const draftCompetencySchema = z.strictObject({
  ...base,
  packKey: key,
  position: z.int().min(0).nullable(),
  name: filled(200),
  meaning: filled(1000),
  evidence: z.string().trim().max(1000),
  levels: z.strictObject({ 1: filled(500), 3: filled(500), 5: filled(500) }),
  appliesTo: z.array(key).min(1).max(50),
  core: z.array(key).max(50),
  levelNeeded: z.union([z.literal(2), z.literal(3)]),
});
export type DraftCompetencyInput = z.infer<typeof draftCompetencySchema>;

/**
 * Add a job type (`adding`) or edit its English label, evidence text and starters, and place it at `position` of the Add
 * a job list (0 is first). Its key never changes (ADR-013 point 5). Exactly four starters (AIV-P1-004).
 */
export const draftJobTypeSchema = z.strictObject({
  ...base,
  adding: z.boolean(),
  key,
  label: filled(120),
  evidence: filled(1000),
  starters: z.array(filled(200)).length(4),
  position: z.int().min(0).max(500),
});
export type DraftJobTypeInput = z.infer<typeof draftJobTypeSchema>;

/**
 * Add a regional hint to a pack's region (`position` null) or edit one (AIV-P2-046): the competency's fields without
 * core. Strict, so a request that sends `type` (say "mandatory") is refused (ADR-013 point 11).
 */
export const draftHintSchema = draftCompetencySchema.omit({ core: true }).extend({ region: key });
export type DraftHintInput = z.infer<typeof draftHintSchema>;

/** Retire an entry, or remove it when it is new in the draft. One shape per entry kind. */
export const retireEntrySchema = z.discriminatedUnion('entry', [
  z.strictObject({ ...base, entry: z.literal('pack'), packKey: key }),
  z.strictObject({ ...base, entry: z.literal('competency'), packKey: key, position: z.int().min(0) }),
  z.strictObject({ ...base, entry: z.literal('regionalHint'), packKey: key, region: key, position: z.int().min(0) }),
  z.strictObject({ ...base, entry: z.literal('jobType'), jobTypeKey: key }),
]);
export type RetireEntryInput = z.infer<typeof retireEntrySchema>;

/** Why a save was refused; `field` is the form field the message goes under. Never the refused text (AGENTS.md 1.2). */
export const CATALOGUE_ERROR_CODES = [
  'no_draft',
  'draft_open',
  'stale',
  'not_found',
  'key_taken',
  'key_fixed',
  'pack_retired',
  'entry_retired',
  'job_type',
  'job_type_in_use',
  'core_not_applied',
  'core_limit',
  'evidence_required',
  'fairness_employer',
  'fairness_origin',
  'fairness_residency',
] as const;
export type CatalogueErrorCode = (typeof CATALOGUE_ERROR_CODES)[number];
export type CatalogueField = 'key' | 'name' | 'meaning' | 'evidence' | 'appliesTo' | 'core' | 'starters';

/** A refusal of a draft save. The message names the code only, never what was typed. */
export class CatalogueError extends Error {
  readonly code: CatalogueErrorCode;
  readonly field: CatalogueField | undefined;
  /** For `stale`: the operator who saved the draft last, by opaque id. */
  readonly by: string | null;
  constructor(code: CatalogueErrorCode, detail: { field?: CatalogueField; by?: string | null } = {}) {
    super(`Catalogue draft: ${code}`);
    this.name = 'CatalogueError';
    this.code = code;
    this.field = detail.field;
    this.by = detail.by ?? null;
  }
}

/*
 * Fairness on save (ADR-013 point 11, epic #290): a competency is a skill shown with evidence, never an employer, a
 * nationality, a region of origin, a residency or "worked at X". Whole words and phrases only, never substrings, so
 * "National digital identity sign-in", "international card payments" and "cloud-native" pass.
 * shortcut: the country and employer lists are short; extend them when an operator finds a gap (each addition must
 * keep the version 1 test passing).
 */
const COUNTRIES = [
  'uae',
  'emirates',
  'emirati',
  'ksa',
  'saudi',
  'saudi arabia',
  'qatar',
  'qatari',
  'kuwait',
  'kuwaiti',
  'oman',
  'omani',
  'bahrain',
  'bahraini',
  'gcc',
  'india',
  'indian',
  'pakistan',
  'pakistani',
  'egypt',
  'egyptian',
  'jordan',
  'jordanian',
  'lebanon',
  'lebanese',
  'syria',
  'syrian',
  'philippines',
  'filipino',
  'bangladesh',
  'bangladeshi',
  'sri lanka',
  'sri lankan',
  'nepal',
  'nepali',
  'uk',
  'british',
  'usa',
  'american',
  'europe',
  'european',
  'africa',
  'african',
  'arab',
].join('|');
const EMPLOYERS = [
  'aramco',
  'adnoc',
  'etisalat',
  'careem',
  'talabat',
  'mckinsey',
  'deloitte',
  'pwc',
  'kpmg',
  'accenture',
  'infosys',
  'wipro',
  'goldman sachs',
  'big four',
].join('|');

const RULES: readonly (readonly [RegExp, 'employer' | 'origin'])[] = [
  [/\bworked at\b/i, 'employer'],
  [/\byears at\b/i, 'employer'],
  // A listed employer, "Ex-Careem" included; a bare "ex-" is not a rule ("ex-dividend" and "ex-ante" are skills).
  [new RegExp(`\\b(?:${EMPLOYERS})\\b`, 'i'), 'employer'],
  [/\bnationals\b/i, 'origin'],
  [new RegExp(`\\b(?:${COUNTRIES}) nationals?\\b`, 'i'), 'origin'],
  [/\bcitizens?(?:hip)?\b/i, 'origin'],
  [/\bnative speakers?\b/i, 'origin'],
  [/\bresidents? of\b/i, 'origin'],
  [/\bresidence visa\b/i, 'origin'],
  [/\bborn in\b/i, 'origin'],
  [new RegExp(`\\bfrom (?:the )?(?:${COUNTRIES})\\b`, 'i'), 'origin'],
];

/** The fairness rule `text` breaks, or null. */
export const fairnessRule = (text: string): 'employer' | 'origin' | null =>
  RULES.find(([pattern]) => pattern.test(text))?.[1] ?? null;

/** Throws the refusal the form shows: evidence first, then the name, then the meaning. */
export function assertFairCompetency({
  name,
  meaning,
  evidence,
}: Pick<DraftCompetencyInput, 'name' | 'meaning' | 'evidence'>) {
  if (!evidence.trim()) throw new CatalogueError('evidence_required', { field: 'evidence' });
  for (const field of ['name', 'meaning'] as const) {
    const rule = fairnessRule(field === 'name' ? name : meaning);
    if (rule) throw new CatalogueError(rule === 'employer' ? 'fairness_employer' : 'fairness_origin', { field });
  }
}

/** A job type's starters are competencies too: the same fairness rule (ADR-013 point 11), under the starters field. */
export function assertFairStarters(starters: readonly string[]) {
  const rule = starters.map(fairnessRule).find(Boolean);
  if (rule)
    throw new CatalogueError(rule === 'employer' ? 'fairness_employer' : 'fairness_origin', { field: 'starters' });
}

/**
 * Throws unless the competency's job types are job types of the draft that are not retired (or ones the edited entry
 * already had: a retired job type stays on it, AIV-P2-047), its core ones are among them, and no job type gets more
 * than `CORE_LIMIT` core competencies in the pack (retired ones not counted).
 */
export function assertCompetencyFits(
  draft: EditorVersion,
  pack: EditorPack,
  input: DraftCompetencyInput,
  // The entry's own job types before this save; a regional hint passes its own (AIV-P2-046).
  kept: readonly string[] = pack.competencies.find((c) => c.position === input.position)?.appliesTo ?? [],
) {
  // shortcut: the form does not list a retired job type, so it can be kept but not unticked; list it when operators ask.
  const offered = new Set([...draft.jobTypes.filter((t) => !t.retired).map((t) => t.key), ...kept]);
  if (input.appliesTo.some((t) => !offered.has(t))) throw new CatalogueError('job_type', { field: 'appliesTo' });
  if (input.core.some((t) => !input.appliesTo.includes(t)))
    throw new CatalogueError('core_not_applied', { field: 'core' });
  const others = pack.competencies.filter((c) => !c.retired && c.position !== input.position);
  if (input.core.some((t) => others.filter((c) => c.core.includes(t)).length >= CORE_LIMIT))
    throw new CatalogueError('core_limit', { field: 'core' });
}

/*
 * A regional hint is market knowledge shown with evidence, never where someone lives, is from or holds papers for
 * (AIV-P2-046, ADR-013 points 11 and 16). These rules run before the competency rules, on the name and the meaning.
 * Whole words only: "Emirates ID", "Visa card payments" and "data residency rules" stay skills.
 * shortcut: a short list like COUNTRIES; extend it when an operator finds a gap (each addition must keep version 1 passing).
 */
const RESIDENCY: readonly RegExp[] = [
  // "Data residency rules" and "tax residency certificates" are market knowledge; a person's residence is not.
  /\b(?<!(?:data|tax)[ -])residen(?:ce|cy|ts?)\b/i,
  /\b(?:work|employment|entry) (?:visas?|permits?)\b/i,
  /\b(?:visa|iqama|aadhaar|emirates id|national id) (?:holders?|status|sponsorship)\b/i,
  /\b(?:holds?|holding|has|have|having|possess(?:es)?) (?:an? |the |valid )*(?:[\w-]+ )?(?:visa|iqama|aadhaar|emirates id|national id|id card)\b/i,
  /\bvalid (?:[\w-]+ )?(?:id|visa|iqama)\b/i,
  /\b(?:transferable sponsorship|kafala)\b/i,
  /\biqama\b/i,
  /\bpassports?\b/i,
  /\bnationality\b/i,
  /\b(?:lives?|living|located|based|reside[sd]?) in\b/i,
  /\b(?:candidates?|people|someone|engineers?|applicants?) (?:who (?:are|is) )?from\b/i,
];

/** Whether `text` asks for a residency, an origin or papers rather than market knowledge. */
export const residencyRule = (text: string): boolean => RESIDENCY.some((pattern) => pattern.test(text));

/** Throws the refusal the hint form shows: the residency rule first, then every competency rule. */
export function assertFairHint(input: Pick<DraftHintInput, 'name' | 'meaning' | 'evidence'>) {
  for (const field of ['name', 'meaning'] as const)
    if (residencyRule(input[field])) throw new CatalogueError('fairness_residency', { field });
  assertFairCompetency(input);
}
