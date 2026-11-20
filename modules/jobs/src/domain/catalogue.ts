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
