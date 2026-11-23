import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contrast, resolveColour, type Theme } from '../test/theme.ts';
import { EvidenceHighlight } from './EvidenceHighlight.tsx';
import { ProvenanceTag, type Provenance } from './ProvenanceTag.tsx';
import { StrengthMeter, type Strength } from './StrengthMeter.tsx';
import { ValueBasis, type ValueBasisKind } from './ValueBasis.tsx';

const themes: Theme[] = ['light', 'dark'];
const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(' ');
const classesUnder = (el: Element) => [el, ...el.querySelectorAll('*')].flatMap(classesOf);
/** The `<prefix>-<token>` class on an element, e.g. bg-ok-bg. */
const tokenClass = (el: Element, prefix: 'bg' | 'text') =>
  classesOf(el).find((c) => c.startsWith(`${prefix}-`) && resolveColour(c, 'light') !== undefined) ?? '';

// Never called: tsc (pnpm typecheck) fails if `basis` becomes optional, because the expect-error goes unused.
// SAFETY: mutation check: basis -> basis? -> pnpm typecheck failed (unused @ts-expect-error)
function withoutBasis() {
  // @ts-expect-error basis is required
  return <ValueBasis label="Observed" />;
}
void withoutBasis;

// SAFETY: mutation check: projection border-dashed -> border-solid -> the Projection row failed
describe('Scenario Outline: Every value carries its basis', () => {
  it.each<[ValueBasisKind, string, string]>([
    ['observed', 'Observed', 'bg-text'],
    ['baseline', 'Baseline', 'border-text-2'],
    ['projection', 'Projection', 'border-dashed'],
    ['not-available', 'Not yet available', 'border-t-2'],
  ])('%s: the marker reads "%s" next to its own shape', (basis, label, shape) => {
    const { container } = render(<ValueBasis basis={basis} label={label} />);
    expect(container.textContent).toBe(label);
    const marker = container.querySelector('[aria-hidden="true"]');
    expect(marker && classesOf(marker)).toContain(shape);
  });
});

const provenances: [Provenance, string][] = [
  ['corroborated', 'Independently corroborated'],
  ['submitted', 'Candidate-submitted'],
  ['claim', 'Claim awaiting validation'],
  ['contradictory', 'Contradictory'],
  ['awaiting-defence', 'To check in interview'],
];

describe('Scenario Outline: Provenance is an icon and a word', () => {
  it.each(provenances)('%s shows its icon and the words "%s"', (provenance, label) => {
    const { container } = render(<ProvenanceTag provenance={provenance} label={label} />);
    expect(container.textContent).toBe(label);
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  // SAFETY: mutation check: submitted icon -> the corroborated path -> this test failed
  it('the meaning survives in greyscale: every provenance has a different icon shape', () => {
    const shapes = provenances.map(([provenance, label]) => {
      const { container, unmount } = render(<ProvenanceTag provenance={provenance} label={label} />);
      const svg = container.querySelector('svg')?.innerHTML;
      unmount();
      return svg;
    });
    expect(new Set(shapes).size).toBe(provenances.length);
  });

  // SAFETY: mutation check: claim text-warn-text -> text-warn-border -> both claim rows failed
  it.each(themes.flatMap((theme) => provenances.map(([p, l]) => [theme, p, l] as const)))(
    '%s: %s text keeps at least 4.5:1 on its ground',
    (theme, provenance, label) => {
      const { container } = render(<ProvenanceTag provenance={provenance} label={label} />);
      const chip = container.firstElementChild as Element;
      const text = resolveColour(tokenClass(chip, 'text'), theme) ?? '';
      const ground = resolveColour(tokenClass(chip, 'bg'), theme) ?? '';
      expect(contrast(text, ground)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

const strengths: [Strength, string, number][] = [
  ['strong', 'Strong', 3],
  ['medium', 'Medium', 2],
  ['supporting', 'Supporting', 1],
  ['claim', 'Claim only', 0],
];

describe('Scenario: Strength is neutral ink', () => {
  // SAFETY: mutation check: filled segment bg-text -> bg-ok-text -> every row but Claim only failed
  it.each(strengths)('%s reads "%s" with %i of 3 segments in ink and no status colour', (strength, label, on) => {
    const { container } = render(
      <StrengthMeter strength={strength} label={label} countsAsZeroLabel="Counts as zero" />,
    );
    expect(screen.getByText(label)).toBeTruthy();
    const segments = [...container.querySelectorAll('[aria-hidden="true"] > span')];
    expect(segments).toHaveLength(3);
    expect(segments.filter((s) => tokenClass(s, 'bg') !== '')).toHaveLength(on);
    expect(classesUnder(container).filter((c) => /-(ok|warn|err|info)-/.test(c))).toEqual([]);
  });

  // SAFETY: mutation check: filled segment bg-text -> bg-border-strong -> both rows failed
  it.each(themes)('%s: a filled segment keeps at least 3:1 on the surface', (theme) => {
    const { container } = render(<StrengthMeter strength="strong" label="Strong" />);
    const filled = tokenClass(container.querySelector('[aria-hidden="true"] > span') as Element, 'bg');
    expect(
      contrast(resolveColour(filled, theme) ?? '', resolveColour('bg-surface', theme) ?? ''),
    ).toBeGreaterThanOrEqual(3);
  });

  it('"Claim only" can show "Counts as zero", other strengths never do', () => {
    const { rerender } = render(
      <StrengthMeter strength="claim" label="Claim only" countsAsZeroLabel="Counts as zero" />,
    );
    expect(screen.getByText('Counts as zero')).toBeTruthy();
    rerender(<StrengthMeter strength="claim" label="Claim only" />);
    expect(screen.queryByText('Counts as zero')).toBeNull();
    rerender(<StrengthMeter strength="supporting" label="Supporting" countsAsZeroLabel="Counts as zero" />);
    expect(screen.queryByText('Counts as zero')).toBeNull();
  });
});

const text = 'In the public repository she authored 412 of 460 commits, with a golden set of 200 questions.';
const cited = 'authored 412 of 460 commits';
const start = text.indexOf(cited);

describe('Scenario: The highlighter marks cited evidence only', () => {
  it('marks only the cited span, labelled "cited evidence", in the hl tokens', () => {
    const { container } = render(
      <p>
        <EvidenceHighlight
          text={text}
          citations={[{ start, end: start + cited.length, sourceId: 'src_1' }]}
          markLabel="cited evidence"
        />
      </p>,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    const mark = marks[0] as HTMLElement;
    const label = mark.querySelector('.sr-only');
    expect(label?.textContent).toBe('cited evidence ');
    expect(mark.textContent).toBe(`cited evidence ${cited}`);
    expect(container.textContent).toBe(text.replace(cited, `cited evidence ${cited}`));
    expect(mark.dataset['sourceId']).toBe('src_1');
    expect(classesOf(mark)).toEqual(expect.arrayContaining(['bg-hl', 'text-hl-text']));
    // SAFETY: mutation check: removed underline -> this test failed
    expect(classesOf(mark)).toEqual(expect.arrayContaining(['underline', 'decoration-hl-text'])); // WCAG 1.4.1
    expect(resolveColour('bg-hl', 'light')).toBe('#FFE873');
    expect(resolveColour('bg-hl', 'dark')).toBe('#4D4208');
  });

  it.each(themes)('%s: highlighted text keeps at least 4.5:1 on hl', (theme) => {
    expect(
      contrast(resolveColour('text-hl-text', theme) ?? '', resolveColour('bg-hl', theme) ?? ''),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('marks several citations in order, whatever order they arrive in', () => {
    const { container } = render(
      <EvidenceHighlight
        text={text}
        citations={[
          { start: text.indexOf('200'), end: text.indexOf('200') + 3, sourceId: 'b' },
          { start, end: start + cited.length, sourceId: 'a' },
        ]}
        markLabel="cited evidence"
      />,
    );
    expect([...container.querySelectorAll('mark')].map((m) => m.dataset['sourceId'])).toEqual(['a', 'b']);
  });

  // SAFETY: mutation check: c.end <= text.length -> c.end < text.length -> the "to the last character" row failed
  // SAFETY: mutation check: c.start >= previous end -> > -> the "from the first character" and "adjacent" rows failed
  it.each([
    ['from the first character', [{ start: 0, end: 2, sourceId: 'a' }], ['In']],
    ['to the last character', [{ start: text.length - 10, end: text.length, sourceId: 'a' }], ['questions.']],
    [
      'adjacent',
      [
        { start: 0, end: 2, sourceId: 'a' },
        { start: 2, end: 6, sourceId: 'b' },
      ],
      ['In', ' the'],
    ],
  ])('accepts a citation %s', (_, citations, expected) => {
    const warn = vi.spyOn(console, 'warn');
    const { container } = render(<EvidenceHighlight text={text} citations={citations} markLabel="cited evidence" />);
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent?.replace('cited evidence ', ''))).toEqual(
      expected,
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('Scenario: A citation outside the text is rejected', () => {
  afterEach(() => vi.restoreAllMocks());

  // SAFETY: mutation check: removed c.end <= text.length -> the beyond-the-end row failed
  // SAFETY: mutation check: removed the surrogate check -> the splitting-a-character row failed
  // SAFETY: mutation check: logged `text` instead of textLength -> every row failed
  it.each([
    ['beyond the end', text, [{ start: 10, end: text.length + 1, sourceId: 'a' }]],
    [
      'overlapping',
      text,
      [
        { start: 0, end: 10, sourceId: 'a' },
        { start: 5, end: 12, sourceId: 'b' },
      ],
    ],
    ['empty', text, [{ start: 4, end: 4, sourceId: 'a' }]],
    ['splitting a character', 'a😀b', [{ start: 2, end: 4, sourceId: 'a' }]],
  ])('%s: renders the plain text and warns without the text content', (_, body, citations) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(<EvidenceHighlight text={body} citations={citations} markLabel="cited evidence" />);
    expect(container.querySelector('mark')).toBeNull();
    expect(container.textContent).toBe(body);
    expect(warn).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('repository');
    expect(logged).not.toContain('😀');
  });
});
