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

/** One source chip of a card: an outside link, an uploaded file the viewer may open, plain text, or how it was checked. */
export type SourceChip = { key: string } & (
  | { kind: 'link'; text: string; url: string }
  | { kind: 'file'; text: string; fileId: string }
  | { kind: 'text'; text: string }
  | { kind: 'check'; method: string; at: Date }
);

export type EvidenceCard = {
  competencyId: string;
  name: string;
  weightPercent: number;
  /** The strongest cited item's strength and provenance; null when the assessment cites nothing for the competency. */
  lead: { strength: Strength; provenance: Provenance } | null;
  /** The cited items, those behind the proven level first. A claim-only item is not highlighted: nothing to inspect. */
  items: { id: string; excerpt: string; highlighted: boolean }[];
  sources: SourceChip[];
  /** What the cited evidence does not show. A claim-only item states none here: it counts zero, which the card says. */
  limits: string[];
};

/** "Unusual content in this source": the quoted excerpt with its citation ("CV, page 1"). It changes no score. */
export type SourceNoteView = { key: string; citation: string; excerpt: string; hidden: boolean };

/** "github.com/…/llm-eval-harness": the host and the last path segment. */
export function shortUrl(url: string): string | null {
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

function chips(items: readonly EvidenceItemView[], canOpenFiles: boolean): SourceChip[] {
  const found = new Map<string, SourceChip>();
  for (const { source, excerptSpan } of items) {
    const key = `${source.id}:${excerptSpan ?? ''}`;
    const text = citation(source, excerptSpan);
    // https only is checked when a source is stored (evidence `checkSource`), so the link is never a script.
    if (source.url) found.set(key, { key, kind: 'link', text, url: source.url });
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
      return {
        competencyId: result.competencyId,
        name,
        weightPercent: result.weightPercent,
        lead: lead ? { strength: lead.strength, provenance: lead.provenance } : null,
        items: items.map((i) => ({ id: i.id, excerpt: i.excerpt, highlighted: i.strength !== 'claim' })),
        sources: chips(items, canOpenFiles),
        limits: [...new Set(items.filter((i) => i.strength !== 'claim').map((i) => i.limit))],
      };
    });
}
