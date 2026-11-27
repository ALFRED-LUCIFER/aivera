import { expect, test } from '@playwright/test';
import { gulfTime, seededInterviewLabels } from '../gulfDay.ts';

// AIV-P1-149 Scenario Outline: Interview labels follow the Gulf day the test runs on. No browser: a unit check of the
// helper interviews.spec.ts and scorecard.spec.ts take their expected labels from. 20:00 UTC is Gulf midnight.
const seededAt = new Date('2026-11-26T19:50:00.000Z'); // 23:50 on 26 Nov in the Gulf

test('the seed plans its interviews on the Gulf day, not the UTC day', () => {
  expect(gulfTime(seededAt, 0, '14:00').toISOString()).toBe('2026-11-26T10:00:00.000Z');
  expect(gulfTime(seededAt, -2, '11:00').toISOString()).toBe('2026-11-24T07:00:00.000Z');
  // 00:10 on 27 Nov in the Gulf is still 26 Nov in UTC.
  expect(gulfTime(new Date('2026-11-26T20:10:00.000Z'), 0, '14:00').toISOString()).toBe('2026-11-27T10:00:00.000Z');
});

test('at 23:55 Gulf time on the seed day: "Today, 14:00" and "Scorecard due, 2 days"', () => {
  expect(seededInterviewLabels(new Date('2026-11-26T19:55:00.000Z'), seededAt)).toEqual({
    daniel: 'Today, 14:00',
    layla: 'Scorecard due, 2 days',
  });
});

test('at 00:01 Gulf time the next day: the dated label and "Scorecard due, 3 days"', () => {
  expect(seededInterviewLabels(new Date('2026-11-26T20:01:00.000Z'), seededAt)).toEqual({
    daniel: '26 Nov, 14:00',
    layla: 'Scorecard due, 3 days',
  });
});
