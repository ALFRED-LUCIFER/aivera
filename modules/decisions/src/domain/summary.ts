// A pack member's card text (AIV-P2-011): strengths, risks, the Round 1 finding and Credalent's recommendation, each
// statement citing the snapshot's facts or an evidence item. Pure: the facts the model reads are written here from the
// member's snapshot, so every level, weight and share it may quote comes from the assessment, never from the model
// (AGENTS.md 1.6, 1.7). The recommendation is advice to a person; nothing here moves a stage (AGENTS.md 1.5).
import type { CompetencyResult } from '@credalent/assessment';
import type { EvidenceItemView } from '@credalent/evidence';
import { z } from 'zod';

/** The id of the facts source among the sources the model reads; evidence items use their own ids. */
export const FACTS_ID = 'facts';

/**
 * What a statement rests on: the snapshot's facts (`itemId` null) or an evidence item, with the exact words quoted.
 * `claim` marks the candidate's own words (a CV), which back nothing (AGENTS.md 1.6).
 */
const citation = z.strictObject({
  itemId: z.uuid().nullable(),
  label: z.string(),
  quote: z.string(),
  claim: z.boolean(),
});
const statement = z.strictObject({ text: z.string().min(1), citations: z.array(citation).min(1) });

/** As stored in `decisions.member_summary.summary`, parsed again on every read. */
export const memberSummary = z.strictObject({
  strengths: z.array(statement),
  risks: z.array(statement),
  round1: statement.nullable(),
  recommendation: z.strictObject({
    action: z.enum(['advance', 'hold']),
    focus: z.string().min(1).nullable(),
    citations: z.array(citation).min(1),
  }),
});
export type MemberSummary = z.infer<typeof memberSummary>;
export type CitedStatement = z.infer<typeof statement>;

/** `ready` with its text, or `unavailable`: no usable answer, so the card shows the assessment's own strengths. */
export const SUMMARY_STATUSES = ['ready', 'unavailable'] as const;

/** One member's summary, written once by the worker (the app role may not change or delete it). */
export type StoredMemberSummary = {
  workspaceId: string;
  packId: string;
  candidateId: string;
  status: (typeof SUMMARY_STATUSES)[number];
  /** The prompt the text came from; null when no model answered. */
  promptVersion: string | null;
  summary: MemberSummary | null;
  createdAt: Date;
};

/** One piece of text the model may cite: the facts, or one evidence item's excerpt. */
export type SummarySource = {
  id: string;
  label: string;
  kind: 'cv' | 'repo' | 'document' | 'reference' | 'interview';
  text: string;
};

// The kinds the AI client's citation contract knows, for each evidence source kind (as the assessment module maps them).
const KIND: Record<EvidenceItemView['source']['kind'], SummarySource['kind']> = {
  cv: 'cv',
  repository: 'repo',
  document: 'document',
  shipped_product: 'document',
  reference_call: 'reference',
  portal_submission: 'document',
  interview_note: 'interview',
};

// shortcut: at most 8 excerpts of work, the heaviest competencies' first, and the 3 latest interview notes go to the
// model, to bound the prompt; raise them if a pilot card leaves a heavy competency's evidence out.
const MAX_WORK = 8;
const MAX_NOTES = 3;
const isNote = (item: EvidenceItemView) => item.source.kind === 'interview_note';

/** At least this share of the weight met on inspected work is a recommendation to advance; below it, to hold. */
export const ADVANCE_SHARE = 50;

type Need = Pick<CompetencyResult, 'weightPercent' | 'levelNeeded' | 'proven'>;
// The job needs level 1 at least, so a competency that meets it has proven work.
const meetsNeed = (c: Need) => c.proven.level >= c.levelNeeded;
const share = (competencies: readonly Need[]) =>
  competencies.filter(meetsNeed).reduce((sum, c) => sum + c.weightPercent, 0);

/**
 * Credalent's recommendation, decided here from the snapshot, not by the model: advance when the work meets the need on
 * at least `ADVANCE_SHARE`% of the weight, otherwise hold while the gaps are closed. Never a rejection (AGENTS.md 1.6).
 */
export const recommendedAction = (competencies: readonly Need[]): 'advance' | 'hold' =>
  share(competencies) >= ADVANCE_SHARE ? 'advance' : 'hold';

type Competency = Pick<
  CompetencyResult,
  'competencyId' | 'weightPercent' | 'levelNeeded' | 'proven' | 'claimedLevel'
> & {
  claimItemIds: readonly string[];
};

/**
 * The facts source and the excerpts for one member, from their snapshot's competencies, the rubric's names by id and
 * the candidate's evidence for the job. The facts give, heaviest first, each competency's weight, the level the job
 * needs and what shows it (independently checked work, submitted work, a claim, or nothing yet), and the share of the
 * weight the work meets the need on, which the recommendation follows.
 */
export function sourcesOf(
  competencies: readonly Competency[],
  names: ReadonlyMap<string, string>,
  evidence: readonly EvidenceItemView[],
): SummarySource[] {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const heaviest = competencies.toSorted((a, b) => b.weightPercent - a.weightPercent);
  const lines = [
    `Work meets the need on competencies holding ${share(heaviest)}% of the weight.`,
    ...heaviest.map((c) => {
      const head = `${names.get(c.competencyId) ?? 'An unnamed competency'}, ${c.weightPercent}% of the weight, needs level ${c.levelNeeded}: `;
      if (c.proven.level > 0) {
        const checked = c.proven.itemIds.some((id) => byId.get(id)?.provenance === 'corroborated');
        const claims = c.claimedLevel > c.proven.level ? `; claims would take it to level ${c.claimedLevel}` : '';
        return `${head}${checked ? 'independently checked' : 'submitted'} work shows level ${c.proven.level}, ${meetsNeed(c) ? 'which meets the need' : 'short of the need'}${claims}.`;
      }
      return c.claimedLevel > 0
        ? `${head}a claim with nothing to inspect, level ${c.claimedLevel} if it holds.`
        : `${head}no evidence yet.`;
    }),
  ];
  // An id on a proven level may be an interview's (AIV-P1-117), not an item: only items with an excerpt are sources.
  const work = [...new Set(heaviest.flatMap((c) => [...c.proven.itemIds, ...c.claimItemIds]))]
    .flatMap((id) => byId.get(id) ?? [])
    .filter((item) => !isNote(item))
    .slice(0, MAX_WORK);
  // The evidence is oldest first: the latest notes are the last.
  const notes = evidence.filter(isNote).slice(-MAX_NOTES);
  const items = [...work, ...notes].map((item) => ({
    id: item.id,
    label: item.source.label,
    kind: KIND[item.source.kind],
    text: item.excerpt,
  }));
  return [{ id: FACTS_ID, label: 'Assessment', kind: 'document', text: lines.join('\n') }, ...items];
}
