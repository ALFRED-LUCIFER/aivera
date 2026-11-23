import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contrast, resolveColour, stylesCss, tokens, type Theme } from '../test/theme.ts';
import { CompetencyRow } from './CompetencyRow.tsx';
import { NeedVsProvenBar, ScoreWithUncertainty, type NeedLevels } from './ScoreBar.tsx';

const themes: Theme[] = ['light', 'dark'];
const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(' ');

const scoreLabels = {
  backedLabel: (n: number) => `${n} backed by evidence`,
  captionLabel: (b: number, u: number) => `${b} backed by evidence · up to ${u} if claims hold in interview`,
  upToLabel: (n: number) => `up to ${n} if claims hold in interview`,
  unavailableLabel: 'Score not yet available',
};
const renderScore = (backed: number, upTo: number, compact = false) =>
  render(<ScoreWithUncertainty backed={backed} upTo={upTo} compact={compact} {...scoreLabels} />);

const part = (container: Element, name: string) => container.querySelector<HTMLElement>(`[data-part="${name}"]`);
const solidOf = (container: Element) => container.querySelector<HTMLElement>('.score-solid:not([data-part])');

describe('Scenario: Backed score with a claim range', () => {
  // SAFETY: mutation check: hatch width upTo - solid -> upTo -> this test failed
  it('the solid bar ends at 62, the hatched part runs from 62 to 78, and the caption reads both', () => {
    const { container } = renderScore(62, 78);
    expect(solidOf(container)?.style.width).toBe('62%');
    const hatch = part(container, 'claimed');
    expect(hatch?.style.insetInlineStart).toBe('62%');
    expect(hatch?.style.width).toBe('16%');
    expect(container.textContent).toBe('62 backed by evidence · up to 78 if claims hold in interview');
  });

  it('the bar has an accessible name with both numbers', () => {
    renderScore(62, 78);
    expect(
      screen.getByRole('img', { name: '62 backed by evidence · up to 78 if claims hold in interview' }),
    ).toBeTruthy();
  });

  it('the compact table variant shows "68" and "up to 84 if claims hold", named in full', () => {
    const { container } = render(
      <ScoreWithUncertainty
        {...scoreLabels}
        upToLabel={(n) => `up to ${n} if claims hold`}
        captionLabel={(b, u) => `${b} backed by evidence · up to ${u} if claims hold`}
        backed={68}
        upTo={84}
        compact
      />,
    );
    expect(container.textContent).toBe('68up to 84 if claims hold');
    expect(screen.getByRole('img', { name: '68 backed by evidence · up to 84 if claims hold' })).toBeTruthy();
  });
});

describe('Scenario: No open claims', () => {
  // SAFETY: mutation check: upTo > solid -> upTo >= solid -> this test failed
  it('backed 72, ceiling 72: no hatched segment, the text reads "72 backed by evidence"', () => {
    const { container } = renderScore(72, 72);
    expect(part(container, 'claimed')).toBeNull();
    expect(container.textContent).toBe('72 backed by evidence');
    expect(screen.getByRole('img', { name: '72 backed by evidence' })).toBeTruthy();
  });

  it('compact: just the number', () => {
    const { container } = renderScore(72, 72, true);
    expect(container.textContent).toBe('72');
  });

  // SAFETY: mutation check: removed solid === 0 && 'rounded-s-full' -> this test failed
  it('a hatch from 0 rounds its start corner too, so it sits inside the track', () => {
    const { container } = renderScore(0, 40);
    expect(classesOf(part(container, 'claimed') as Element)).toEqual(
      expect.arrayContaining(['rounded-s-full', 'rounded-e-full']),
    );
    renderScore(10, 40);
    expect(classesOf(container.ownerDocument.querySelectorAll('[data-part="claimed"]')[1] as Element)).not.toContain(
      'rounded-s-full',
    );
  });

  it.each([
    [0, 0],
    [100, 100],
    [0, 100],
  ])('accepts the edges: backed %i, ceiling %i', (backed, upTo) => {
    expect(() => renderScore(backed, upTo)).not.toThrow();
  });
});

const invalidScores = [
  ['ceiling lower than backed', 70, 60],
  ['backed below 0', -1, 50],
  ['ceiling above 100', 50, 101],
  ['not a number', Number.NaN, 50],
] as const;

describe('Scenario: Invalid input is refused', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // SAFETY: mutation check: removed backed <= upTo -> the "ceiling lower than backed" rows failed
  // SAFETY: mutation check: removed upTo <= 100 -> the "ceiling above 100" rows failed
  it.each(invalidScores)('%s: throws in development, without the numbers', (_, backed, upTo) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderScore(backed, upTo)).toThrow(/^ScoreWithUncertainty: values out of range$/);
  });

  it.each(invalidScores)('%s: renders "Score not yet available" in production, and no bar', (_, backed, upTo) => {
    vi.stubEnv('NODE_ENV', 'production');
    const { container } = renderScore(backed, upTo);
    expect(container.textContent).toBe('Score not yet available');
    expect(container.querySelector('.score-solid')).toBeNull();
  });

  it.each([
    ['claimed below proven', 3, 2, 3],
    ['above level 5', 1, 6, 2],
    ['not a whole level', 1.5, 3, 2],
    ['needed below 0', 1, 3, -1],
  ])(
    'NeedVsProvenBar, %s: throws in development, "Score not yet available" in production',
    (_, proven, claimed, needed) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const bar = <NeedVsProvenBar {...needLabels} name="Python" proven={proven} claimed={claimed} needed={needed} />;
      expect(() => render(bar)).toThrow(/^NeedVsProvenBar: values out of range$/);
      vi.stubEnv('NODE_ENV', 'production');
      expect(render(bar).container.textContent).toBe('Score not yet available');
    },
  );
});

const needLabels = {
  levelLabel: (v: NeedLevels) => `Proven ${v.proven} of ${v.levels} · job needs ${v.needed}`,
  barLabel: (v: NeedLevels) => `Proven ${v.proven} of ${v.levels}, claimed ${v.claimed}, the job needs ${v.needed}`,
  aboveLabel: 'Above the need',
  meetsLabel: 'Meets the need',
  shortLabel: (n: number, claimed: boolean) => `${n} short${claimed ? ', claimed' : ''}`,
  unavailableLabel: 'Score not yet available',
};
const renderNeed = (proven: number, claimed: number, needed: number) =>
  render(
    <NeedVsProvenBar {...needLabels} name="Cost and reliability" proven={proven} claimed={claimed} needed={needed} />,
  );

describe('Scenario Outline: Need versus proven', () => {
  // SAFETY: mutation check: short < 0 -> short <= 0 -> the "Meets the need" row failed
  // SAFETY: mutation check: claimed >= needed -> claimed > needed -> the proven 1, claimed 2, needed 2 row failed
  it.each([
    [5, 5, 4, 'Above the need', 'ok'],
    [3, 3, 3, 'Meets the need', 'ok'],
    [1, 3, 2, '1 short, claimed', 'warn'],
    [0, 3, 2, '2 short, claimed', 'warn'],
    [1, 2, 2, '1 short, claimed', 'warn'],
    [1, 1, 3, '2 short', 'warn'],
  ])('proven %i, claimed %i, needed %i reads "%s" with an icon', (proven, claimed, needed, outcome, tone) => {
    const { container } = renderNeed(proven, claimed, needed);
    expect(screen.getByText(`Proven ${proven} of 5 · job needs ${needed}`)).toBeTruthy();
    const chip = screen.getByText(outcome);
    expect(chip.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(classesOf(chip)).toContain(`text-${tone}-text`);
    expect(part(container, 'need')?.style.insetInlineStart).toBe(`${needed * 20}%`);
  });

  it('the bar draws solid to proven, hatched to claimed, and has a text equivalent with all three numbers', () => {
    const { container } = renderNeed(1, 4, 2);
    expect(solidOf(container)?.style.width).toBe('20%');
    expect(part(container, 'claimed')?.style.width).toBe('60%');
    expect(screen.getByRole('img', { name: 'Proven 1 of 5, claimed 4, the job needs 2' })).toBeTruthy();
  });

  // Meaning never rests on colour: every outcome has its own icon shape.
  // SAFETY: mutation check: the "short" outcome used the clock icon -> this test failed
  it('meets, short-claimed and short have different icon shapes', () => {
    const shapes = [
      [3, 3, 3],
      [1, 3, 2],
      [1, 1, 3],
    ].map(([p, c, n]) => {
      const { container, unmount } = renderNeed(p ?? 0, c ?? 0, n ?? 0);
      const svg = container.querySelector('svg')?.innerHTML;
      unmount();
      return svg;
    });
    expect(new Set(shapes).size).toBe(3);
  });
});

describe('Scenario: Competency row', () => {
  it('reads the name, weight, strength, provenance and a link to the sources', () => {
    const { container } = render(
      <CompetencyRow
        name="Retrieval and evaluation"
        weightLabel="Weight 20% · mandatory"
        strength="medium"
        strengthLabel="Medium"
        provenance="claim"
        provenanceLabel="Claim awaiting validation"
        sourcesLabel="2 sources"
        sourcesHref="#sources"
      />,
    );
    for (const text of ['Retrieval and evaluation', 'Weight 20% · mandatory', 'Medium', 'Claim awaiting validation']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    const link = screen.getByRole('link', { name: '2 sources' });
    expect(link.getAttribute('href')).toBe('#sources');
    expect(classesOf(link)).toEqual(expect.arrayContaining(['min-h-10', 'pointer-coarse:min-h-11']));
    expect(container.querySelectorAll('[aria-hidden="true"] > span')).toHaveLength(3); // the shared StrengthMeter
  });

  // SAFETY: mutation check: dropped the countsAsZeroLabel pass-through -> this test failed
  it('a claim-only row says it counts as zero (AGENTS.md 1.6)', () => {
    render(
      <CompetencyRow
        name="Arabic and bilingual NLP"
        weightLabel="Weight 10%"
        strength="claim"
        strengthLabel="Claim only"
        countsAsZeroLabel="Counts as zero"
        provenance="claim"
        provenanceLabel="Claim awaiting validation"
        sourcesLabel="1 source"
        sourcesHref="#sources"
      />,
    );
    expect(screen.getByText('Counts as zero')).toBeTruthy();
  });
});

/** The body of an `@utility` block in styles.css, nested media query included. */
const utility = (name: string) => new RegExp(`@utility ${name} \\{([\\s\\S]*?)\\n\\}`).exec(stylesCss)?.[1] ?? '';
const inkOf = (name: string, theme: Theme) => tokens.color[theme][/var\(--([\w-]+)\)/.exec(utility(name))?.[1] ?? ''];

describe('Scenario: Hatching is visible in dark theme and in forced colours', () => {
  it('the claim range is a stripe pattern, not a colour, so it survives greyscale', () => {
    expect(utility('score-hatch')).toMatch(
      /background: repeating-linear-gradient\(135deg, var\(--text\) 0 2px, transparent/,
    );
    expect(utility('score-solid')).not.toContain('gradient');
  });

  // SAFETY: mutation check: removed the forced-colors block from score-hatch -> this test failed
  it.each(['score-solid', 'score-hatch'])('%s redraws in system colours under forced colours', (name) => {
    const forced = /@media \(forced-colors: active\) \{([\s\S]*?)\}/.exec(utility(name))?.[1] ?? '';
    expect(forced).toContain('forced-color-adjust: none');
    expect(forced).toContain('CanvasText');
    if (name === 'score-hatch') expect(forced).toContain('repeating-linear-gradient(135deg, CanvasText 0 2px, Canvas');
  });

  // Forced colours turn the track's ground into Canvas and drop its inset ring; without an outline the empty part up
  // to 100 vanishes and 62 of 100 reads as a full bar.
  // SAFETY: mutation check: removed the score-track forced-colors outline -> this test failed
  it('the track keeps a CanvasText outline under forced colours, so the scale to 100 stays visible', () => {
    const forced = /@media \(forced-colors: active\) \{([\s\S]*?)\}/.exec(utility('score-track'))?.[1] ?? '';
    expect(forced).toContain('outline: 1px solid CanvasText');
    const { container } = renderScore(62, 78);
    expect(container.querySelector('.score-track')).not.toBeNull();
  });

  // SAFETY: mutation check: score-hatch var(--text) -> var(--border-strong) -> both rows failed
  it.each(themes)('%s: solid, hatch stripes and need mark keep at least 3:1 on the track and the surface', (theme) => {
    const track = resolveColour('bg-surface-subtle', theme) ?? '';
    const surface = resolveColour('bg-surface', theme) ?? '';
    for (const ink of [inkOf('score-solid', theme), inkOf('score-hatch', theme)]) {
      expect(contrast(ink ?? '', track)).toBeGreaterThanOrEqual(3);
      expect(contrast(ink ?? '', surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(themes)('%s: captions keep 4.5:1 on the surface, outcome words 4.5:1 on their ground', (theme) => {
    const c = (a: string, b: string) => contrast(resolveColour(a, theme) ?? '', resolveColour(b, theme) ?? '');
    expect(c('text-text-2', 'bg-surface')).toBeGreaterThanOrEqual(4.5);
    expect(c('text-ok-text', 'bg-ok-bg')).toBeGreaterThanOrEqual(4.5);
    expect(c('text-warn-text', 'bg-warn-bg')).toBeGreaterThanOrEqual(4.5);
  });
});
