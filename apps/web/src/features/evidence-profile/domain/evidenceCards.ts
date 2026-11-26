import type { CompetencyResult } from '@credalent/assessment';
import {
  STRENGTHS,
  type EvidenceItemView,
  type EvidenceSource,
  type Provenance,
  type Strength,
} from '@credalent/evidence';

// "Competency by competency" (AIV-P1-045): what each competency's score rests on, built from the stored assessment's
// cited items. Pure: the service reads, this shapes. The browser takes only this file's types: its one value import
// (STRENGTHS) stays on the server.

/**
 * One source chip of a card: an outside link, an uploaded file the viewer may open, plain text, or how it was checked.
 * A link's `via` says how Credalent came to read it ("from the GitHub profile in the CV", AIV-P1-118); absent when the
 * candidate linked it themselves.
 */
export type SourceChip = { key: string } & (
  | { kind: 'link'; text: string; url: string; via?: NonNullable<EvidenceItemView['source']['via']> }
  | { kind: 'file'; text: string; fileId: string }
  | { kind: 'text'; text: string }
  | { kind: 'check'; method: string; at: Date }
);

/** A provenance as shown: `interviewer` for an interviewer's summary or note counted as submitted (AIV-P1-115). */
export type ShownProvenance = Provenance | 'interviewer';

export type EvidenceCard = {
  competencyId: string;
  name: string;
  weightPercent: number;
  /** The strongest cited item's strength and provenance; null when the assessment cites nothing for the competency. */
  lead: { strength: Strength; provenance: ShownProvenance } | null;
  /**
   * The cited items, those behind the proven level first. Only an item behind the proven level is highlighted; one
   * that counts toward the claimed level only never is. `own` is the item's strength and provenance when either
   * differs from the lead's, so no item reads under a stronger label than its own (AGENTS.md 1.6).
   */
  items: { id: string; excerpt: string; highlighted: boolean; own: EvidenceCard['lead'] }[];
  sources: SourceChip[];
  /**
   * Nothing behind the proven level, only claims: the competency is backed at zero, whatever strength a claim is
   * stored with, and the card says so (AGENTS.md 1.6).
   */
  claimOnly: boolean;
  /** What the cited evidence does not show. A Claim only item states none here: nothing was inspected. */
  limits: string[];
};

/** "Unusual content in this source": the quoted excerpt with its citation ("CV, page 1"). It changes no score. */
export type SourceNoteView = { key: string; citation: string; excerpt: string; hidden: boolean };

/** "github.com/…/llm-eval-harness": the host and the last path segment. */
function shortUrl(url: string): string | null {
  const parsed = URL.parse(url);
  if (!parsed) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  return parts.length > 1 ? `${parsed.host}/…/${parts.at(-1)}` : [parsed.host, ...parts].join('/');
}

/** How a source is cited: a repository by its address, anything else by its label, then the span ("CV, page 2"). */
export function citation(source: Pick<EvidenceSource, 'kind' | 'label' | 'url'>, span: string | null): string {
  const name = (source.kind === 'repository' && source.url && shortUrl(source.url)) || source.label;
  return span ? `${name}, ${span}` : name;
}

export const sourceNote = (
  source: Pick<EvidenceSource, 'id' | 'kind' | 'label' | 'url'>,
  note: { reason: string; excerpt: string; excerptSpan?: string | null },
  index: number,
): SourceNoteView => ({
  key: `${source.id}:${index}`,
  citation: citation(source, note.excerptSpan ?? null),
  excerpt: note.excerpt,
  hidden: note.reason === 'hidden_text',
});

const stronger = (a: EvidenceItemView, b: EvidenceItemView) =>
  STRENGTHS.indexOf(a.strength) - STRENGTHS.indexOf(b.strength);

// SAFETY: an interviewer's word is stored as submitted work but is neither the candidate's nor checked: it never reads
// "Candidate-submitted" or "Independently corroborated" (AGENTS.md 1.6).
const shown = (i: EvidenceItemView): ShownProvenance =>
  i.source.kind === 'interview_note' && (i.provenance === 'submitted' || i.provenance === 'corroborated')
    ? 'interviewer'
    : i.provenance;

function chips(items: readonly EvidenceItemView[], canOpenFiles: boolean): SourceChip[] {
  const found = new Map<string, SourceChip>();
  for (const { source, excerptSpan } of items) {
    const key = `${source.id}:${excerptSpan ?? ''}`;
    const text = citation(source, excerptSpan);
    // https only is checked when a source is stored (evidence `checkSource`), so the link is never a script.
    // SAFETY: only a read that came by the GitHub profile in the CV says so; every other link keeps the plain chip.
    if (source.url)
      found.set(key, { key, kind: 'link', text, url: source.url, ...(source.via && { via: source.via }) });
    // SAFETY: a file id reaches the browser only for a viewer who may open raw candidate files (AGENTS.md 1.9).
    else if (source.blobFileId && canOpenFiles) found.set(key, { key, kind: 'file', text, fileId: source.blobFileId });
    else found.set(key, { key, kind: 'text', text });
    if (source.checkedAt && source.checkMethod)
      found.set(`${source.id}:checked`, {
        key: `${source.id}:checked`,
        kind: 'check',
        method: source.checkMethod,
        at: source.checkedAt,
      });
  }
  return [...found.values()];
}

/**
 * One card per competency of the stored assessment, heaviest first (the rubric's order between equal weights). A card
 * shows only the items the assessment cites: those behind the proven level, then those that count toward the claimed
 * level only. `names` are the approved rubric's competency names by id; a competency it does not name gets no card.
 */
export function evidenceCards(
  results: readonly CompetencyResult[],
  names: ReadonlyMap<string, string>,
  evidence: readonly EvidenceItemView[],
  canOpenFiles: boolean,
): EvidenceCard[] {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const pick = (ids: readonly string[]) => ids.flatMap((id) => byId.get(id) ?? []);
  return results
    .toSorted((a, b) => b.weightPercent - a.weightPercent)
    .flatMap((result) => {
      const name = names.get(result.competencyId);
      if (name === undefined) return [];
      const proven = pick(result.proven.itemIds);
      const claims = pick(result.claimItemIds);
      const items = [...proven, ...claims];
      const [lead] = (proven.length ? proven : claims).toSorted(stronger);
      const view = (i: EvidenceItemView, backs: boolean) => ({
        id: i.id,
        excerpt: i.excerpt,
        // SAFETY: the highlighter marks only what the proven level rests on; a claim is never highlighted, whatever
        // its strength (a CV line is stored as Supporting, "Claim awaiting validation").
        highlighted: backs && i.provenance !== 'claim',
        own:
          lead && (i.strength !== lead.strength || shown(i) !== shown(lead))
            ? { strength: i.strength, provenance: shown(i) }
            : null,
      });
      return {
        competencyId: result.competencyId,
        name,
        weightPercent: result.weightPercent,
        lead: lead ? { strength: lead.strength, provenance: shown(lead) } : null,
        items: [...proven.map((i) => view(i, true)), ...claims.map((i) => view(i, false))],
        sources: chips(items, canOpenFiles),
        claimOnly: proven.length === 0 && claims.length > 0,
        limits: [...new Set(items.filter((i) => i.strength !== 'claim').map((i) => i.limit))],
      };
    });
}
