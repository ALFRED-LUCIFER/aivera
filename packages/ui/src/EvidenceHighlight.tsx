import type { ReactNode } from 'react';

/** `start` and `end` are UTF-16 code unit offsets, as JavaScript string indices are; `end` is exclusive. */
// shortcut: offsets are UTF-16 code units; the evidence producer (AIV-P1-027) must emit the same
export type Citation = { start: number; end: number; sourceId: string };

export type EvidenceHighlightProps = {
  text: string;
  /** Offsets into `text`, in any order; they must not overlap or split a surrogate pair. */
  citations: Citation[];
  /** Read before each cited span, e.g. "cited evidence", from i18n. */
  markLabel: string;
};

const splitsPair = (text: string, i: number) => /[\uDC00-\uDFFF]/.test(text[i] ?? '');

/** The highlighter (--hl) marks cited evidence and nothing else, so this takes offsets, never styling. */
export function EvidenceHighlight({ text, citations, markLabel }: EvidenceHighlightProps) {
  const sorted = citations.toSorted((a, b) => a.start - b.start);
  const valid = sorted.every(
    (c, i) =>
      Number.isInteger(c.start) &&
      Number.isInteger(c.end) &&
      c.start >= (sorted[i - 1]?.end ?? 0) &&
      c.start < c.end &&
      c.end <= text.length &&
      !splitsPair(text, c.start) &&
      !splitsPair(text, c.end),
  );
  if (!valid) {
    if (process.env['NODE_ENV'] !== 'production') {
      // Offsets only: the text is candidate evidence and never goes to a log (AGENTS.md 1.2).
      console.warn('EvidenceHighlight: citation out of range, overlapping or splitting a character; plain text', {
        textLength: text.length,
        citations: citations.map(({ start, end }) => ({ start, end })),
      });
    }
    return <>{text}</>;
  }

  const parts: ReactNode[] = [];
  let at = 0;
  for (const c of sorted) {
    parts.push(
      text.slice(at, c.start),
      // ARIA 1.3 prohibits naming a mark with aria-label, so the label is visually hidden text inside it.
      // shortcut: the hidden label is included when the text is copied; move it to CSS generated content if users mind
      // The ink underline keeps cited text identifiable without colour (WCAG 1.4.1).
      <mark
        key={c.start}
        data-source-id={c.sourceId}
        className="rounded-xs bg-hl px-0.75 py-px text-hl-text underline decoration-hl-text decoration-2 underline-offset-2"
      >
        <span className="sr-only">{markLabel} </span>
        {text.slice(c.start, c.end)}
      </mark>,
    );
    at = c.end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
