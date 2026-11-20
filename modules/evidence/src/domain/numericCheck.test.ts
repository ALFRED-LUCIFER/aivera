// The numeric pre-check (AIV-P1-029). Cases adapted from MIT-licensed tests (THIRD_PARTY_NOTICES.md), rewritten for
// two sources; synthetic text only.
import { describe, expect, it } from 'vitest';
import { precheckNumbers } from './numericCheck.ts';

describe('precheckNumbers', () => {
  it.each([
    // The ticket's Scenario Outline.
    ['led a team of 12 engineers', 'managed 5 engineers', 'contradiction'],
    ['led a team of 12 engineers', 'ran a 12-person team', 'agreement'],
    ['about 9,000 merchants use the assistant', 'a few hundred merchants', 'not_settled'],
    ['cut cost by 40%', '12 years of experience', 'not_compared'],
    // Daniel Novak's item against a scorecard note.
    ['71% → 88% answer accuracy', 'answer accuracy was 80%', 'contradiction'],
    ['answer accuracy rose from 71% to 88%', 'answer accuracy reached 88%', 'agreement'],
  ] as const)('"%s" against "%s" is %s', (first, second, outcome) => {
    expect(precheckNumbers(first, second)).toBe(outcome);
    expect(precheckNumbers(second, first)).toBe(outcome);
  });

  // SAFETY: mutation check: keyed the value sets by sentence pair only (no unit) -> this test failed (agreement)
  it('a number of another unit in the same sentences never turns a contradiction into an agreement', () => {
    expect(precheckNumbers('A team of 5 engineers cut latency 30%.', 'A team of 12 engineers cut latency 30%.')).toBe(
      'contradiction',
    );
    expect(precheckNumbers('Served 3 regions for 12 engineers.', 'Supported 5 engineers in 3 regions.')).toBe(
      'contradiction',
    );
  });

  it('a year or a function word after a number is never a unit', () => {
    expect(precheckNumbers('In 2019 the team shipped the assistant.', 'In 2021 the team shipped the assistant.')).toBe(
      'not_compared',
    );
    expect(precheckNumbers('Joined the team in 2019 and led hiring.', 'Joined the team in 2021 and led hiring.')).toBe(
      'not_compared',
    );
  });

  it('a count noun other than a headcount needs a shared word besides the unit', () => {
    // Not flagged: left to the AI comparison.
    expect(precheckNumbers('Wrote 3 papers.', 'Reviewed 10 papers.')).toBe('not_settled');
    expect(precheckNumbers('Wrote 3 retrieval papers.', 'Published 10 retrieval papers.')).toBe('contradiction');
  });

  it('never compares a percentage with a headcount of the same digits', () => {
    expect(precheckNumbers('Grew the platform team to a 40-person team.', 'The team cut deploy time 40%.')).not.toBe(
      'agreement',
    );
  });

  it('a percentage needs two shared words about the metric, not one shared word', () => {
    expect(precheckNumbers('The team reduced incident rate 40%.', 'The team cut deploy time 30%.')).toBe(
      'not_compared',
    );
    expect(precheckNumbers('The team cut deploy time 40%.', 'Deploy time fell 30% that year.')).toBe('contradiction');
    // A unit that names the metric needs one placing word.
    expect(precheckNumbers('Grew the team to 40 people.', 'Led a team of 40 people.')).toBe('agreement');
  });

  it('a digit coincidence in another sentence or a bare number is never compared', () => {
    expect(precheckNumbers('Managed 12 engineers.', 'Joined in 2019 – 2024. Published a 12 page guide.')).toBe(
      'not_compared',
    );
    expect(precheckNumbers('Shipped in Q3 with v2 of the API.', 'Shipped in Q4.')).toBe('not_compared');
  });

  it('numbers compare only within their own sentence', () => {
    const write = 'She managed the platform team. Later she hired 12 engineers.';
    expect(precheckNumbers(write, 'She hired 5 engineers.')).toBe('contradiction');
    // The team is named without a number on one side: only the AI comparison can judge it.
    expect(precheckNumbers('She managed the platform team.\nShe wrote 3 papers.', 'The team had 5 engineers.')).toBe(
      'not_settled',
    );
  });

  it('reads any script the same way, and folds a Turkish dotted capital', () => {
    expect(
      precheckNumbers('Сократил расходы на инфраструктуру на 40%.', 'Расходы на инфраструктуру упали на 25%.'),
    ).toBe('contradiction');
    expect(
      precheckNumbers('Сократил расходы на инфраструктуру на 40%.', 'Опубликовал руководство объёмом 40 страниц.'),
    ).toBe('not_compared');
    expect(
      precheckNumbers('İstanbul ekibinde maliyetleri 40% azalttı.', 'Istanbul ekibinde maliyetleri 40% düştü.'),
    ).toBe('agreement');
  });
});
