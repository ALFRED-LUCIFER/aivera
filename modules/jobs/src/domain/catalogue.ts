// The catalogue as stored in the database (ADR-013): one version covers job types, regions, packs and hints.

export const CATALOGUE_STATUSES = ['draft', 'published'] as const;
export type CatalogueStatus = (typeof CATALOGUE_STATUSES)[number];

/** Label text per locale: `en` required, `ar` optional until the recruiter app ships in Arabic (ADR-013 point 10). */
export type Labels = { readonly en: string; readonly ar?: string };

export type CatalogueJobType = {
  readonly key: string;
  readonly label: Labels;
  readonly evidence: Labels;
  readonly starterCompetencies: readonly string[];
  readonly retired: boolean;
};

export type CatalogueRegion = { readonly key: string; readonly label: Labels; readonly retired: boolean };

export type CatalogueCompetency = {
  readonly name: string;
  readonly meaning: string;
  readonly evidence: string;
  readonly levels: { readonly 1: string; readonly 3: string; readonly 5: string };
  readonly appliesTo: readonly string[];
  readonly core: readonly string[];
  readonly levelNeeded: number;
  readonly type: 'desirable';
  readonly retired: boolean;
};

export type CatalogueHint = Omit<CatalogueCompetency, 'core'> & { readonly region: string };

export type CataloguePack = {
  readonly key: string;
  readonly label: Labels;
  readonly retired: boolean;
  readonly competencies: readonly CatalogueCompetency[];
  readonly hints: readonly CatalogueHint[];
};

/** Every entry, retired ones flagged, each list in catalogue order. */
export type CatalogueVersion = {
  readonly version: number;
  readonly status: CatalogueStatus;
  readonly publishedAt: Date | null;
  readonly publishedBy: string | null;
  readonly reason: string | null;
  readonly jobTypes: readonly CatalogueJobType[];
  readonly regions: readonly CatalogueRegion[];
  readonly packs: readonly CataloguePack[];
};

/** A version's entries without who published it and why: what a recruiter's page needs. */
export type CatalogueContent = Pick<CatalogueVersion, 'version' | 'jobTypes' | 'regions' | 'packs'>;

/** A catalogue key (ADR-013 point 5), as the database's key format check has it. */
export const CATALOGUE_KEY = /^[a-z][a-z0-9_]{2,47}$/;

/** The job types Add a job and the sign-up pickers offer: every one not retired, in catalogue order. */
export const offeredJobTypes = (catalogue: CatalogueContent) => catalogue.jobTypes.filter((t) => !t.retired);

/**
 * A job type's name, retired ones too (an old job keeps its label); the key itself only for a key no version has.
 * shortcut: English only; pick the viewer's locale when the recruiter app ships in Arabic (AIV-P5-009).
 */
export const jobTypeLabel = (catalogue: CatalogueContent, key: string): string =>
  catalogue.jobTypes.find((t) => t.key === key)?.label.en ?? key;

/** A competency name compared without case or extra spaces, so the same skill is never listed twice. */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** One pack as one job type sees it: default suggestions, the rest of the pack, and regional hints in region order. */
export type PackForJobType = {
  readonly key: string;
  readonly label: Labels;
  readonly core: readonly CatalogueCompetency[];
  readonly more: readonly CatalogueCompetency[];
  readonly hints: readonly CatalogueHint[];
};

/**
 * The pack as one job type sees it, leaving out anything retired; null for an unknown or retired pack. A job type the
 * pack does not cover gets empty lists.
 */
export function packForJobType(catalogue: CatalogueContent, key: string, jobType: string): PackForJobType | null {
  const pack = catalogue.packs.find((p) => p.key === key && !p.retired);
  if (!pack) return null;
  const regions = new Set(catalogue.regions.filter((r) => !r.retired).map((r) => r.key));
  const applies = pack.competencies.filter((c) => !c.retired && c.appliesTo.includes(jobType));
  return {
    key,
    label: pack.label,
    core: applies.filter((c) => c.core.includes(jobType)),
    more: applies.filter((c) => !c.core.includes(jobType)),
    hints: pack.hints.filter((h) => !h.retired && regions.has(h.region) && h.appliesTo.includes(jobType)),
  };
}

/**
 * Whether a competency is named as one of the catalogue's regional hints, retired ones too, without case or extra spaces.
 * shortcut: a hint the recruiter renamed is no longer recognised; store the hint's region if a rubric editor shows that
 * renaming is used to make one mandatory.
 */
export const isRegionalHint = (catalogue: CatalogueContent, name: string): boolean =>
  catalogue.packs.some((p) => p.hints.some((h) => nameKey(h.name) === nameKey(name)));
