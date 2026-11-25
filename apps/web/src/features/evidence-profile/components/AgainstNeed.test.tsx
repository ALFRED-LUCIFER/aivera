// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NeedRow } from '../domain/needs.ts';
import { AgainstNeed } from './AgainstNeed.tsx';

// AIV-P1-044: the ticket's scenarios on Sara as the Candidate artboard draws her; the e2e seed gives her other levels.
// Synthetic cast only (docs/00-product/personas.md).
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const rows = (levels: [name: string, proven: number, claimed: number, needed: number][]): NeedRow[] =>
  levels.map(([name, proven, claimed, needed]) => ({ competencyId: name, name, proven, claimed, needed }));
const SARA = rows([
  ['LLM systems in production', 5, 5, 4],
  ['Retrieval and evaluation', 5, 5, 4],
  ['Python service engineering', 3, 4, 3],
  ['Product judgement', 3, 4, 3],
  ['Cost and reliability', 1, 4, 2],
  ['Arabic and bilingual NLP', 0, 4, 2],
]);
const show = (needs: NeedRow[]) =>
  render(
    <IntlProvider {...intl}>
      <AgainstNeed rows={needs} />
    </IntlProvider>,
  );
const rowOf = (name: string) => {
  const row = screen.getAllByRole('listitem').find((li) => li.textContent.startsWith(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

describe('Feature: Against what the job needs', () => {
  it.each([
    ['LLM systems in production', 'Proven 5 of 5 · job needs 4', 'Above the need'],
    ['Python service engineering', 'Proven 3 of 5 · job needs 3', 'Meets the need'],
    ['Cost and reliability', 'Proven 1 of 5 · job needs 2', '1 short, claimed'],
    ['Arabic and bilingual NLP', 'Proven 0 of 5 · job needs 2', '2 short, claimed'],
  ])("Scenario Outline: Sara's competencies: %s shows %s and %s", (name, line, verdict) => {
    show(SARA);
    expect(rowOf(name).textContent).toBe(name + line + verdict);
  });

  it('Scenario: Summary count, with the legend, the intro and the footnote', () => {
    show(SARA);
    const section = screen.getByRole('region', { name: 'Against what the job needs' });
    expect(within(section).getByRole('heading', { level: 3 }).textContent).toBe(
      'Meets the need on 4 of 6 competencies',
    );
    expect(
      within(section).getByText(
        'Each competency is judged against the level this job needs, set in the rubric. Where the proven shape falls inside the needed one, there is a gap.',
      ),
    ).toBeTruthy();
    for (const legend of ['Proven by evidence', 'Claimed', 'What the job needs'])
      expect(within(section).getByText(legend, { exact: true })).toBeTruthy();
    expect(
      within(section).getByText(
        'Solid is proven, hatched is claimed, and the upright mark is the level the job needs. The two gaps would close if their claims hold.',
      ),
    ).toBeTruthy();
  });

  it('Scenario: Screen reader text: every bar and the radar have a text equivalent that names the competency', () => {
    show(SARA);
    const [radar, ...bars] = screen.getAllByRole('img').map((img) => img.getAttribute('aria-label'));
    expect(bars).toEqual([
      'LLM systems in production: proven 5, claimed 5, job needs 4',
      'Retrieval and evaluation: proven 5, claimed 5, job needs 4',
      'Python service engineering: proven 3, claimed 4, job needs 3',
      'Product judgement: proven 3, claimed 4, job needs 3',
      'Cost and reliability: proven 1, claimed 4, job needs 2',
      'Arabic and bilingual NLP: proven 0, claimed 4, job needs 2',
    ]);
    expect(radar).toBe(`Radar of 6 competencies. ${bars.join('; ')}`);
  });

  it('Scenario: A gap with no claim reads "2 short", and the footnote promises nothing', () => {
    show(rows([['Cost and reliability', 1, 1, 3]]));
    expect(rowOf('Cost and reliability').textContent).toBe('Cost and reliabilityProven 1 of 5 · job needs 32 short');
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Meets the need on 0 of 1 competency');
    expect(screen.queryByText(/would close/)).toBeNull();
    // Fewer than three competencies enclose no shape: no radar, no legend, no "proven shape" sentence.
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.queryByText('Proven by evidence')).toBeNull();
    expect(screen.queryByText(/proven shape/)).toBeNull();
  });

  it('says how many gaps would close when only some claims reach the need', () => {
    show(
      rows([
        ['Cost and reliability', 1, 4, 2],
        ['Arabic and bilingual NLP', 0, 1, 2],
        ['Product judgement', 3, 3, 3],
      ]),
    );
    expect(screen.getByText(/would close/).textContent).toContain('1 of the 2 gaps would close if their claims hold.');
  });

  it('the radar cuts a long competency name on its axis and keeps it whole in its row', () => {
    show(SARA);
    const radar = screen.getAllByRole('img')[0];
    expect([...(radar?.querySelectorAll('text') ?? [])].map((text) => text.textContent)).toContain(
      'Python service engine…',
    );
    expect(rowOf('Python service engineering')).toBeTruthy();
  });
});
