import {
  CATALOGUE_KEY,
  COMPETENCY_ORIGINS,
  COMPETENCY_TYPES,
  isRegionalHint,
  nameKey,
  packForJobType,
  type CatalogueCompetency,
  type CatalogueHint,
  type CatalogueVersion,
  type Competency,
  type DomainDetection,
  type DraftedCompetency,
  type SuggestedCompetency,
} from '@aivera/jobs';
import { z } from 'zod';
import type { NewJobState } from './jobNew.ts';

// Add a job, steps 2 and 3 "Competencies, drafted and suggested" and "Save to the job as its rubric" (AIV-P1-008 to
// AIV-P1-010), with the industry's pack suggestions (AIV-P1-064). Pure: no React, no I/O (ADR-003).

/** Where a drafted competency came from in the description: the sentence (or list line) and the quoted span in it. */
export type Excerpt = { text: string; start: number; end: number };

export type DraftCompetency = Pick<
  DraftedCompetency,
  'name' | 'evidenceExpected' | 'weightPercent' | 'levelNeeded' | 'type'
> & {
  /** Drafted from the description, suggested by Aivera, or added by the recruiter (by hand or from the starters). */
  origin: Competency['origin'];
  /** A suggestion's "Why:" sentence; null for any other competency. */
  why: string | null;
  /** Empty for a competency the recruiter added or took from the job type's starters, or from a domain pack. */
  excerpts: Excerpt[];
  /** The domain pack and catalogue version it came from, and a regional hint's region; null for any other competency. */
  pack: { key: string; version: number; region: string | null } | null;
};
/** `removed`: taken out of the rubric, kept on the page so it can be restored with its weight. */
export type DraftRow = DraftCompetency & { id: string; removed: boolean };

/** What "Draft competencies" answers. Nothing is saved in any of them. */
export type DraftResult =
  | { status: 'idle' }
  | { status: 'invalid'; errors: NewJobState['errors'] }
  /** No description to draft from. */
  | { status: 'empty' }
  /**
   * The drafted competencies, then the suggestions. `leftOutNonSkill`: a line asking for something that is not a skill
   * (a nationality, an age) was left out.
   */
  | {
      status: 'drafted';
      competencies: DraftCompetency[];
      leftOutNonSkill: boolean;
      /** The job type drafted for, which picks each pack's suggestions. */
      jobType: string;
      /** The hiring company's industry and the description sentence it rests on; null when none is clear. */
      industry: { key: string; excerpts: Excerpt[] } | null;
      /** The job's regions, whose hints a pack suggests. */
      regions: string[];
    }
  /** The model failed, or its answer was rejected twice by the citation contract. */
  | { status: 'failed' }
  /** The workspace has used its daily AI budget. */
  | { status: 'budget' };

const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

/** The sentence or list line of `text` holding [start, end), with the span's offsets within it. */
export function excerptOf(text: string, start: number, end: number): Excerpt {
  const segments = [...sentences.segment(text)];
  const first = segments.findLast((s) => s.index <= start) ?? { index: 0, segment: '' };
  const last = segments.findLast((s) => s.index < end) ?? first;
  const from = first.index;
  return { text: text.slice(from, last.index + last.segment.length).trimEnd(), start: start - from, end: end - from };
}

/** A drafted or suggested competency as the step shows it: its cited spans become excerpts of the description. */
export const toDraftCompetency = (
  description: string,
  c: DraftedCompetency | SuggestedCompetency,
): DraftCompetency => ({
  name: c.name,
  evidenceExpected: c.evidenceExpected,
  weightPercent: c.weightPercent,
  levelNeeded: c.levelNeeded,
  type: c.type,
  origin: c.origin,
  why: c.origin === 'suggested_by_aivera' ? c.why : null,
  excerpts: c.citations.map((citation) => excerptOf(description, citation.start, citation.end)),
  pack: null,
});

/** The detected industry with its cited sentences, and the regions; no detection (it failed) is no industry. */
export const toDetectedIndustry = (description: string, detection: DomainDetection | null) => ({
  industry:
    detection && detection.domain !== 'none'
      ? {
          key: detection.domain,
          excerpts: detection.citations
            .filter((c) => c.sourceId === 'description')
            .map((c) => excerptOf(description, c.start, c.end)),
        }
      : null,
  regions: detection?.regions.map((r) => r.region) ?? [],
});

/** The industries "Add industry skills" offers and the regions whose hints it shows: the catalogue's, not retired. */
export const catalogueChoices = (catalogue: CatalogueVersion) => ({
  packs: catalogue.packs.filter((p) => !p.retired).map((p) => ({ key: p.key, label: p.label.en })),
  regions: catalogue.regions.filter((r) => !r.retired).map((r) => ({ key: r.key, label: r.label.en })),
});
export type Choice = { key: string; label: string };

const fromPack = (
  c: CatalogueCompetency | CatalogueHint,
  key: string,
  version: number,
  region: string | null,
): DraftCompetency => ({
  name: c.name,
  evidenceExpected: c.evidence,
  weightPercent: 10,
  levelNeeded: c.levelNeeded,
  type: c.type,
  origin: 'domain_pack',
  why: null,
  excerpts: [],
  pack: { key, version, region },
});

/**
 * A pack's suggestions for the job type: its core competencies, then its hints for the job's regions (AIV-P1-064), each
 * recording the catalogue version they are copied from.
 */
export function packCompetencies(
  catalogue: CatalogueVersion,
  key: string,
  jobType: string,
  regions: readonly string[],
): DraftCompetency[] {
  const pack = packForJobType(catalogue, key, jobType);
  if (!pack) return [];
  return [
    ...pack.core.map((c) => fromPack(c, key, catalogue.version, null)),
    ...regions.flatMap((region) =>
      pack.hints.filter((h) => h.region === region).map((h) => fromPack(h, key, catalogue.version, region)),
    ),
  ];
}

/** "More from this pack": the pack's other competencies for the job type that no row is named like yet. */
export const morePackCompetencies = (
  catalogue: CatalogueVersion,
  key: string,
  jobType: string,
  rows: readonly { name: string }[],
) =>
  (packForJobType(catalogue, key, jobType)?.more ?? [])
    .filter((c) => !rows.some((row) => nameKey(row.name) === nameKey(c.name)))
    .map((c) => fromPack(c, key, catalogue.version, null));

/**
 * The rows with the pack's suggestions swapped for `pack`: every row of the previous pack goes, kept or removed, and a
 * pack competency named like a row already there (drafted from the description, say) is not repeated.
 */
export function withPack<T extends DraftCompetency>(rows: readonly T[], pack: readonly T[]): T[] {
  const kept = rows.filter((row) => row.origin !== 'domain_pack');
  const names = new Set(kept.map((row) => nameKey(row.name)));
  return [...kept, ...pack.filter((c) => !names.has(nameKey(c.name)))];
}

// shortcut: AIV-P1-009's generic industry suggestion ("Banking and payments domain", "Retail industry knowledge") is
// told apart by a name that ends so; give suggestions a kind in the prompt (with an eval run) if one still slips by.
const GENERIC_INDUSTRY = /\s(domain|industry)( knowledge| expertise)?$/i;

/**
 * The rows the step shows and saves: with an industry chosen, AIV-P1-009's generic industry suggestion gives way to the
 * pack's niche ones. It stays in the rows, so clearing the industry brings it back.
 */
export const visibleRows = <T extends DraftCompetency>(rows: readonly T[], industry: string | null): T[] =>
  rows.filter((row) => !industry || row.origin !== 'suggested_by_aivera' || !GENERIC_INDUSTRY.test(row.name));

/**
 * The row with the recruiter's change, or null when it is refused: regional knowledge is shown through evidence, so a
 * regional hint can only be desirable, never a mandatory requirement or a location filter (AGENTS.md 1.5).
 */
export function changeRow<T extends DraftCompetency>(
  catalogue: CatalogueVersion,
  row: T,
  change: Partial<DraftCompetency>,
): T | null {
  const next = { ...row, ...change };
  return next.type === 'mandatory' && (row.pack?.region || isRegionalHint(catalogue, next.name)) ? null : next;
}

/** The fallback when there is no draft: the job type's four starter competencies, equal weights, for the recruiter to edit. */
export const starterCompetencies = (catalogue: CatalogueVersion, jobType: string): DraftCompetency[] =>
  (catalogue.jobTypes.find((e) => e.key === jobType)?.starterCompetencies ?? []).map((name) => ({
    name,
    evidenceExpected: '',
    weightPercent: 25,
    levelNeeded: 3,
    type: 'mandatory',
    origin: 'added_by_recruiter',
    why: null,
    excerpts: [],
    pack: null,
  }));

export const blankCompetency = (): DraftCompetency => ({
  name: '',
  evidenceExpected: '',
  weightPercent: 10,
  levelNeeded: 3,
  type: 'mandatory',
  origin: 'added_by_recruiter',
  why: null,
  excerpts: [],
  pack: null,
});

/** What the weights of the competencies still in the rubric add up to; anything but 100 rebalances on save. */
export const weightsTotal = (rows: readonly DraftRow[]) =>
  rows.reduce((sum, row) => (row.removed ? sum : sum + row.weightPercent), 0);

/** At most this many competencies in a rubric: 8 drafted, 2 suggested, a pack's core and regional hints, and room. */
export const RUBRIC_MAX = 30;

const competency = z.object({
  name: z.string().trim().min(1).max(120),
  evidenceExpected: z.string().trim().max(400),
  weightPercent: z.number().int().min(1).max(100),
  levelNeeded: z.number().int().min(1).max(5),
  type: z.enum(COMPETENCY_TYPES),
  origin: z.enum(COMPETENCY_ORIGINS),
  // The jobs module checks they are set exactly on `domain_pack` competencies, against the published catalogue.
  packKey: z.string().regex(CATALOGUE_KEY).nullable().default(null),
  packVersion: z.int().min(1).nullable().default(null),
});

/** The posted `rubric` field: the kept competencies in display order (AGENTS.md 3.7). Null when it is not valid. */
export function parseRubric(value: FormDataEntryValue | null): Competency[] | null {
  try {
    const parsed = z
      .array(competency)
      .min(1)
      .max(RUBRIC_MAX)
      .safeParse(JSON.parse(String(value)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The kept competencies as the `rubric` field posts them: no ids, excerpts, why or removed rows. */
export const rubricJson = (rows: readonly DraftRow[]) =>
  JSON.stringify(
    rows
      .filter((row) => !row.removed)
      .map(({ name, evidenceExpected, weightPercent, levelNeeded, type, origin, pack }) => ({
        name,
        evidenceExpected,
        weightPercent,
        levelNeeded,
        type,
        origin,
        packKey: pack?.key ?? null,
        packVersion: pack?.version ?? null,
      })),
  );

export type RowErrors = Record<string, { name?: true; weight?: true }>;

/** The kept rows' fields to fix before saving: a name, and a weight that is a whole percent from 1 to 100. */
export function rowErrors(rows: readonly DraftRow[]): RowErrors {
  const errors: RowErrors = {};
  for (const row of rows) {
    if (row.removed) continue;
    const weight = Number.isInteger(row.weightPercent) && row.weightPercent >= 1 && row.weightPercent <= 100;
    if (!row.name.trim() || !weight)
      errors[row.id] = { ...(!row.name.trim() && { name: true }), ...(!weight && { weight: true }) };
  }
  return errors;
}
