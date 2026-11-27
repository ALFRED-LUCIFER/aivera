import { getTranslations } from '@credalent/i18n';
import { describe, expect, it } from 'vitest';
import {
  canMove,
  clashingAt,
  effectiveStatus,
  ROUNDS,
  scorecardDueDays,
  STATUSES,
  type InterviewStatus,
} from './interview.ts';

// AIV-P2-001: the status transition table, round labels and the computed scorecard due. Synthetic cast only.
const t = await getTranslations('en', 'Asia/Dubai');

describe('Scenario Outline: Only allowed status transitions', () => {
  // SAFETY: mutation check: added 'in_progress' to completed's moves -> the "completed to in_progress" row failed
  it.each([
    ['scheduled', 'in_progress', true],
    ['in_progress', 'completed', true],
    ['scheduled', 'scorecard_due', true],
    ['completed', 'in_progress', false],
    ['cancelled', 'scheduled', false],
    // Owner decision, 24 Nov 2026: an interview with no time yet can be held, and scheduled later.
    ['to_schedule', 'in_progress', true],
    ['to_schedule', 'scheduled', true],
    // The pilot submits a scorecard for an interview it never scheduled (AIV-P2-006).
    ['to_schedule', 'completed', true],
    ['scheduled', 'completed', false],
    ['scorecard_due', 'in_progress', true],
    ['in_progress', 'scheduled', false],
  ] as const)('%s to %s: accepted = %s', (from, to, accepted) => {
    expect(canMove(from, to)).toBe(accepted);
  });

  it('completed and cancelled are final', () => {
    for (const to of STATUSES) {
      expect(canMove('completed', to)).toBe(false);
      expect(canMove('cancelled', to)).toBe(false);
    }
  });
});

describe('round and status labels', () => {
  it.each([
    ['structured_screen', 'Round 1, structured screen'],
    ['evidence_defence', 'Round 2, evidence defence'],
    ['panel', 'Round 3, panel'],
  ] as const)('%s reads "%s"', (round, label) => {
    expect(t(`interviews.round.${round}`)).toBe(label);
  });

  it('every round and status has a label', () => {
    expect(ROUNDS).toHaveLength(3);
    expect(STATUSES.map((s) => t(`interviews.status.${s}`))).toEqual([
      'Not scheduled yet',
      'Scheduled',
      'In progress',
      'Scorecard due',
      'Completed',
      'Cancelled',
    ]);
  });
});

describe('Scenario: Scorecard becomes due when the time passes', () => {
  const anjaliRound1 = new Date('2026-11-16T06:00:00.000Z'); // 16 Nov, 10:00 in Dubai
  const listedOn = new Date('2026-11-18T05:00:00.000Z'); // 18 Nov, 09:00 in Dubai: under two full days later

  // SAFETY: mutation check: made effectiveStatus return the stored status -> this test failed (scheduled)
  it('Anjali Iyer\'s Round 1 on 16 Nov, listed on 18 Nov: "Scorecard due, 2 days"', () => {
    const status = effectiveStatus({ status: 'scheduled', scheduledAt: anjaliRound1 }, listedOn);
    expect(t(`interviews.status.${status}`)).toBe('Scorecard due');
    expect(t('interviews.scorecardDueFor', { days: scorecardDueDays(anjaliRound1, listedOn, 'Asia/Dubai') })).toBe(
      'Scorecard due, 2 days',
    );
  });

  it.each([
    ['scheduled, time still ahead', 'scheduled', new Date('2026-11-18T10:00:00.000Z'), 'scheduled'],
    ['scheduled, time exactly now', 'scheduled', listedOn, 'scorecard_due'],
    ['started by a person', 'in_progress', anjaliRound1, 'in_progress'],
    ['completed', 'completed', anjaliRound1, 'completed'],
    ['cancelled', 'cancelled', anjaliRound1, 'cancelled'],
    ['no time yet', 'to_schedule', null, 'to_schedule'],
  ] as const)('%s: shows %s', (_label, status, scheduledAt, shown) => {
    expect(effectiveStatus({ status, scheduledAt }, listedOn)).toBe(shown satisfies InterviewStatus);
  });

  it('counts calendar days in the viewer time zone, not 24-hour periods', () => {
    // 23:30 on 16 Nov in Dubai is still 16 Nov there, though it is 19:30 UTC; at 00:30 on 17 Nov it is one day.
    expect(
      scorecardDueDays(new Date('2026-11-16T19:30:00.000Z'), new Date('2026-11-16T20:30:00.000Z'), 'Asia/Dubai'),
    ).toBe(1);
    expect(scorecardDueDays(listedOn, listedOn, 'Asia/Dubai')).toBe(0);
  });
});

describe('Scenario: Interviewer clash (AIV-P2-007)', () => {
  const at = new Date('2026-11-21T07:00:00.000Z'); // 21 Nov, 11:00 Gulf time
  const shifted = (minutes: number) => ({ scheduledAt: new Date(at.getTime() + minutes * 60_000) });

  // mutation check: counted exactly an hour apart as a clash (<= hold) -> this test failed
  it('flags another interview within the hour, either side, and nothing an hour or more away', () => {
    expect(clashingAt(at, [shifted(0)])).toEqual(at);
    expect(clashingAt(at, [shifted(90), shifted(-30)])).toEqual(shifted(-30).scheduledAt);
    expect(clashingAt(at, [shifted(60), shifted(-60), { scheduledAt: null }])).toBeNull();
    expect(clashingAt(at, [])).toBeNull();
  });
});
