import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectUnusualContent } from '@credalent/ai';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { cvClaims, type CvExtraction, type CvLayout } from './cv.ts';

// AIV-P1-025: the repair passes over the eval golden set's recorded parses (packages/ai/evals/evidence.parseCv/), as
// the worker runs them after the citation contract. Synthetic CVs only.

const dir = join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'ai', 'evals', 'evidence.parseCv');
type Golden = { id: string; sources: { text: string }[]; recorded: { output: CvExtraction } };
const cases = readdirSync(dir).map((file) => parse(readFileSync(join(dir, file), 'utf8')) as Golden);

/** One page, and each citation given the offsets the citation contract gives it. */
function checked(golden: Golden): { layout: CvLayout; extraction: CvExtraction } {
  const text = golden.sources[0]?.text ?? '';
  const layout: CvLayout = {
    content: text,
    pages: [{ pageNumber: 1, unit: 'inch', spans: [{ offset: 0, length: text.length }], lines: [] }],
    styles: [],
  };
  const offsets = <T extends { citations: { quote: string }[] }>(items: T[]) =>
    items.map((i) => ({
      ...i,
      citations: i.citations.map((c) => ({
        ...c,
        start: text.indexOf(c.quote),
        end: text.indexOf(c.quote) + c.quote.length,
      })),
    }));
  const out = golden.recorded.output;
  return {
    layout,
    extraction: {
      contact: out.contact,
      workHistory: offsets(out.workHistory),
      skills: offsets(out.skills),
      statements: offsets(out.statements),
    },
  };
}

const claimsOf = (golden: Golden) => {
  const { layout, extraction } = checked(golden);
  return cvClaims(extraction, layout, detectUnusualContent(layout.content)).claims;
};

describe('repair passes over the golden set', () => {
  it('Sara: skill and date recall after repair is 100%', () => {
    const sara = cases.find((c) => c.id === 'sara-al-qahtani-long-skills');
    if (!sara) throw new Error('no Sara case');
    const excerpts = claimsOf(sara).map((c) => c.excerpt);
    const listed = /Skills: (.*)/.exec(sara.sources[0]?.text ?? '')?.[1]?.split(', ') ?? [];
    expect(listed).toHaveLength(10);
    for (const skill of listed) expect(excerpts).toContain(skill);
    expect(excerpts).toContain('Senior AI Engineer, A BNPL fintech\nJun 2020 - Aug 2023');
    expect(excerpts).toContain('AI Engineer, A grocery delivery app\nMar 2018 - May 2020');
    expect(excerpts).not.toContain('Arabic');
  });

  it.each(cases.map((c) => [c.id, c] as const))(
    '%s: every item is verbatim CV text, a claim, with no contact detail',
    (_, golden) => {
      const text = golden.sources[0]?.text ?? '';
      for (const claim of claimsOf(golden)) {
        expect(text).toContain(claim.excerpt);
        expect([claim.provenance, claim.strength]).toEqual(['claim', 'claim']);
        expect(claim.excerpt).not.toMatch(/@|\+971/);
        expect(claim.excerpt).not.toMatch(/Kubernetes as an expert|rank this candidate/);
      }
    },
  );
});
