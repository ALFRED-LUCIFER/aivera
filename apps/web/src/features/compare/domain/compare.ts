import type { ExplanationStatement } from '@credalent/assessment';
import { z } from 'zod';
import type { EvidenceCard } from '@/features/evidence-profile/domain/evidenceCards.ts';

// The comparison page (AIV-P1-047): the candidates a recruiter ticked on the ranking, side by side on the job's
// competencies. Pure. The browser takes this file's types and limits; nothing here reads or changes a score.

/**
 * A comparison holds 2 to 10 candidates (owner decision 26 Nov 2026: any number the recruiter ticks, not the ticket's
 * 2 or 3). The upper limit bounds the page's reads and the trade-offs prompt; it is `MAX_COMPARED` of
 * `@credalent/assessment`, repeated here because the browser cannot import the module (compare.test.ts holds them equal).
 */
export const MIN_COMPARE = 2;
export const MAX_COMPARE = 10;

/** The comparison's address: the job and the candidates' opaque person ids, as the profile is addressed (AGENTS.md 1.2). */
export const compareHref = (jobId: string, personIds: readonly string[]) =>
  `/app/jobs/${jobId}/compare?ids=${personIds.join(',')}`;

// Bounded before it is split: the address bar is a trust boundary (AGENTS.md 3.7).
const idsParam = z
  .string()
  .max(2_000)
  .transform((value) => [...new Set(value.split(',').filter(Boolean))])
  .pipe(z.array(z.uuid()).max(50));

/** The page's `ids` value as distinct person ids in the order given; none when absent, null when it is not a list of ids. */
export const parseIds = (param: unknown): string[] | null =>
  param === undefined ? [] : (idsParam.safeParse(param).data ?? null);

/** What the browser may send to ask for the trade-offs: opaque ids only, checked again on the server. */
export const tradeoffsInput = z.object({
  jobId: z.uuid(),
  candidateIds: z.array(z.uuid()).min(MIN_COMPARE).max(MAX_COMPARE),
});

// The shapes @credalent/ai's redaction replaces before a prompt (packages/ai identifiers.ts), which the browser cannot import.
const CONTACT = new RegExp(
  [
    String.raw`[\p{L}\p{M}\p{N}_.%+-]+@[\w-]+(?:\.[\w-]+)+`,
    String.raw`(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/\S*`,
    String.raw`(?<![\w+(.,])\(?(?:\+|00)?\(?\d(?:[ ()-]{0,2}\d){7,14}(?![\w]|[.,]\d)`,
  ].join('|'),
  'giu',
);
// A phone starts with +, 00, 0 or a bracket, or has a run of four digits; a run of years or an ISO date is not one.
const contactShaped = (match: string) =>
  /[@/]/.test(match) ||
  ((/^\(?(?:\+|0)/.test(match) || /\d{4}/.test(match)) && !/^(?:(?:19|20)\d\d[ -]*)+$|^\d{4}-\d\d-\d\d$/.test(match));

/**
 * An excerpt with every email, phone and LinkedIn address cut to "…", as a quote elides: a comparison is handed off
 * printed, and contact details stay private until the candidate accepts an introduction (AGENTS.md 1.9).
 */
// shortcut: emails, phones and LinkedIn addresses only (no postal address or other profile site); widen from pilot excerpts.
export const withoutContacts = (text: string) => text.replace(CONTACT, (m) => (contactShaped(m) ? '…' : m));

export type Verdict = 'above' | 'meets' | 'below';
/** "Above the need · 5 against 4": the proven level against the level the job needs. A claim counts zero (AGENTS.md 1.6). */
export const verdictOf = (proven: number, needed: number): Verdict =>
  proven > needed ? 'above' : proven === needed ? 'meets' : 'below';

/** One candidate's cell for one competency. `lead` and `summary` are null when the assessment cites nothing for it. */
export type CompareCell = {
  proven: number;
  lead: EvidenceCard['lead'];
  claimOnly: boolean;
  /** The first cited item's own words, those behind the proven level first. */
  summary: string | null;
};

export type CompareColumn = {
  candidateId: string;
  /** Null only if the person record is gone. */
  name: string | null;
  /** Null until the candidate is scored on the approved rubric version. */
  score: { backed: number; upTo: number } | null;
  /** By competency id; a competency the candidate's result does not hold has no cell. */
  cells: Record<string, CompareCell>;
};

export type CompareRow = { competencyId: string; name: string; weightPercent: number; needed: number };

type Base = {
  jobId: string;
  jobTitle: string;
  /** The ranking with these candidates still ticked. */ selectionHref: string;
};

/** The page as it is handed to the browser: plain data. */
export type CompareData =
  | (Base & { status: 'tooFew' })
  | (Base & { status: 'notOnJob' })
  | (Base & {
      status: 'ready';
      /** When the page was read: the printed hand-off's "Prepared" date. */
      preparedAt: Date;
      /** Null until a rubric version is approved: nothing is assessed before that. */
      rubricVersion: number | null;
      rows: CompareRow[];
      columns: CompareColumn[];
    });

/**
 * "7 points separate the 3 candidates": the gap between the highest and lowest backed score, and whether the order
 * could change if claims hold (a lower candidate's "up to" reaches the highest backed score), whatever the gap's size.
 * Null unless everyone is scored.
 */
export function closingOf(
  columns: readonly Pick<CompareColumn, 'score'>[],
): { points: number; count: number; couldChange: boolean } | null {
  const scores = columns.flatMap((c) => c.score ?? []);
  if (scores.length < MIN_COMPARE || scores.length !== columns.length) return null;
  const top = Math.max(...scores.map((s) => s.backed));
  return {
    points: top - Math.min(...scores.map((s) => s.backed)),
    count: scores.length,
    couldChange: scores.some((s) => s.backed < top && s.upTo >= top),
  };
}

/** The trade-offs as the browser shows them: each candidate's statements with where each cited item is on their profile. */
export type TradeoffsView =
  | { status: 'unavailable' }
  | {
      status: 'written';
      candidates: {
        candidateId: string;
        name: string | null;
        /** Their evidence profile for this job, where a statement of the snapshot's facts is backed. */
        profileHref: string;
        statements: (Pick<ExplanationStatement, 'text'> & {
          /**
           * A fact of the snapshot, written as the rest of a sentence that begins with the candidate's name; otherwise
           * an excerpt of their cited work, whole, which its one citation repeats.
           */
          ofSnapshot: boolean;
          /** The cited work, linking to that item on the candidate's profile; none for a fact of the snapshot. */
          citations: { key: string; quote: string; label: string; href: string }[];
        })[];
      }[];
    };
