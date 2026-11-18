import type { ReactNode } from 'react';

export type Citation = { start: number; end: number; sourceId: string };

export type EvidenceHighlightProps = {
  text: string;
  /** Character offsets [start, end) into `text`, in any order; they must not overlap. */
  citations: Citation[];
  /** Read before each cited span, e.g. "cited evidence", from i18n. */
  markLabel: string;
};

/** The highlighter (--hl) marks cited evidence and nothing else, so this takes offsets, never styling. */
export function EvidenceHighlight({ text, citations, markLabel }: EvidenceHighlightProps) {
  const sorted = citations.toSorted((a, b) => a.start - b.start);
  const valid = sorted.every(
    (c, i) =>
      Number.isInteger(c.start) &&
      Number.isInteger(c.end) &&
      c.start >= (sorted[i - 1]?.end ?? 0) &&
      c.start < c.end &&
      c.end <= text.length,
  );
  if (!valid) {
    // Offsets only: the text is candidate evidence and never goes to a log (AGENTS.md 1.2).
    console.warn('EvidenceHighlight: citation out of range or overlapping; rendering plain text', {
      textLength: text.length,
      citations: citations.map(({ start, end }) => ({ start, end })),
    });
    return <>{text}</>;
  }

  const parts: ReactNode[] = [];
  let at = 0;
  for (const c of sorted) {
    parts.push(
      text.slice(at, c.start),
      // ARIA 1.3 prohibits naming a mark with aria-label, so the label is visually hidden text inside it.
      <mark key={c.start} data-source-id={c.sourceId} className="rounded-xs bg-hl px-0.75 py-px text-hl-text">
        <span className="sr-only">{markLabel} </span>
        {text.slice(c.start, c.end)}
      </mark>,
    );
    at = c.end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
